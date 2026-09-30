import express from 'express';
import * as repo from '../services/repository.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function partyRouter(kind) {
  const table = kind === 'supplier' ? 'suppliers' : 'customers';
  const list = kind === 'supplier' ? repo.listSuppliers : repo.listCustomers;
  const router = express.Router();

  router.get('/', wrap(async (_req, res) => {
    const rows = await list();
    res.json(rows.map((r) => ({ ...r, invoice_count: Number(r.invoice_count), total_amount: Number(r.total_amount || 0) })));
  }));

  router.get('/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
    const found = await repo.getPartyWithInvoices(kind, id);
    if (!found) return res.status(404).json({ error: `${kind === 'supplier' ? 'Supplier' : 'Customer'} not found` });
    res.json({ [kind]: found.party, invoices: found.invoices });
  }));

  router.put('/:id', wrap(async (req, res) => {
    res.json(await repo.updateParty(table, Number(req.params.id), req.body));
  }));

  return router;
}

export const suppliersRouter = partyRouter('supplier');
export const customersRouter = partyRouter('customer');
