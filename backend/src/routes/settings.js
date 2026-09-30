import express from 'express';
import * as repo from '../services/repository.js';
import { getExtractionCatalog } from '../services/extractionCatalog.js';

/**
 * Extraction tools and their keys (DATA_BACKEND=asmx). Keys are sent once to the web service,
 * which encrypts them into DS_AgreementTable; reads only ever return masked values.
 * Mounted at /api.
 */
const router = express.Router();
const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const PROVIDER = /^[a-z0-9-]{2,30}$/;
const providerParam = (req) => {
  const id = String(req.params.provider || '').toLowerCase();
  if (!PROVIDER.test(id)) throw Object.assign(new Error('Invalid extraction tool.'), { status: 400 });
  return id;
};

// Same data as GET /api/extractors (the tool pickers use that one)
router.get('/extraction-settings', wrap(async (_req, res) => {
  res.json(await getExtractionCatalog());
}));

// Body: { settings: { field: value } }. A blank secret keeps the stored one.
router.put('/extraction-settings/:provider', wrap(async (req, res) => {
  const settings = req.body?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'Send { settings: { field: value } }.' });
  }
  const clean = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!/^[a-z_]{2,40}$/.test(k)) return res.status(400).json({ error: `Invalid setting name "${k}".` });
    clean[k] = v === null || v === undefined ? '' : String(v);
  }
  res.json(await repo.saveExtractionSettings(providerParam(req), clean));
}));

router.delete('/extraction-settings/:provider', wrap(async (req, res) => {
  res.json(await repo.removeExtractionSettings(providerParam(req)));
}));

// Body: { provider } ("auto" = first ready tool)
router.put('/extraction-default', wrap(async (req, res) => {
  const id = String(req.body?.provider || 'auto').toLowerCase();
  if (id !== 'auto' && !PROVIDER.test(id)) return res.status(400).json({ error: 'Invalid extraction tool.' });
  res.json(await repo.setDefaultExtractionProvider(id));
}));

// Body: { require_approver: true | false }
router.put('/approval-policy', wrap(async (req, res) => {
  if (typeof req.body?.require_approver !== 'boolean') return res.status(400).json({ error: 'Send { require_approver: true | false }.' });
  res.json(await repo.setApprovalPolicy(req.body.require_approver));
}));

export default router;
