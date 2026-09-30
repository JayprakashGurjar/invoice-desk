/**
 * Merged files: find the separate invoices / receipts in a PDF and split it into one
 * document per part. Used automatically after upload (if "split" was ticked) and by the
 * manual "Split this document" action.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { capabilities, detectDocuments, splitInvoice } from './repository.js';
import { pageCount, pageTexts, splitPdf } from './pdfPages.js';
import { coverAllPages, detectByText } from './documentBoundaries.js';
import { enqueue } from './queue.js';

/**
 * Returns { pages, method, documents: [{ from, to, invoice_number?, supplier_name?, total_amount? }] }.
 * method: the tool that found them (web-service mode), "text", or null when there's nothing to split.
 */
export async function findDocuments(row, buffer) {
  const pages = await pageCount(buffer);
  if (!pages || pages < 2) return { pages: pages || 1, method: null, documents: [{ from: 1, to: pages || 1 }] };

  let docs = [];
  let method = null;
  if (capabilities.remoteExtraction) {
    try {
      const found = await detectDocuments({ invoiceId: row.id, provider: row.requested_provider, buffer, fileName: row.original_name, pageCount: pages });
      if (found.method !== 'none' && found.documents.length) { docs = found.documents; method = found.method; }
    } catch (err) {
      console.warn(`[split] #${row.id}: the web service could not look for separate documents (${err.message}); using page text`);
    }
  }
  if (!docs.length) {
    const texts = await pageTexts(buffer);
    if (texts.some((t) => t.trim())) { docs = detectByText(texts); method = 'text'; }
  }
  if (!docs.length) return { pages, method: null, documents: [{ from: 1, to: pages }] };
  return { pages, method, documents: coverAllPages(docs, pages) };
}

/** Save one PDF per range, record the parts, and queue each part for extraction. */
export async function splitDocument(row, buffer, ranges, { method, pages }) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const buffers = await splitPdf(buffer, sorted);
  const files = [];
  try {
    for (const [i, part] of buffers.entries()) {
      const r = sorted[i];
      const fileName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-p${r.from}${r.to > r.from ? `-${r.to}` : ''}.pdf`;
      await fs.writeFile(path.join(config.uploadDir, fileName), part);
      files.push({ file_name: fileName, file_size: part.length, page_from: r.from, page_to: r.to });
    }
    const children = await splitInvoice(row.id, files, { pageCount: pages, method });
    children.forEach((c) => enqueue(c.id));
    return children;
  } catch (err) {
    await Promise.all(files.map((f) => fs.unlink(path.join(config.uploadDir, f.file_name)).catch(() => {})));
    throw err;
  }
}
