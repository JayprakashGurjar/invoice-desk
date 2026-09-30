import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { config } from './config.js';
import invoicesRouter from './routes/invoices.js';
import approvalsRouter from './routes/approvals.js';
import settingsRouter from './routes/settings.js';
import auditRouter from './routes/audit.js';
import { suppliersRouter, customersRouter } from './routes/parties.js';
import { backendName, capabilities, getStats, init as initData, ping as pingData } from './services/repository.js';
import { getExtractionCatalog } from './services/extractionCatalog.js';
import { resumePending, resumePendingFor } from './services/queue.js';
import { registry } from './extractors/ExtractorRegistry.js';
import { authenticate, authRouter, endSessionOnAuthError, requireUser, signInListeners } from './auth.js';

const app = express();
app.set('trust proxy', 'loopback');
// The React app is served from this origin (or proxied by Vite), so no cross-origin access is
// needed; CORS stays off so other sites can't call the API with a user's session cookie.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));

// Public: health check (no user data)
app.get('/api/health', async (_req, res) => {
  let data = { backend: backendName, ok: true };
  try {
    await pingData();
  } catch (err) {
    data = { backend: backendName, ok: false, error: err.message };
  }
  res.json({ ok: true, database: backendName, capabilities, data });
});

app.use('/api', authenticate);
app.use('/api/auth', authRouter);
app.use('/api', requireUser);

app.get('/api/extractors', async (_req, res, next) => { try { res.json(await getExtractionCatalog()); } catch (e) { next(e); } });
app.get('/api/stats', async (_req, res, next) => { try { res.json(await getStats()); } catch (e) { next(e); } });
app.use('/api', approvalsRouter);
app.use('/api', settingsRouter);
app.use('/api', auditRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/customers', customersRouter);
app.use('/api', endSessionOnAuthError);

// Serve the built React app in production (npm run build in /frontend).
const dist = path.resolve(config.root, '../frontend/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is larger than ${config.maxFileSizeMb} MB.` : err.message;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

try {
  await initData();
} catch (err) {
  console.error(`\nCannot start: ${err.message}\n`);
  process.exit(1);
}
if (!capabilities.remoteExtraction) await registry.init();
signInListeners.push((user) => resumePendingFor(user));
app.listen(config.port, () => {
  console.log(`InvoiceDesk API on http://localhost:${config.port}`);
  if (capabilities.remoteExtraction) {
    console.log(`Data and extraction: DocuSoft web service (${config.asmx.url})`);
    console.log('Users sign in with their DocuSoft login. Extraction keys are read from DS_AgreementTable by the web service.');
  } else {
    console.log(`Data: ${config.dbClient}${config.dbClient === 'sqlite' ? ` (${config.sqlitePath})` : ''} via Knex (single local user, no approvals)`);
    const ready = registry.list().filter((p) => p.isConfigured()).map((p) => p.id);
    const auto = registry.resolveAuto();
    console.log(`Extraction tools ready: ${ready.join(', ') || 'none'}`);
    console.log(`Default ("auto") tool: ${auto ? auto.name : 'none'}`);
  }
  resumePending({ remote: capabilities.remoteExtraction });
});
