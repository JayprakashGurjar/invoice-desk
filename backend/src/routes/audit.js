import express from 'express';
import * as repo from '../services/repository.js';

/**
 * Audit trail (DATA_BACKEND=asmx). Entries are written by the stored procedures in the same
 * transaction as each operation, so this API can only read them. Mounted at /api.
 */
const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function filters(q) {
  const date = (v, name) => {
    if (!v) return '';
    if (!DATE.test(v)) throw Object.assign(new Error(`${name} must be a date like 2026-09-01.`), { status: 400 });
    return v;
  };
  return {
    from: date(q.from, 'from'),
    to: date(q.to, 'to'),
    action: /^[a-z_]{0,40}$/.test(q.action || '') ? q.action || '' : '',
    userId: Number(q.user) || 0,
    search: String(q.search || '').slice(0, 200),
  };
}

router.get('/invoices/:id/audit', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  res.json(await repo.getAuditTrail(id));
}));

// Query: from, to, action, user, search, top (max 500), before (id for the next page)
router.get('/audit', wrap(async (req, res) => {
  const top = Math.min(Math.max(Number(req.query.top) || 100, 1), 500);
  res.json(await repo.getAuditLog({ ...filters(req.query), top, beforeId: Number(req.query.before) || 0 }));
}));

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Also defuse spreadsheet formulas in exported text.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// Same filters; up to 20,000 entries as CSV
router.get('/audit/export.csv', wrap(async (req, res) => {
  const f = filters(req.query);
  const rows = [];
  let before = 0;
  while (rows.length < 20000) {
    const page = await repo.getAuditLog({ ...f, top: 2000, beforeId: before });
    rows.push(...page.entries);
    if (page.entries.length < 2000) break;
    before = page.entries[page.entries.length - 1].id;
  }
  const head = ['id', 'time_utc', 'action', 'user', 'user_id', 'document_id', 'document', 'supplier', 'document_type', 'details'];
  const lines = [head.join(',')].concat(rows.map((e) => [e.id, e.created_at, e.action, e.user_name, e.user_id, e.invoice_id,
    e.document_label, e.supplier_name, e.document_type, e.details].map(csvCell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="invoicedesk-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}\r\n`);
}));

export default router;
