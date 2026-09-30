/**
 * Mock of the InvoiceDesk operations in PracticeServices.asmx, for offline development and
 * tests when the live service isn't reachable.
 *
 * - Reads the real method signatures from asmx/App_Code/*.cs and rejects
 *   calls with missing or mistyped parameters, as ASMX does. So if the Node client and the
 *   C# ever disagree, this fails loudly.
 * - Replies in ASMX's { "d": "<json>" } format, with the same table names the stored
 *   procedures return, "" for a rejected login, and a "Result" error table on failures.
 * - Stores data in its own SQLite file through the Knex repository. It stands in for the
 *   stored procedures; it is not a test of them (use database/invoicedesk.mssql.test.sql).
 *
 * - Version 2: two users for trying approvals, notifications, extraction settings (kept in
 *   memory and masked like the real service; not encrypted) and ExtractInvoiceDocument,
 *   which returns sample data for the Northfield sample invoice instead of calling an AI service.
 *
 *   npm run mock-asmx          (http://localhost:4100/PracticeServices.asmx; any *.asmx name works)
 *   Logins (agreement DEMO, password demo): demo@docusoft.net (user 1), approver@docusoft.net (user 2)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.DATA_BACKEND = 'knex';
process.env.DB_CLIENT = 'sqlite';
process.env.SQLITE_PATH = process.env.MOCK_ASMX_DB || path.join(here, '../data/mock-asmx.db');

const repo = await import('../src/data/knexRepository.js');
const { pageTexts } = await import('../src/services/pdfPages.js');
const { detectByText } = await import('../src/services/documentBoundaries.js');
const { BasicTextExtractor } = await import('../src/extractors/BasicTextExtractor.js');
const os = await import('node:os');
await repo.init();

const PORT = Number(process.env.MOCK_ASMX_PORT || 4100);
const AGRNO = process.env.MOCK_ASMX_AGRNO || 'DEMO';
const PASSWORD = process.env.MOCK_ASMX_PASSWORD || 'demo';
const USERS = [
  { user_id: 1, email: process.env.MOCK_ASMX_EMAIL || 'demo@docusoft.net', display_name: 'Priya Shah' },
  { user_id: 2, email: 'approver@docusoft.net', display_name: 'Tom Hughes' },
];

// ---- signatures from the real C# -------------------------------------------------
const csDir = process.env.MOCK_ASMX_CS_DIR || path.resolve(here, '../../asmx/App_Code');
const csFiles = fs.readdirSync(csDir).filter((f) => /^InvoiceDeskService.*\.cs$/.test(f));
const SIGNATURES = {};
for (const file of csFiles) {
  const cs = fs.readFileSync(path.join(csDir, file), 'utf8');
  for (const m of cs.matchAll(/public string Json_(\w+)\(([^)]*)\)/g)) {
    SIGNATURES[m[1]] = m[2].split(',').map((p) => p.trim().split(/\s+/)).map(([type, name]) => ({ type, name }));
  }
}

// ---- version 2 state (approvals, notifications, settings), saved beside the mock database ----
const statePath = process.env.SQLITE_PATH.replace(/\.db$/, '') + '-state.json';
const state = (() => {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return null; }
})() || { approvals: {}, history: [], notifications: [], seen: {}, settings: { values: {}, default_provider: null, require_approver: true }, nextId: 1 };
state.audit ||= [];
const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 1));
const now = () => new Date().toISOString().slice(0, 19);
const userName = (id) => { const u = USERS.find((x) => x.user_id === id); return id == null ? null : u ? u.display_name : `User ${id}`; };
const approvalOf = (id) => state.approvals[id] || {};
const withApproval = (row) => {
  const a = approvalOf(row.id);
  return { ...row, assigned_to: a.assigned_to ?? null, assigned_to_name: userName(a.assigned_to), assigned_by: a.assigned_by ?? null,
    assigned_by_name: userName(a.assigned_by), assigned_at: a.assigned_at ?? null, approval_comment: a.approval_comment ?? null,
    rejected_by: a.rejected_by ?? null, rejected_by_name: userName(a.rejected_by), rejected_at: a.rejected_at ?? null,
    approved_by: a.approved_by ?? row.approved_by ?? null, approved_by_name: userName(a.approved_by ?? row.approved_by) };
};
function notify(userId, invoiceId, type, message, createdBy) {
  state.notifications.push({ id: state.nextId++, user_id: userId, invoice_id: invoiceId, type, message, is_read: false, created_by: createdBy, created_at: now() });
}
const markRead = (filter) => state.notifications.filter(filter).forEach((n) => { n.is_read = true; });
// ---- audit trail (same rules as dbo.proc_invoicedesk_audit_write and fn_invoicedesk_audit_*) ----
async function snapshot(id) {
  const d = await repo.getInvoice(id);
  if (!d) return null;
  const i = d.invoice;
  const sum = (rows, k) => (rows.length ? rows.reduce((a, r) => a + Number(r[k] || 0), 0) : null);
  return { status: i.status, document_type: i.document_type, invoice_number: i.invoice_number, invoice_date: i.invoice_date, due_date: i.due_date,
    po_number: i.po_number, currency: i.currency, payment_terms: i.payment_terms, payment_method: i.payment_method,
    supplier: d.supplier?.name ?? null, supplier_vat_number: d.supplier?.vat_number ?? null, customer: d.customer?.name ?? null,
    subtotal: i.subtotal, discount_total: i.discount_total, tax_total: i.tax_total, shipping: i.shipping, total_amount: i.total_amount,
    amount_paid: i.amount_paid, amount_due: i.amount_due, notes: i.notes,
    line_item_count: d.line_items.length, line_items_net_total: sum(d.line_items, 'net_amount'),
    tax_line_count: d.taxes.length, tax_lines_total: sum(d.taxes, 'tax_amount') };
}
function changes(before, after) {
  if (!before || !after) return null;
  const txt = (v) => (v === null || v === undefined ? null : String(v));
  const out = Object.keys(after).filter((k) => txt(before[k]) !== txt(after[k])).map((k) => ({ field: k, from: txt(before[k]), to: txt(after[k]) }));
  return out.length ? out : null;
}
async function audit(invoiceId, action, user, details = null) {
  const d = invoiceId ? await repo.getInvoice(invoiceId) : null;
  state.audit.push({ id: state.nextId++, invoice_id: invoiceId, action, user_id: user?.user_id ?? null, user_name: user ? userName(user.user_id) : null,
    document_label: d ? d.invoice.invoice_number || d.invoice.original_name : null, supplier_name: d?.supplier?.name ?? null,
    document_type: d?.invoice.document_type ?? null, details: details ? JSON.stringify(details) : null, created_at: new Date().toISOString().slice(0, 23) });
  saveState();
}
async function auditList(p) {
  const ids = new Set((await repo.listInvoices({ limit: 100000 })).map((r) => r.id));
  const q = (p.Search || '').toLowerCase();
  const to = p.DateTo ? `${p.DateTo}T99` : null;
  const all = state.audit.filter((a) => (!p.InvoiceId || a.invoice_id === p.InvoiceId) && (!p.FilterUserId || a.user_id === p.FilterUserId)
    && (!p.ActionName || a.action === p.ActionName) && (!p.DateFrom || a.created_at >= p.DateFrom) && (!to || a.created_at <= to)
    && (!q || [a.document_label, a.supplier_name, a.user_name, a.details].some((v) => v && v.toLowerCase().includes(q))))
    .sort((a, b) => b.id - a.id);
  const page = all.filter((a) => !p.BeforeId || a.id < p.BeforeId).slice(0, p.Top > 0 ? p.Top : 200);
  return { Entries: page.map((a) => ({ ...a, document_exists: ids.has(a.invoice_id) })), Summary: [{ total: all.length }] };
}

const label = (doc) => `${doc.invoice.invoice_number ? `invoice ${doc.invoice.invoice_number}` : doc.invoice.original_name}${doc.supplier?.name ? ` from ${doc.supplier.name}` : ''}`;

// Same catalog as asmx/App_Code/InvoiceDesk/Extraction/clsExtractionSettings.cs
const F = (name, label, required, secret, def = null, help = null) => ({ name, label, required, secret, default_value: def, help });
const PDF_IMG = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const CATALOG = [
  { id: 'claude', name: 'Claude', vendor: 'Anthropic', kind: 'llm', types: PDF_IMG, description: 'Reads the whole document with a vision language model. Handles scans, photos, handwriting and unusual layouts, and captures every field including line items.', fields: [F('api_key', 'API key', true, true, null, 'From console.anthropic.com'), F('model', 'Model', false, false, 'claude-sonnet-5')] },
  { id: 'openai', name: 'OpenAI GPT', vendor: 'OpenAI', kind: 'llm', types: PDF_IMG, description: "OpenAI's vision language model reads the document and returns every field including line items.", fields: [F('api_key', 'API key', true, true, null, 'From platform.openai.com'), F('model', 'Model', false, false, 'gpt-4o'), F('base_url', 'API base URL', false, false, 'https://api.openai.com/v1', 'Change only for a compatible proxy or Azure OpenAI')] },
  { id: 'gemini', name: 'Google Gemini', vendor: 'Google', kind: 'llm', types: PDF_IMG.slice(0, 4), description: "Google's vision language model reads the document and returns every field including line items.", fields: [F('api_key', 'API key', true, true, null, 'From aistudio.google.com'), F('model', 'Model', false, false, 'gemini-2.5-flash')] },
  { id: 'azure-docintel', name: 'Azure Document Intelligence', vendor: 'Microsoft Azure', kind: 'ocr', types: PDF_IMG.slice(0, 3), notes: 'Use the model prebuilt-receipt for till receipts.', description: "Microsoft's prebuilt invoice model. Returns supplier, customer, totals, tax and line items with confidence scores.", fields: [F('endpoint', 'Endpoint', true, false, null, 'e.g. https://your-resource.cognitiveservices.azure.com/'), F('api_key', 'Key', true, true), F('model', 'Model', false, false, 'prebuilt-invoice'), F('api_version', 'API version', false, false, '2024-11-30')] },
  { id: 'aws-textract', name: 'AWS Textract', vendor: 'Amazon Web Services', kind: 'ocr', types: PDF_IMG.slice(0, 3), notes: 'Reads images and single-page PDFs. Does not return units of measure or per-line tax rates.', description: "Amazon's invoice and receipt OCR (AnalyzeExpense). Reliable on scans and photos, with per-field confidence scores.", fields: [F('region', 'Region', true, false, null, 'e.g. eu-west-2'), F('access_key_id', 'Access key ID', true, false, null, 'IAM user with textract:AnalyzeExpense'), F('secret_access_key', 'Secret access key', true, true)] },
  { id: 'google-documentai', name: 'Google Document AI', vendor: 'Google Cloud', kind: 'ocr', types: PDF_IMG, notes: 'Create an Invoice Parser processor in the Google Cloud console first. Reads up to 15 pages.', description: "Google Cloud's pretrained Invoice Parser. Strong on scanned invoices, returns normalised amounts and dates.", fields: [F('project_id', 'Project ID', true, false), F('location', 'Location', true, false, 'eu', 'eu or us'), F('processor_id', 'Processor ID', true, false), F('service_account_json', 'Service account key (JSON)', true, true, null, 'Paste the whole JSON key file. Needs the Document AI API User role.')] },
];
const PRIORITY = ['claude', 'azure-docintel', 'aws-textract', 'google-documentai', 'gemini', 'openai'];
const valuesOf = (id) => state.settings.values[id] || {};
const isReady = (p) => p.fields.every((f) => !f.required || f.default_value || valuesOf(p.id)[f.name]);
const mask = (v) => (v.length >= 12 ? `****${v.slice(-4)}` : '****');
function resolveTool(requested, mime) {
  const id = (requested || 'auto').toLowerCase();
  if (id !== 'auto') {
    const p = CATALOG.find((x) => x.id === id);
    if (!p) throw new ProcError(`Unknown extraction tool "${requested}".`);
    if (!isReady(p)) throw new ProcError(`${p.name} is not set up for this agreement. Add its keys on the Extraction tools page.`);
    if (mime && !p.types.includes(mime)) throw new ProcError(`${p.name} can't read ${mime} files. Re-run extraction with another tool.`);
    return p;
  }
  for (const c of [state.settings.default_provider, ...PRIORITY].filter(Boolean)) {
    const p = CATALOG.find((x) => x.id === c);
    if (p && isReady(p) && (!mime || p.types.includes(mime))) return p;
  }
  throw new ProcError(mime ? `No extraction tool set up for this agreement can read ${mime} files.` : 'No extraction tool is set up for this agreement. Add keys on the Extraction tools page.');
}
function describeSettings() {
  let auto = null;
  try { auto = resolveTool('auto', null).id; } catch { /* none ready */ }
  return {
    Providers: CATALOG.map((p) => ({ id: p.id, name: p.name, vendor: p.vendor, kind: p.kind, description: p.description, notes: p.notes || null,
      supported_mime_types: p.types.join(','), model: valuesOf(p.id).model || p.fields.find((f) => f.name === 'model')?.default_value || null,
      line_items: true, scans: true, is_ready: isReady(p), is_default: p.id === auto })),
    Fields: CATALOG.flatMap((p) => p.fields.map((f) => {
      const v = valuesOf(p.id)[f.name];
      return { provider_id: p.id, name: f.name, label: f.label, help: f.help, required: f.required, secret: f.secret, is_set: Boolean(v),
        value: f.secret || !v ? null : v, masked: f.secret && v ? mask(v) : null, default_value: f.default_value };
    })),
    Policy: [{ default_provider: state.settings.default_provider, auto_provider: auto, require_approver: state.settings.require_approver,
      updated_at: state.settings.updated_at || null, updated_by_name: userName(state.settings.updated_by) }],
  };
}
const SAMPLE_RAW = {
  document_type: 'invoice',
  supplier: { name: 'Northfield Office Supplies Ltd', address_line: '14 Mill Lane', city: 'Leeds', postcode: 'LS1 4AB', country: 'United Kingdom', email: 'accounts@northfield-supplies.co.uk', vat_number: 'GB 123 4567 89', company_number: '08123456' },
  customer: { name: 'Brightwater Consulting Ltd', address_line: '2 Canal Wharf', city: 'Manchester', postcode: 'M1 2AB', account_number: 'BW-2231' },
  invoice: { invoice_number: 'NFS-10482', invoice_date: '12/08/2026', due_date: '11/09/2026', po_number: 'PO-7781', currency: 'GBP', payment_terms: 'Net 30', subtotal: 578, tax_total: 115.6, total_amount: 693.6, amount_due: 693.6 },
  taxes: [{ tax_name: 'VAT', rate: 20, taxable_amount: 578, tax_amount: 115.6 }],
  line_items: [
    { description: 'A4 copier paper, 80gsm (box of 5 reams)', product_code: 'PAP-A4-80', quantity: 10, unit: 'box', unit_price: 24.5, tax_rate: 20, net_amount: 245 },
    { description: 'Gel pens, black (pack of 12)', product_code: 'PEN-GEL-BK', quantity: 4, unit: 'pack', unit_price: 8.75, tax_rate: 20, net_amount: 35 },
    { description: 'Ergonomic office chair', product_code: 'CHR-ERG-01', quantity: 2, unit: 'each', unit_price: 149, tax_rate: 20, net_amount: 298 }],
  confidence: 0.95,
  warnings: [],
};

function checkParams(method, body) {
  const sig = SIGNATURES[method];
  if (!sig) return `Unknown web method Json_${method}.`;
  for (const { type, name } of sig) {
    if (!(name in body)) return `Invalid web service call, missing value for parameter: '${name}'.`;
    const v = body[name];
    const ok = type === 'string' ? (v === null || typeof v === 'string')
      : type === 'int' ? Number.isInteger(v)
      : type === 'double' ? typeof v === 'number'
      : type === 'bool' ? typeof v === 'boolean' : true;
    if (!ok) return `Cannot convert value for parameter '${name}' to ${type}.`;
  }
  const extra = Object.keys(body).filter((k) => !sig.some((p) => p.name === k));
  if (extra.length) return `Invalid web service call, unexpected parameter: '${extra[0]}'.`;
  return null;
}

// ---- stored-procedure equivalents -------------------------------------------------
class ProcError extends Error {}
const STATUSES = ['queued', 'processing', 'extracted', 'needs_review', 'pending_approval', 'approved', 'rejected', 'failed'];
const parse = (s, fallback) => { try { return s ? JSON.parse(s) : fallback; } catch { throw new ProcError('Invoice data is not valid JSON.'); } };

async function invoiceTables(id) {
  const doc = await repo.getInvoice(id);
  if (!doc) return { Invoice: [], Supplier: [], Customer: [], Taxes: [], LineItems: [], History: [], Parts: [] };
  return {
    Invoice: [withApproval({ ...doc.invoice, review_notes: JSON.stringify(doc.invoice.review_notes || []) })],
    Supplier: doc.supplier ? [doc.supplier] : [],
    Customer: doc.customer ? [doc.customer] : [],
    Taxes: doc.taxes,
    LineItems: doc.line_items,
    History: state.history.filter((h) => h.invoice_id === id)
      .map((h) => ({ ...h, from_user_name: userName(h.from_user_id), to_user_name: userName(h.to_user_id) })),
    Parts: doc.parts,
  };
}

async function requireInvoice(id) {
  const doc = await repo.getInvoice(id);
  if (!doc) throw new ProcError('Invoice not found.');
  return doc;
}

const PROCS = {
  async CreateInvoice(p, user) {
    if (!p.FileName) throw new ProcError('File name is required.');
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(p.MimeType)) {
      throw new ProcError('Only PDF, JPG, PNG, WEBP and GIF files are supported.');
    }
    const id = await repo.createInvoiceRecord(
      { filename: p.FileName, originalname: p.OriginalName || p.FileName, mimetype: p.MimeType, size: p.FileSize || null },
      p.RequestedProvider || 'auto', { splitMultiple: p.SplitMultiple });
    await audit(id, 'uploaded', user, { file: p.OriginalName || p.FileName, mime_type: p.MimeType, file_size: p.FileSize || null, tool: p.RequestedProvider || 'auto', split_if_merged: p.SplitMultiple });
    return { Result: [{ id, status: 'queued' }] };
  },
  async UpdateInvoiceStatus(p, user) {
    if (!STATUSES.includes(p.Status)) throw new ProcError('Invalid status.');
    const old = (await requireInvoice(p.InvoiceId)).invoice.status;
    const extra = { error: p.ErrorMessage || null };
    if (p.ExtractionMethod) extra.extraction_method = p.ExtractionMethod;
    if (p.RequestedProvider) extra.requested_provider = p.RequestedProvider;
    await repo.setStatus(p.InvoiceId, p.Status, extra);
    const now2 = (await repo.getInvoice(p.InvoiceId)).invoice;
    if (p.Status === 'queued' && old !== 'queued') await audit(p.InvoiceId, 'extraction_requested', user, { from_status: old, tool: now2.requested_provider });
    else if (p.Status === 'failed') await audit(p.InvoiceId, 'extraction_failed', user, { error: (p.ErrorMessage || '').slice(0, 1000), tool: now2.extraction_method });
    else if (!['processing', 'queued'].includes(p.Status) && p.Status !== old) await audit(p.InvoiceId, 'status_changed', user, { from_status: old, to_status: p.Status });
    return { Result: [{ id: p.InvoiceId, status: p.Status }] };
  },
  async SaveInvoiceExtraction(p, user) {
    await requireInvoice(p.InvoiceId);
    const before = await snapshot(p.InvoiceId);
    delete state.approvals[p.InvoiceId];   // new data: any approval assignment is cleared
    saveState();
    if (!['extracted', 'needs_review'].includes(p.Status)) throw new ProcError('Extraction status must be extracted or needs_review.');
    await repo.saveExtraction(p.InvoiceId, {
      data: parse(p.InvoiceJson, {}), issues: parse(p.ReviewNotesJson, []), confidence: p.Confidence < 0 ? null : p.Confidence,
      method: p.ExtractionMethod || null, raw: parse(p.RawJson, null), status: p.Status,
    });
    await audit(p.InvoiceId, 'extracted', user, { tool: p.ExtractionMethod || null, confidence: p.Confidence < 0 ? null : p.Confidence, result: p.Status,
      issue_count: parse(p.ReviewNotesJson, []).length, changes: changes(before, await snapshot(p.InvoiceId)) });
    return invoiceTables(p.InvoiceId);
  },
  async SaveInvoiceReview(p, user) {
    const doc = await requireInvoice(p.InvoiceId);
    const current = doc.invoice.status;
    if (['queued', 'processing'].includes(current)) throw new ProcError('Wait for extraction to finish before editing.');
    if (p.Approve && current === 'pending_approval' && approvalOf(p.InvoiceId).assigned_to !== user.user_id) throw new ProcError('This document is waiting for approval by another user.');
    if (p.Approve && state.settings.require_approver && !['approved', 'pending_approval'].includes(current)) {
      throw new ProcError('Self-approval is turned off for this agreement. Submit the document to an approver instead.');
    }
    const before = await snapshot(p.InvoiceId);
    await repo.saveReview(p.InvoiceId, parse(p.InvoiceJson, {}), { approve: p.Approve, issues: parse(p.ReviewNotesJson, []) });
    if (!p.Approve && current === 'pending_approval') await repo.setStatus(p.InvoiceId, 'pending_approval', {});
    const diff = changes(before, await snapshot(p.InvoiceId));
    if (p.Approve && current !== 'approved') await audit(p.InvoiceId, current === 'pending_approval' ? 'approved' : 'approved_directly', user, { changes: diff });
    else if (diff) await audit(p.InvoiceId, 'edited', user, { changes: diff });
    if (p.Approve && current !== 'approved') {
      state.approvals[p.InvoiceId] = { ...approvalOf(p.InvoiceId), approved_by: user.user_id };
      state.history.push({ id: state.nextId++, invoice_id: p.InvoiceId, action: current === 'pending_approval' ? 'approved' : 'approved_directly', from_user_id: user.user_id, to_user_id: null, comment: null, created_at: now() });
      markRead((n) => n.invoice_id === p.InvoiceId && n.type === 'approval_requested');
      saveState();
    }
    return invoiceTables(p.InvoiceId);
  },
  GetInvoice: (p) => invoiceTables(p.InvoiceId),
  async GetInvoiceList(p) {
    const rows = await repo.listInvoices({ search: p.Search, status: p.Status, supplierId: p.SupplierId || undefined, customerId: p.CustomerId || undefined, limit: p.Top || 200 });
    return { Invoices: rows.map(withApproval) };
  },
  async GetPendingInvoices() {
    const ids = await repo.getPendingInvoiceIds();
    return { Invoices: ids.map((id) => ({ id })) };
  },
  async DeleteInvoice(p, user) {
    const snap = await snapshot(p.InvoiceId);
    if (snap) await audit(p.InvoiceId, 'deleted', user, { file: (await repo.getInvoice(p.InvoiceId)).invoice.original_name, document: snap });
    const row = await repo.deleteInvoice(p.InvoiceId);
    if (!row) throw new ProcError('Invoice not found.');
    delete state.approvals[p.InvoiceId];
    state.history = state.history.filter((h) => h.invoice_id !== p.InvoiceId);
    state.notifications = state.notifications.filter((n) => n.invoice_id !== p.InvoiceId);
    saveState();
    return { Result: [{ id: p.InvoiceId, file_name: row.file_name, original_name: row.original_name || row.file_name }] };
  },
  async GetInvoiceExportLines(p, user) {
    const lines = await repo.exportLines();
    await audit(null, 'exported', user, { date_from: p.DateFrom || null, date_to: p.DateTo || null, rows: lines.length });
    return { Lines: lines };
  },
  GetInvoiceAuditTrail: (p) => auditList({ InvoiceId: p.InvoiceId, Top: 500 }),
  GetInvoiceAuditLog: (p) => auditList(p),
  async GetInvoiceStats() {
    const s = await repo.getStats();
    const customers = await repo.listCustomers();
    return {
      ByStatus: Object.entries(s.by_status).map(([status, count]) => ({ status, count })),
      Totals: [{ document_count: Object.values(s.by_status).reduce((a, b) => a + b, 0), total_amount: s.total_amount, tax_total: s.tax_total, supplier_count: s.supplier_count, customer_count: customers.length }],
      Currencies: s.currencies.map((currency) => ({ currency })),
    };
  },
  async GetSupplierList() { return { Suppliers: await repo.listSuppliers() }; },
  async GetCustomerList() { return { Customers: await repo.listCustomers() }; },
  async GetSupplier(p) {
    const found = await repo.getPartyWithInvoices('supplier', p.SupplierId);
    return found ? { Supplier: [found.party], Invoices: found.invoices } : { Supplier: [], Invoices: [] };
  },
  async GetCustomer(p) {
    const found = await repo.getPartyWithInvoices('customer', p.CustomerId);
    return found ? { Customer: [found.party], Invoices: found.invoices } : { Customer: [], Invoices: [] };
  },
  async UpdateSupplier(p) {
    if (!p.Name?.trim()) throw new ProcError('Supplier name is required.');
    if (!(await repo.getSupplier(p.SupplierId))) throw new ProcError('Supplier not found.');
    const row = await repo.updateParty('suppliers', p.SupplierId, {
      name: p.Name, address_line: p.AddressLine, city: p.City, postcode: p.Postcode, country: p.Country, phone: p.Phone,
      email: p.SupplierEmail, website: p.Website, vat_number: p.VatNumber, company_number: p.CompanyNumber,
    });
    return { Supplier: [row] };
  },
  async UpdateCustomer(p) {
    if (!p.Name?.trim()) throw new ProcError('Customer name is required.');
    if (!(await repo.getCustomer(p.CustomerId))) throw new ProcError('Customer not found.');
    const row = await repo.updateParty('customers', p.CustomerId, {
      name: p.Name, address_line: p.AddressLine, city: p.City, postcode: p.Postcode, country: p.Country, phone: p.Phone,
      email: p.CustomerEmail, vat_number: p.VatNumber, account_number: p.AccountNumber,
    });
    return { Customer: [row] };
  },

  // ---- version 2 -------------------------------------------------------------------
  InvoiceDeskLogin(_p, user) {
    state.seen[user.user_id] = now();
    saveState();
    return { User: [{ ...user, can_approve: true, name: user.display_name }] };
  },
  GetInvoiceApprovers(_p, user) {
    return { Approvers: USERS.filter((u) => u.user_id !== user.user_id && state.seen[u.user_id]).map((u) => ({ ...u, name: u.display_name })) };
  },
  async AssignInvoiceForApproval(p, user) {
    const doc = await requireInvoice(p.InvoiceId);
    const status = doc.invoice.status;
    if (!p.ApproverUserId || p.ApproverUserId <= 0) throw new ProcError('Choose an approver.');
    if (p.ApproverUserId === user.user_id) throw new ProcError('You cannot send a document to yourself for approval. Choose another user.');
    if (!['extracted', 'needs_review', 'rejected', 'pending_approval'].includes(status)) throw new ProcError('Only extracted, reviewed or rejected documents can be sent for approval.');
    const comment = p.Comment?.trim() || null;
    await repo.setStatus(p.InvoiceId, 'pending_approval', {});
    state.approvals[p.InvoiceId] = { assigned_to: p.ApproverUserId, assigned_by: user.user_id, assigned_at: now(), approval_comment: comment };
    state.history.push({ id: state.nextId++, invoice_id: p.InvoiceId, action: status === 'pending_approval' ? 'reassigned' : 'submitted', from_user_id: user.user_id, to_user_id: p.ApproverUserId, comment, created_at: now() });
    markRead((n) => n.invoice_id === p.InvoiceId && n.type === 'approval_requested');
    await audit(p.InvoiceId, status === 'pending_approval' ? 'reassigned' : 'submitted_for_approval', user,
      { to_user_id: p.ApproverUserId, to_user: userName(p.ApproverUserId), from_status: status, comment });
    notify(p.ApproverUserId, p.InvoiceId, 'approval_requested', `${user.display_name} asked you to approve ${label(doc)}${comment ? `: "${comment}"` : '.'}`, user.user_id);
    saveState();
    return invoiceTables(p.InvoiceId);
  },
  ApproveInvoice: (p, user) => decide(p, user, 'approve'),
  RejectInvoice: (p, user) => decide(p, user, 'reject'),
  ReturnInvoiceForReview: (p, user) => decide(p, user, 'return'),
  async GetMyPendingApprovals(_p, user) {
    const rows = await repo.listInvoices({ status: 'pending_approval', limit: 1000 });
    return { Invoices: rows.map(withApproval).filter((r) => r.assigned_to === user.user_id) };
  },
  async GetInvoiceNotifications(p, user) {
    const mine = state.notifications.filter((n) => n.user_id === user.user_id);
    const list = mine.filter((n) => !p.UnreadOnly || !n.is_read).sort((a, b) => b.id - a.id).slice(0, p.Top > 0 ? p.Top : 50);
    const invoices = await repo.listInvoices({ limit: 1000 });
    return {
      Notifications: list.map((n) => ({ ...n, created_by_name: userName(n.created_by), invoice_status: invoices.find((i) => i.id === n.invoice_id)?.status ?? null })),
      Summary: [{ unread_count: mine.filter((n) => !n.is_read).length,
        pending_approval_count: invoices.filter((i) => i.status === 'pending_approval' && approvalOf(i.id).assigned_to === user.user_id).length }],
    };
  },
  MarkInvoiceNotificationsRead(p, user) {
    const targets = state.notifications.filter((n) => n.user_id === user.user_id && !n.is_read && (!p.NotificationId || n.id === p.NotificationId));
    targets.forEach((n) => { n.is_read = true; });
    saveState();
    return { Result: [{ updated: targets.length }] };
  },
  GetExtractionSettings: () => describeSettings(),
  async SaveExtractionSettings(p, user) {
    const tool = CATALOG.find((x) => x.id === p.ProviderId);
    if (!tool) throw new ProcError(`Unknown extraction tool "${p.ProviderId}".`);
    let input;
    try { input = JSON.parse(p.SettingsJson || '{}'); } catch { input = null; }
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProcError('SettingsJson must be a JSON object of field names and values.');
    const values = { ...valuesOf(tool.id) };
    for (const [k, raw] of Object.entries(input)) {
      const field = tool.fields.find((f) => f.name === k);
      if (!field) throw new ProcError(`${tool.name} has no setting called "${k}".`);
      const v = raw == null ? '' : String(raw).trim();
      if (!v) { if (!field.secret) delete values[k]; continue; }   // blank secret keeps the stored one
      if ((k === 'endpoint' || k === 'base_url') && !/^https:\/\//i.test(v)) throw new ProcError(`${field.label} must start with https://`);
      if (k === 'region' && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(v)) throw new ProcError('Region should look like eu-west-2.');
      values[k] = v;
    }
    const changedFields = Object.keys({ ...valuesOf(tool.id), ...values }).filter((k) => valuesOf(tool.id)[k] !== values[k]);
    state.settings.values[tool.id] = values;
    Object.assign(state.settings, { updated_at: now(), updated_by: user.user_id });
    await audit(null, 'settings_changed', user, { change: 'tool_settings_saved', tool: tool.id, fields: changedFields });
    return describeSettings();
  },
  async RemoveExtractionSettings(p, user) {
    const tool = CATALOG.find((x) => x.id === p.ProviderId);
    if (!tool) throw new ProcError(`Unknown extraction tool "${p.ProviderId}".`);
    delete state.settings.values[tool.id];
    if (state.settings.default_provider === tool.id) state.settings.default_provider = null;
    Object.assign(state.settings, { updated_at: now(), updated_by: user.user_id });
    await audit(null, 'settings_changed', user, { change: 'tool_settings_removed', tool: tool.id });
    return describeSettings();
  },
  async SetDefaultExtractionProvider(p, user) {
    const id = !p.ProviderId || p.ProviderId === 'auto' ? null : p.ProviderId;
    if (id) {
      const tool = CATALOG.find((x) => x.id === id);
      if (!tool) throw new ProcError(`Unknown extraction tool "${p.ProviderId}".`);
      if (!isReady(tool)) throw new ProcError(`Set up ${tool.name} before making it the default.`);
    }
    Object.assign(state.settings, { default_provider: id, updated_at: now(), updated_by: user.user_id });
    await audit(null, 'settings_changed', user, { change: 'default_tool_changed', value: id || 'auto' });
    return describeSettings();
  },
  async SetInvoiceApprovalPolicy(p, user) {
    Object.assign(state.settings, { require_approver: p.RequireApprover, updated_at: now(), updated_by: user.user_id });
    await audit(null, 'settings_changed', user, { change: 'approval_policy_changed', value: p.RequireApprover ? 'approver required' : 'self-approval allowed' });
    return describeSettings();
  },
  async ExtractInvoiceDocument(p) {
    if (!p.FileBase64) throw new ProcError('No file was sent.');
    const bytes = Buffer.from(p.FileBase64, 'base64');
    if (!bytes.length) throw new ProcError('The file is empty.');
    const tool = resolveTool(p.ProviderId, p.MimeType);
    await new Promise((r) => setTimeout(r, 400));
    // The Northfield sample gets full sample data; other files are read with the basic text extractor.
    let raw = SAMPLE_RAW;
    const text = p.MimeType === 'application/pdf' ? (await pageTexts(bytes)).join('\n') : '';
    if (text && !text.includes('Northfield Office Supplies')) {
      const tmp = path.join(os.tmpdir(), `mock-asmx-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, bytes);
      try { raw = { ...(await new BasicTextExtractor().extract({ filePath: tmp, mimeType: p.MimeType })), confidence: 0.9 }; } finally { fs.unlinkSync(tmp); }
    }
    return { Result: [{ Status: 'Success', provider_id: tool.id, provider_name: tool.name, provider_kind: tool.kind,
      model: valuesOf(tool.id).model || tool.fields.find((f) => f.name === 'model')?.default_value || tool.name,
      raw_json: JSON.stringify(raw), invoice_id: p.InvoiceId, elapsed_ms: 400 }] };
  },
  // Stands in for an AI tool: reads page text, and reports the tool the real service would use.
  async DetectInvoiceDocuments(p) {
    const CAPABLE = ['claude', 'gemini', 'openai', 'azure-docintel'];
    const tool = [p.ProviderId, state.settings.default_provider, ...CAPABLE].map((id) => CATALOG.find((c) => c.id === id))
      .find((c) => c && CAPABLE.includes(c.id) && isReady(c));
    if (!tool) return { Documents: [], Result: [{ Status: 'Success', method: 'none', provider_name: null, message: 'No tool that can find separate documents is set up for this agreement.' }] };
    const docs = detectByText(await pageTexts(Buffer.from(p.FileBase64, 'base64')));
    return { Documents: docs.map((d) => ({ start_page: d.from, end_page: d.to, invoice_number: d.invoice_number, document_type: 'invoice' })),
      Result: [{ Status: 'Success', method: tool.id, provider_name: tool.name, message: null }] };
  },
  async SplitInvoice(p, user) {
    let parts;
    try { parts = JSON.parse(p.PartsJson); } catch { throw new ProcError('Parts must be a JSON array.'); }
    const before = await repo.getInvoice(p.InvoiceId);
    if (!before) throw new ProcError('Invoice not found.');
    if (parts.some((a, i) => parts.some((b, k) => k > i && a.page_from <= b.page_to && b.page_from <= a.page_to))) throw new ProcError('Two parts include the same page.');
    let created;
    try { created = await repo.splitInvoice(p.InvoiceId, parts, { pageCount: p.PageCount || null }); } catch (e) { throw new ProcError(e.message); }
    for (const c of created) {
      await audit(c.id, 'created_from_split', user, { parent_invoice_id: p.InvoiceId, parent_file: before.invoice.original_name,
        pages: c.page_to > c.page_from ? `${c.page_from}-${c.page_to}` : `${c.page_from}`, found_by: p.SplitMethod || null });
    }
    await audit(p.InvoiceId, 'split', user, { found_by: p.SplitMethod || null, page_count: p.PageCount || null,
      parts: created.map((c) => ({ invoice_id: c.id, pages: c.page_to > c.page_from ? `${c.page_from}-${c.page_to}` : `${c.page_from}` })) });
    return { Parts: created };
  },
};

async function decide(p, user, decision) {
  const doc = await requireInvoice(p.InvoiceId);
  const a = approvalOf(p.InvoiceId);
  if (doc.invoice.status !== 'pending_approval') throw new ProcError('This document is not waiting for approval.');
  if (a.assigned_to !== user.user_id) throw new ProcError('Only the assigned approver can approve, reject or return this document.');
  const comment = p.Comment?.trim() || null;
  if (decision !== 'approve' && !comment) throw new ProcError('Add a comment saying why the document is being rejected or sent back.');
  const action = { approve: 'approved', reject: 'rejected', return: 'returned' }[decision];
  if (decision === 'approve') await repo.saveReview(p.InvoiceId, await currentData(p.InvoiceId), { approve: true, issues: doc.invoice.review_notes });
  else await repo.setStatus(p.InvoiceId, decision === 'reject' ? 'rejected' : 'needs_review', {});
  state.approvals[p.InvoiceId] = { ...a, approval_comment: comment,
    approved_by: decision === 'approve' ? user.user_id : a.approved_by,
    assigned_to: decision === 'return' ? null : a.assigned_to,
    rejected_by: decision === 'reject' ? user.user_id : null, rejected_at: decision === 'reject' ? now() : null };
  state.history.push({ id: state.nextId++, invoice_id: p.InvoiceId, action, from_user_id: user.user_id, to_user_id: a.assigned_by, comment, created_at: now() });
  markRead((n) => n.invoice_id === p.InvoiceId && n.user_id === user.user_id);
  await audit(p.InvoiceId, { approve: 'approved', reject: 'rejected', return: 'returned_for_review' }[decision], user,
    { comment, submitted_by_user_id: a.assigned_by ?? null, submitted_by: userName(a.assigned_by) });
  const verb = { approve: ' approved ', reject: ' rejected ', return: ' sent ' }[decision];
  if (a.assigned_by && a.assigned_by !== user.user_id) {
    notify(a.assigned_by, p.InvoiceId, action, `${user.display_name}${verb}${label(doc)}${decision === 'return' ? ' back for review' : ''}${comment ? `: "${comment}"` : '.'}`, user.user_id);
  }
  saveState();
  return invoiceTables(p.InvoiceId);
}

/** The invoice's current data in the shape saveReview takes (used to approve without edits). */
async function currentData(id) {
  const d = await repo.getInvoice(id);
  const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o?.[k] ?? null]));
  return {
    document_type: d.invoice.document_type,
    supplier: d.supplier || {},
    customer: d.customer || {},
    invoice: pick(d.invoice, ['document_type', 'invoice_number', 'invoice_date', 'due_date', 'po_number', 'currency', 'payment_terms', 'payment_method', 'subtotal', 'discount_total', 'tax_total', 'shipping', 'total_amount', 'amount_paid', 'amount_due', 'notes']),
    taxes: d.taxes,
    line_items: d.line_items,
  };
}

// ---- HTTP -----------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '20mb' }));
export const calls = [];

app.post('/:service.asmx/Json_:method', async (req, res) => {
  const method = req.params.method;
  const body = req.body || {};
  calls.push(method);
  const problem = checkParams(method, body);
  if (problem) return res.status(500).json({ Message: problem, ExceptionType: 'System.InvalidOperationException' });
  const user = body.agrno === AGRNO && body.password === PASSWORD && USERS.find((u) => u.email === body.Email);
  if (!user) {
    return res.json({ d: '' });   // GetAccessToken failed -> UserId == -1 -> null DataSet -> ""
  }
  try {
    const tables = await PROCS[method](body, user);
    res.json({ d: JSON.stringify(tables) });
  } catch (err) {
    res.json({ d: JSON.stringify({ Result: [{ Status: 'Error', Message: err.message }] }) });
  }
});

app.listen(PORT, () => {
  console.log(`Mock web service on http://localhost:${PORT}/PracticeServices.asmx`);
  console.log(`  ${Object.keys(SIGNATURES).length} methods from ${csFiles.join(', ')}`);
  console.log(`  logins: agrno=${AGRNO} password=${PASSWORD} Email=${USERS.map((u) => u.email).join(' or ')}`);
  const missing = Object.keys(SIGNATURES).filter((m) => !PROCS[m]);
  if (missing.length) console.warn(`  not implemented in mock: ${missing.join(', ')}`);
});
