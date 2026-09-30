import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusStamp from '../components/StatusStamp.jsx';
import ToolSelect from '../components/ToolSelect.jsx';
import ApprovalPanel from '../components/ApprovalPanel.jsx';
import AuditEntries from '../components/AuditEntries.jsx';
import SplitPanel, { SplitParts } from '../components/SplitPanel.jsx';
import { useSession } from '../session.jsx';
import { toolName, useExtractors } from '../useExtractors.js';
import { money, fileSize, DOC_TYPES } from '../format.js';

const SUPPLIER_FIELDS = [
  ['name', 'Name', 'wide'], ['address_line', 'Address', 'wide'], ['city', 'Town or city'], ['postcode', 'Postcode'],
  ['country', 'Country'], ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'],
  ['vat_number', 'VAT number'], ['company_number', 'Company number'],
];
const CUSTOMER_FIELDS = [
  ['name', 'Name', 'wide'], ['address_line', 'Address', 'wide'], ['city', 'Town or city'], ['postcode', 'Postcode'],
  ['country', 'Country'], ['phone', 'Phone'], ['email', 'Email'], ['vat_number', 'VAT number'], ['account_number', 'Account number'],
];
const EMPTY_LINE = { description: '', product_code: '', quantity: '', unit: '', unit_price: '', tax_rate: '', net_amount: '', total_amount: '' };
const EMPTY_TAX = { tax_name: 'VAT', rate: '', taxable_amount: '', tax_amount: '' };

const DONE = { sent: 'Sent for approval.', approve: 'Approved.', reject: 'Rejected. The person who sent it has been told.', return: 'Sent back for review. The person who sent it has been told.' };

const toForm = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj?.[k] ?? '']));
const num = (v) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));

function Field({ label, value, onChange, type = 'text', wide, ...rest }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span className="field-label">{label}</span>
      <input className="input" type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest} />
    </label>
  );
}

export default function InvoiceReview() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const extractors = useExtractors();
  const { capabilities } = useSession();
  const [rerunTool, setRerunTool] = useState('auto');

  const hydrate = useCallback((d) => {
    setDoc(d);
    setForm({
      supplier: toForm(d.supplier, SUPPLIER_FIELDS.map((f) => f[0])),
      customer: toForm(d.customer, CUSTOMER_FIELDS.map((f) => f[0])),
      invoice: toForm(d.invoice, ['document_type', 'invoice_number', 'invoice_date', 'due_date', 'po_number', 'currency',
        'payment_terms', 'payment_method', 'subtotal', 'discount_total', 'tax_total', 'shipping', 'total_amount',
        'amount_paid', 'amount_due', 'notes']),
      taxes: d.taxes.map((t) => toForm(t, Object.keys(EMPTY_TAX))),
      line_items: d.line_items.map((l) => toForm(l, Object.keys(EMPTY_LINE))),
    });
    setRerunTool(d.invoice.requested_provider || 'auto');
    setDirty(false);
  }, []);

  const load = useCallback(() => api.getInvoice(id).then(hydrate).catch((e) => setError(e.message)), [id, hydrate]);
  useEffect(() => { load(); }, [load]);

  const busy = doc && (doc.invoice.status === 'queued' || doc.invoice.status === 'processing');
  const isSplit = doc?.invoice.status === 'split';
  const canSplit = doc && doc.invoice.mime_type === 'application/pdf' && !busy && doc.invoice.page_count !== 1
    && ['extracted', 'needs_review', 'rejected', 'failed'].includes(doc.invoice.status);
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [busy, load]);

  const set = (section, key) => (value) => {
    setForm((f) => ({ ...f, [section]: { ...f[section], [key]: value } }));
    setDirty(true);
  };
  const setRow = (section, idx, key) => (value) => {
    setForm((f) => {
      const rows = f[section].map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [key]: value };
        // Keep the net amount in step when quantity or unit price change.
        if (section === 'line_items' && (key === 'quantity' || key === 'unit_price')) {
          const q = num(next.quantity), p = num(next.unit_price);
          if (q !== null && p !== null) next.net_amount = String(Math.round(q * p * 100) / 100);
        }
        return next;
      });
      return { ...f, [section]: rows };
    });
    setDirty(true);
  };
  const addRow = (section, empty) => { setForm((f) => ({ ...f, [section]: [...f[section], { ...empty }] })); setDirty(true); };
  const removeRow = (section, idx) => { setForm((f) => ({ ...f, [section]: f[section].filter((_, i) => i !== idx) })); setDirty(true); };

  const check = useMemo(() => {
    if (!form) return null;
    const lines = form.line_items.reduce((a, l) => a + (num(l.net_amount) || 0), 0);
    const inv = form.invoice;
    const computed = (num(inv.subtotal) ?? lines) - (num(inv.discount_total) || 0) + (num(inv.tax_total) || 0) + (num(inv.shipping) || 0);
    const total = num(inv.total_amount);
    return {
      lines,
      linesMatch: !form.line_items.length || num(inv.subtotal) === null || Math.abs(lines - num(inv.subtotal)) <= 0.1,
      computed,
      totalMatch: total === null || Math.abs(computed - total) <= 0.1,
    };
  }, [form]);

  async function save(approve) {
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const d = await api.saveInvoice(id, { ...form, approve });
      hydrate(d);
      setNotice(approve ? 'Approved.' : 'Changes saved.');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  /** Save edits without approving (used before approval actions). */
  async function persist() {
    const d = await api.saveInvoice(id, { ...form, approve: false });
    hydrate(d);
    return d;
  }

  const onApprovalUpdated = useCallback((d, label) => { hydrate(d); setNotice(DONE[label] || null); }, [hydrate]);

  async function reprocess() {
    if (dirty && !window.confirm('Re-running extraction will replace your unsaved edits. Continue?')) return;
    try {
      await api.reprocess(id, rerunTool);
      setNotice(null);
      setError(null);
      load();
    } catch (e) { setError(e.message); }
  }

  async function remove() {
    if (!window.confirm('Delete this document and its extracted data? This cannot be undone.')) return;
    try { await api.deleteInvoice(id); navigate('/'); } catch (e) { setError(e.message); }
  }

  if (error && !doc) return <div className="page"><p className="alert alert-error">{error}</p><Link to="/">Back to inbox</Link></div>;
  if (!doc || !form) return <div className="page"><p className="empty">Loading document…</p></div>;

  const inv = doc.invoice;
  const cur = form.invoice.currency || 'GBP';
  const isImage = inv.mime_type.startsWith('image/');

  return (
    <div className="review">
      <section className="viewer" aria-label="Original document">
        <div className="viewer-head">
          <span className="viewer-name" title={inv.original_name}>{inv.original_name}</span>
          <span className="viewer-meta">{fileSize(inv.file_size)}</span>
          <a className="btn btn-quiet btn-sm" href={api.fileUrl(id)} target="_blank" rel="noreferrer">Open</a>
        </div>
        <div className="viewer-body">
          {isImage
            ? <img src={api.fileUrl(id)} alt={`Scan of ${inv.original_name}`} />
            : <iframe src={api.fileUrl(id)} title={inv.original_name} />}
        </div>
      </section>

      <section className="sheet" aria-label="Extracted data">
        <div className="sheet-head">
          <Link to="/" className="back">Inbox</Link>
          <div className="sheet-title">
            <h1>{form.supplier.name || 'Untitled document'}</h1>
            <StatusStamp status={inv.status} />
          </div>
          <div className="source">
            <p className="sheet-sub">
              {busy && `Reading with ${toolName(inv.requested_provider === 'auto' || !inv.requested_provider ? extractors?.auto_provider : inv.requested_provider, extractors) || 'the extraction tool'}`}
              {!busy && inv.status === 'failed' && inv.extraction_method && `${toolName(inv.extraction_method, extractors)} could not read this document`}
              {!busy && inv.status !== 'failed' && inv.extraction_method && `Read by ${toolName(inv.extraction_method, extractors)}`}
              {!busy && inv.status !== 'failed' && inv.confidence !== null && inv.confidence !== undefined && ` with ${Math.round(inv.confidence * 100)}% confidence`}
            </p>
            {inv.parent_invoice_id && (
              <p className="sheet-sub">
                {inv.page_to > inv.page_from ? `Pages ${inv.page_from}-${inv.page_to}` : `Page ${inv.page_from}`} of{' '}
                <Link to={`/invoices/${inv.parent_invoice_id}`}>{inv.parent_original_name || 'the merged file'}</Link>
              </p>
            )}
            {!isSplit && <span className="rerun">
              <label className="sr-only" htmlFor="rerun-tool">Extraction tool</label>
              <ToolSelect id="rerun-tool" extractors={extractors} value={rerunTool} onChange={setRerunTool} disabled={busy} />
              <button type="button" className="btn btn-quiet btn-sm" onClick={reprocess} disabled={busy}>Re-run extraction</button>
            </span>}
          </div>
        </div>

        {busy && <p className="alert alert-info">Reading this document. The fields will fill in automatically when it's done.</p>}
        {isSplit && <SplitParts doc={doc} />}
        {canSplit && <SplitPanel id={id} onSplit={(parts) => { setNotice(`Split into ${parts.length} documents. Each one is being read now.`); load(); }} />}
        {inv.status === 'failed' && (
          <div className="alert alert-error">
            <p><strong>Extraction failed.</strong> {inv.error}</p>
            <p>Re-run extraction with another tool above, or enter the details by hand and save.</p>
          </div>
        )}
        {inv.review_notes?.length > 0 && !['approved', 'failed'].includes(inv.status) && (
          <div className="alert alert-review">
            <p><strong>Check before approving</strong></p>
            <ul>{inv.review_notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          </div>
        )}
        {notice && <p className="alert alert-ok" role="status">{notice}</p>}
        {error && <p className="alert alert-error">{error}</p>}

        <fieldset disabled={busy || isSplit} className="sheet-form">
          <div className="block">
            <h2>Invoice</h2>
            <div className="grid">
              <label className="field">
                <span className="field-label">Document type</span>
                <select className="input" value={form.invoice.document_type || 'invoice'} onChange={(e) => set('invoice', 'document_type')(e.target.value)}>
                  {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <Field label="Invoice number" value={form.invoice.invoice_number} onChange={set('invoice', 'invoice_number')} />
              <Field label="Invoice date" type="date" value={form.invoice.invoice_date} onChange={set('invoice', 'invoice_date')} />
              <Field label="Due date" type="date" value={form.invoice.due_date} onChange={set('invoice', 'due_date')} />
              <Field label="PO number" value={form.invoice.po_number} onChange={set('invoice', 'po_number')} />
              <Field label="Currency" value={form.invoice.currency} maxLength={3} onChange={(v) => set('invoice', 'currency')(v.toUpperCase())} />
              <Field label="Payment terms" value={form.invoice.payment_terms} onChange={set('invoice', 'payment_terms')} />
              <Field label="Payment method" value={form.invoice.payment_method} onChange={set('invoice', 'payment_method')} />
            </div>
          </div>

          <div className="block">
            <h2>Supplier</h2>
            <div className="grid">
              {SUPPLIER_FIELDS.map(([k, l, w]) => <Field key={k} label={l} wide={w} value={form.supplier[k]} onChange={set('supplier', k)} />)}
            </div>
          </div>

          <div className="block">
            <h2>Customer</h2>
            <div className="grid">
              {CUSTOMER_FIELDS.map(([k, l, w]) => <Field key={k} label={l} wide={w} value={form.customer[k]} onChange={set('customer', k)} />)}
            </div>
          </div>

          <div className="block">
            <div className="block-head">
              <h2>Line items</h2>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => addRow('line_items', EMPTY_LINE)}>Add line</button>
            </div>
            {form.line_items.length === 0 ? (
              <p className="muted">No line items. Add them if you need item-level detail.</p>
            ) : (
              <div className="table-wrap">
                <table className="lines">
                  <thead>
                    <tr>
                      <th className="col-desc">Description</th>
                      <th>Code</th>
                      <th className="num">Qty</th>
                      <th>Unit</th>
                      <th className="num">Unit price</th>
                      <th className="num">Tax %</th>
                      <th className="num">Net</th>
                      <th className="num">Gross</th>
                      <th><span className="sr-only">Remove</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.line_items.map((l, i) => (
                      <tr key={i}>
                        <td className="col-desc"><input className="input" aria-label={`Line ${i + 1} description`} value={l.description} onChange={(e) => setRow('line_items', i, 'description')(e.target.value)} /></td>
                        <td><input className="input w-code" aria-label={`Line ${i + 1} code`} value={l.product_code} onChange={(e) => setRow('line_items', i, 'product_code')(e.target.value)} /></td>
                        <td><input className="input num w-num" inputMode="decimal" aria-label={`Line ${i + 1} quantity`} value={l.quantity} onChange={(e) => setRow('line_items', i, 'quantity')(e.target.value)} /></td>
                        <td><input className="input w-unit" aria-label={`Line ${i + 1} unit`} value={l.unit} onChange={(e) => setRow('line_items', i, 'unit')(e.target.value)} /></td>
                        <td><input className="input num w-money" inputMode="decimal" aria-label={`Line ${i + 1} unit price`} value={l.unit_price} onChange={(e) => setRow('line_items', i, 'unit_price')(e.target.value)} /></td>
                        <td><input className="input num w-num" inputMode="decimal" aria-label={`Line ${i + 1} tax rate`} value={l.tax_rate} onChange={(e) => setRow('line_items', i, 'tax_rate')(e.target.value)} /></td>
                        <td><input className="input num w-money" inputMode="decimal" aria-label={`Line ${i + 1} net amount`} value={l.net_amount} onChange={(e) => setRow('line_items', i, 'net_amount')(e.target.value)} /></td>
                        <td><input className="input num w-money" inputMode="decimal" aria-label={`Line ${i + 1} gross amount`} value={l.total_amount} onChange={(e) => setRow('line_items', i, 'total_amount')(e.target.value)} /></td>
                        <td><button type="button" className="icon-btn" aria-label={`Remove line ${i + 1}`} onClick={() => removeRow('line_items', i)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="block">
            <div className="block-head">
              <h2>Tax breakdown</h2>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => addRow('taxes', EMPTY_TAX)}>Add rate</button>
            </div>
            {form.taxes.length === 0 ? <p className="muted">No tax breakdown on this document.</p> : (
              <div className="table-wrap">
                <table className="lines">
                  <thead><tr><th>Tax</th><th className="num">Rate %</th><th className="num">Taxable amount</th><th className="num">Tax amount</th><th><span className="sr-only">Remove</span></th></tr></thead>
                  <tbody>
                    {form.taxes.map((t, i) => (
                      <tr key={i}>
                        <td><input className="input" aria-label="Tax name" value={t.tax_name} onChange={(e) => setRow('taxes', i, 'tax_name')(e.target.value)} /></td>
                        <td><input className="input num w-num" inputMode="decimal" aria-label="Tax rate" value={t.rate} onChange={(e) => setRow('taxes', i, 'rate')(e.target.value)} /></td>
                        <td><input className="input num w-money" inputMode="decimal" aria-label="Taxable amount" value={t.taxable_amount} onChange={(e) => setRow('taxes', i, 'taxable_amount')(e.target.value)} /></td>
                        <td><input className="input num w-money" inputMode="decimal" aria-label="Tax amount" value={t.tax_amount} onChange={(e) => setRow('taxes', i, 'tax_amount')(e.target.value)} /></td>
                        <td><button type="button" className="icon-btn" aria-label={`Remove tax rate ${i + 1}`} onClick={() => removeRow('taxes', i)}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="block">
            <h2>Totals</h2>
            <div className="totals">
              <div className="grid grid-totals">
                <Field label="Subtotal" inputMode="decimal" value={form.invoice.subtotal} onChange={set('invoice', 'subtotal')} className="input num" />
                <Field label="Discount" inputMode="decimal" value={form.invoice.discount_total} onChange={set('invoice', 'discount_total')} className="input num" />
                <Field label="Tax" inputMode="decimal" value={form.invoice.tax_total} onChange={set('invoice', 'tax_total')} className="input num" />
                <Field label="Shipping" inputMode="decimal" value={form.invoice.shipping} onChange={set('invoice', 'shipping')} className="input num" />
                <Field label="Total" inputMode="decimal" value={form.invoice.total_amount} onChange={set('invoice', 'total_amount')} className="input num input-total" />
                <Field label="Amount paid" inputMode="decimal" value={form.invoice.amount_paid} onChange={set('invoice', 'amount_paid')} className="input num" />
                <Field label="Amount due" inputMode="decimal" value={form.invoice.amount_due} onChange={set('invoice', 'amount_due')} className="input num" />
              </div>
              <div className="check" aria-live="polite">
                <div className={check.linesMatch ? 'check-ok' : 'check-bad'}>
                  <span>Line items</span><span className="num">{money(check.lines, cur)}</span>
                </div>
                <div className={check.totalMatch ? 'check-ok' : 'check-bad'}>
                  <span>Calculated total</span><span className="num">{money(check.computed, cur)}</span>
                </div>
                <p className="check-verdict">
                  {check.linesMatch && check.totalMatch ? 'The figures add up.' : "The figures don't add up. Compare them with the document."}
                </p>
              </div>
            </div>
            <label className="field field-wide notes">
              <span className="field-label">Notes</span>
              <textarea className="input" rows={3} value={form.invoice.notes} onChange={(e) => set('invoice', 'notes')(e.target.value)} />
            </label>
          </div>
        </fieldset>

        {!busy && !isSplit && inv.status !== 'failed' && (
          <ApprovalPanel doc={doc} dirty={dirty} busy={saving || busy} persist={persist} onUpdated={onApprovalUpdated} onError={setError} />
        )}

        {capabilities.audit && <Activity id={id} version={`${inv.updated_at}|${inv.status}`} />}

        <div className="actionbar">
          <button type="button" className="btn btn-danger-quiet" onClick={remove}>Delete</button>
          <span className="spacer" />
          {dirty && <span className="unsaved">Unsaved changes</span>}
          {!isSplit && <button type="button" className="btn btn-quiet" onClick={() => save(false)} disabled={saving || busy || !dirty}>Save changes</button>}
          {inv.status === 'approved' ? (
            <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={saving || busy || !dirty}>Save and keep approved</button>
          ) : !isSplit && inv.status !== 'pending_approval' && !(capabilities.approvals && extractors?.require_approver) && (
            <button type="button" className="btn btn-primary" onClick={() => save(true)} disabled={saving || busy}>Approve</button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Audit trail of this document, reloaded whenever the document changes. */
function Activity({ id, version }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!open) return;
    api.auditTrail(id).then(setData).catch((e) => setError(e.message));
  }, [open, id, version]);
  return (
    <details className="block activity" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary><h2>Activity</h2><span className="muted">Everything done to this document</span></summary>
      {error && <p className="alert alert-error">{error}</p>}
      {open && !data && !error && <p className="muted">Loading…</p>}
      {data && (data.entries.length ? <AuditEntries entries={data.entries} /> : <p className="muted">No activity recorded yet.</p>)}
    </details>
  );
}
