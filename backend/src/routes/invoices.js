import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { enqueue } from '../services/queue.js';
import { validateProvider } from '../services/extractionCatalog.js';
import { findDocuments, splitDocument } from '../services/splitter.js';
import { pageCount } from '../services/pdfPages.js';
import { validateRanges } from '../services/documentBoundaries.js';
import { normalizeExtraction } from '../services/normalize.js';
import * as repo from '../services/repository.js';

const router = express.Router();
fs.mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024, files: 25 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(Object.assign(new Error(`${file.originalname}: only PDF, JPG, PNG, WEBP and GIF files are supported.`), { status: 400 }));
  },
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return id;
};

router.post('/upload', upload.array('files', 25), wrap(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'No files received. Use the "files" field.' });
  let provider;
  try {
    // Optional form field "provider": auto (default) or a tool id from GET /api/extractors
    provider = await validateProvider(req.body?.provider);
  } catch (err) {
    req.files.forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
    throw err;
  }
  const created = [];
  for (let i = 0; i < req.files.length; i++) {
    const file = req.files[i];
    let id;
    try {
      // Optional form field "split": "0" keeps a multi-invoice PDF as one document.
      id = await repo.createInvoiceRecord(file, provider, { splitMultiple: req.body?.split !== '0' });
    } catch (err) {
      // Don't leave files on disk that no database row points to.
      req.files.slice(i).forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
      if (!created.length) throw err;
      return res.status(207).json({
        documents: created,
        error: `${created.length} of ${req.files.length} files were added. The rest failed: ${err.message}`,
      });
    }
    created.push({ id, original_name: file.originalname, status: 'queued', provider });
    enqueue(id);
  }
  res.status(201).json({ documents: created });
}));

router.get('/', wrap(async (req, res) => {
  res.json(await repo.listInvoices(req.query));
}));

router.get('/export/csv', wrap(async (_req, res) => {
  const rows = await repo.exportLines();
  const headers = rows.length ? Object.keys(rows[0]) : ['document_id'];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-lines-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + csv);
}));

router.get('/:id', wrap(async (req, res) => {
  const doc = await repo.getInvoice(idParam(req));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
}));

router.get('/:id/file', wrap(async (req, res) => {
  const doc = await repo.getInvoice(idParam(req));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const filePath = path.join(config.uploadDir, path.basename(doc.invoice.file_name));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing from storage' });
  res.setHeader('Content-Type', doc.invoice.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.invoice.original_name)}"`);
  fs.createReadStream(filePath).pipe(res);
}));

// Save reviewed data. Body: { supplier, customer, invoice, taxes, line_items, approve }
router.put('/:id', wrap(async (req, res) => {
  const id = idParam(req);
  const existing = await repo.getInvoice(id);
  if (!existing) return res.status(404).json({ error: 'Document not found' });
  if (['queued', 'processing'].includes(existing.invoice.status)) {
    return res.status(409).json({ error: 'Wait for extraction to finish before editing.' });
  }
  const body = req.body || {};
  // Reuse the normaliser so edited values get the same cleaning and checks.
  const { data, issues } = normalizeExtraction({
    document_type: body.invoice?.document_type,
    supplier: body.supplier, customer: body.customer, invoice: body.invoice,
    taxes: body.taxes || [], line_items: body.line_items || [], confidence: 1,
  });
  await repo.saveReview(id, data, { approve: Boolean(body.approve), issues });
  res.json(await repo.getInvoice(id));
}));

const SPLITTABLE = ['queued', 'extracted', 'needs_review', 'rejected', 'failed'];

// Pages in the file and where the separate documents seem to start (for the split dialog)
router.get('/:id/pages', wrap(async (req, res) => {
  const doc = await repo.getInvoice(idParam(req));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const row = doc.invoice;
  if (row.mime_type !== 'application/pdf') return res.json({ page_count: 1, method: null, documents: [{ from: 1, to: 1 }] });
  const buffer = await fs.promises.readFile(path.join(config.uploadDir, path.basename(row.file_name)));
  const found = await findDocuments(row, buffer);
  res.json({ page_count: found.pages, method: found.method, documents: found.documents });
}));

// Split into separate documents. Body: { parts: [{ from, to }, ...] } (pages, 1-based)
router.post('/:id/split', wrap(async (req, res) => {
  const doc = await repo.getInvoice(idParam(req));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  const row = doc.invoice;
  if (row.mime_type !== 'application/pdf') return res.status(400).json({ error: 'Only PDF files can be split.' });
  if (!SPLITTABLE.includes(row.status)) {
    return res.status(409).json({ error: row.status === 'processing' ? 'Wait for extraction to finish first.' : "This document can't be split: it is approved, waiting for approval, or already split." });
  }
  const buffer = await fs.promises.readFile(path.join(config.uploadDir, path.basename(row.file_name)));
  const pages = await pageCount(buffer);
  const parts = (req.body?.parts || []).map((p) => ({ from: Number(p.from), to: Number(p.to) }));
  const problem = validateRanges(parts, pages);
  if (problem) return res.status(400).json({ error: problem });
  const created = await splitDocument(row, buffer, parts, { method: 'manual', pages });
  res.json({ parts: created });
}));

router.post('/:id/reprocess', wrap(async (req, res) => {
  const id = idParam(req);
  const doc = await repo.getInvoice(id);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  // Optional body { provider } to re-read with a different tool.
  const provider = req.body?.provider
    ? await validateProvider(req.body.provider)
    : doc.invoice.requested_provider || 'auto';
  await repo.setStatus(id, 'queued', { error: null, requested_provider: provider });
  enqueue(id);
  res.json({ id, status: 'queued', provider });
}));

router.delete('/:id', wrap(async (req, res) => {
  const row = await repo.deleteInvoice(idParam(req));
  if (!row) return res.status(404).json({ error: 'Document not found' });
  fs.promises.unlink(path.join(config.uploadDir, path.basename(row.file_name))).catch(() => {});
  res.status(204).end();
}));

export default router;
