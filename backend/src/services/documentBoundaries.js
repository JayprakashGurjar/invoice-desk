/**
 * Where each document starts in a PDF that may hold several invoices or receipts.
 *
 * detectByText() works on the text of each page (text PDFs only): a page starts a new
 * document when it says "Page 1 of ..", or shows an invoice / receipt number different from
 * the current document's, unless it says "Page 2 of ..", "continued" and similar.
 * The AI tools (web-service mode) give better results and also handle scans; see processor.js.
 */

const NUMBER_PATTERNS = [
  /\b(?:tax\s+)?invoice\s*(?:no\.?|number|num|#|ref(?:erence)?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/i,
  /\b(?:receipt|credit\s+note|document)\s*(?:no\.?|number|#)\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/i,
  /\binvoice\s*[:#]\s*([A-Z0-9][A-Z0-9\-\/.]{2,})/i,
];
const FIRST_PAGE = /\bpage\s*1\s*(?:of|\/)\s*\d+/i;
const LATER_PAGE = /\bpage\s*(?:[2-9]|\d{2,})\s*(?:of|\/)\s*\d+|\bcontinued\s+from\b|\(continued\)/i;

export function invoiceNumberOf(text) {
  for (const re of NUMBER_PATTERNS) {
    const m = text.match(re);
    if (m && /\d/.test(m[1])) return m[1].replace(/[.\/-]+$/, '').toUpperCase();
  }
  return null;
}

/** Returns [{ from, to, invoice_number }] (1-based pages). */
export function detectByText(texts) {
  const docs = [];
  texts.forEach((raw, i) => {
    const text = String(raw || '');
    const number = invoiceNumberOf(text);
    const current = docs[docs.length - 1];
    const starts = !current
      || FIRST_PAGE.test(text)
      || (!LATER_PAGE.test(text) && number && current.invoice_number && number !== current.invoice_number);
    // A page with no number (cover letter, remittance slip, continuation) stays with the current document.
    if (starts) docs.push({ from: i + 1, to: i + 1, invoice_number: number });
    else {
      current.to = i + 1;
      current.invoice_number ||= number;
    }
  });
  return docs;
}

/**
 * Tidy detected documents into ranges that cover every page once, in order.
 * Pages before the first detected start join the first document; a gap joins the one before.
 */
export function coverAllPages(docs, pages) {
  const starts = [...new Set(docs.map((d) => Math.trunc(Number(d.from))).filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  if (!starts.length || starts[0] !== 1) starts.unshift(1);
  return starts.map((from, i) => {
    const to = i + 1 < starts.length ? starts[i + 1] - 1 : pages;
    const info = docs.find((d) => Number(d.from) === from) || {};
    return { ...info, from, to };
  });
}

/** Check ranges chosen by a person: in bounds, whole numbers, not overlapping. */
export function validateRanges(ranges, pages) {
  if (!Array.isArray(ranges) || ranges.length < 2) return 'Choose at least two parts.';
  const sorted = ranges.map((r) => ({ from: Number(r.from), to: Number(r.to) })).sort((a, b) => a.from - b.from);
  for (const [i, r] of sorted.entries()) {
    if (!Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 1 || r.to < r.from) return 'Each part needs a first and last page, like 1-2.';
    if (pages && r.to > pages) return `This file has only ${pages} page${pages === 1 ? '' : 's'}.`;
    if (i > 0 && r.from <= sorted[i - 1].to) return `Pages ${r.from}-${Math.min(r.to, sorted[i - 1].to)} are in two parts.`;
  }
  return null;
}
