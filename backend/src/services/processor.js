import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { registry } from '../extractors/ExtractorRegistry.js';
import { normalizeExtraction } from './normalize.js';
import { capabilities, extractDocument, getInvoice, saveExtraction, setStatus } from './repository.js';
import { findDocuments, splitDocument } from './splitter.js';

/**
 * Web-service mode: the C# web service runs the extraction with the agreement's keys from
 * DS_AgreementTable and returns the raw result. Local mode: the Node extractors run it with
 * the keys in backend/.env. Either way the result is cleaned and checked here, then saved.
 */
async function extract(row) {
  const filePath = path.join(config.uploadDir, row.file_name);
  if (capabilities.remoteExtraction) {
    const buffer = await fs.readFile(filePath);
    const out = await extractDocument({
      invoiceId: row.id,
      provider: row.requested_provider || 'auto',
      buffer,
      mimeType: row.mime_type,
      fileName: row.original_name,
    });
    return { provider: { id: out.provider_id, kind: out.provider_kind }, raw: out.raw };
  }
  const provider = registry.resolve(row.requested_provider, row.mime_type);
  const raw = await provider.extract({ filePath, mimeType: row.mime_type, originalName: row.original_name });
  return { provider, raw };
}

export async function processInvoice(id) {
  const doc = await getInvoice(id);
  if (!doc) return;
  const row = doc.invoice;
  await setStatus(id, 'processing', { error: null });

  // A PDF holding several invoices is split into one document per invoice; each part is
  // then queued and extracted on its own. If looking for parts fails, extract it whole.
  if (row.mime_type === 'application/pdf' && row.split_requested && !row.parent_invoice_id) {
    try {
      const buffer = await fs.readFile(path.join(config.uploadDir, row.file_name));
      const found = await findDocuments(row, buffer);
      if (found.documents.length > 1) {
        const parts = await splitDocument(row, buffer, found.documents, { method: found.method, pages: found.pages });
        console.log(`[split] #${id} ${row.original_name}: ${found.pages} pages -> ${parts.length} documents (found by ${found.method})`);
        return;
      }
    } catch (err) {
      console.error(`[split] #${id} could not be split, extracting it as one document:`, err.message);
    }
  }

  let provider = null;
  try {
    const result = await extract(row);
    provider = result.provider;
    const { raw } = result;

    const { data, issues, confidence } = normalizeExtraction(raw);
    const needsReview = provider.kind === 'basic' || issues.length > 0 || confidence < config.reviewThreshold;

    await saveExtraction(id, {
      data, issues, confidence, raw,
      method: provider.id,
      status: needsReview ? 'needs_review' : 'extracted',
    });
    console.log(`[extract] #${id} ${row.original_name} via ${provider.id}: ${needsReview ? 'needs review' : 'extracted'} (${issues.length} issues)`);
  } catch (err) {
    const message = err?.error?.error?.message || err?.message || 'Extraction failed';
    const method = provider?.id ?? (row.requested_provider && row.requested_provider !== 'auto' ? row.requested_provider : null);
    console.error(`[extract] #${id} failed${method ? ` via ${method}` : ''}:`, message);
    await setStatus(id, 'failed', {
      error: String(message).slice(0, 2000),
      extraction_method: method,
    });
  }
}
