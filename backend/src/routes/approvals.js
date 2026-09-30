import express from 'express';
import * as repo from '../services/repository.js';

/** Approval workflow and notifications (DATA_BACKEND=asmx). Mounted at /api. */
const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('Invalid id'), { status: 400 });
  return id;
};
const text = (v, max) => String(v ?? '').trim().slice(0, max);

// Documents waiting for my approval
router.get('/approvals', wrap(async (_req, res) => {
  res.json(await repo.listMyApprovals());
}));

// People I can send a document to (never includes me)
router.get('/approvals/approvers', wrap(async (_req, res) => {
  res.json(await repo.getApprovers());
}));

// Send a document to another user for approval. Body: { approverUserId, comment }
router.post('/invoices/:id/assign', wrap(async (req, res) => {
  const id = idParam(req);
  const approver = Number(req.body?.approverUserId);
  if (!Number.isInteger(approver) || approver <= 0) return res.status(400).json({ error: 'Choose an approver.' });
  if (approver === Number(req.user.userId)) return res.status(400).json({ error: 'You cannot send a document to yourself for approval. Choose another user.' });
  const doc = await repo.assignInvoice(id, approver, text(req.body?.comment, 1000));
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
}));

// The assigned approver decides. Body: { decision: approve | reject | return, comment }
router.post('/invoices/:id/decision', wrap(async (req, res) => {
  const id = idParam(req);
  const decision = String(req.body?.decision || '');
  if (!['approve', 'reject', 'return'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve, reject or return.' });
  const comment = text(req.body?.comment, 1000);
  if (decision !== 'approve' && !comment) return res.status(400).json({ error: 'Add a comment saying why the document is being rejected or sent back.' });
  const doc = await repo.decideInvoice(id, decision, comment);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  res.json(doc);
}));

// My notifications. Query: unread=1, top=30
router.get('/notifications', wrap(async (req, res) => {
  const top = Math.min(Math.max(Number(req.query.top) || 30, 1), 200);
  res.json(await repo.getNotifications({ unreadOnly: req.query.unread === '1', top }));
}));

// Mark read. Body: { id } or {} for all
router.post('/notifications/read', wrap(async (req, res) => {
  const id = Number(req.body?.id) || 0;
  res.json({ updated: await repo.markNotificationsRead(id) });
}));

export default router;
