/**
 * Page-level PDF helpers used to split a file that contains several invoices.
 * pdf-lib copies pages without re-rendering, so each part keeps the original quality.
 */
import { PDFDocument } from 'pdf-lib';
import { extractText, getDocumentProxy } from 'unpdf';

export async function pageCount(buffer) {
  try {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    return pdf.getPageCount();
  } catch {
    return null;   // damaged or encrypted: treat as one document
  }
}

/** Text of each page ('' for scanned pages). */
export async function pageTexts(buffer) {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    return Array.isArray(text) ? text : [String(text || '')];
  } catch {
    return [];
  }
}

/** ranges: [{ from, to }] (1-based, inclusive). Returns one PDF buffer per range. */
export async function splitPdf(buffer, ranges) {
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const parts = [];
  for (const { from, to } of ranges) {
    const out = await PDFDocument.create();
    const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
    (await out.copyPages(src, indices)).forEach((p) => out.addPage(p));
    parts.push(Buffer.from(await out.save()));
  }
  return parts;
}
