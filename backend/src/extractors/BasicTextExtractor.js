import fs from 'node:fs/promises';
import { extractText, getDocumentProxy } from 'unpdf';
import { ExtractionProvider } from './ExtractionProvider.js';
import { MIME } from './shared/helpers.js';

const AMOUNT = String.raw`[£$€₹]?\s*(-?[\d,]+(?:\.\d{1,2})?)`;

function match(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

async function extractBasic(filePath) {
  const buffer = await fs.readFile(filePath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  if (!text || text.trim().length < 20) {
    throw new Error('This PDF has no readable text (probably a scan). Choose an AI or OCR extraction tool to read scanned documents.');
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const currency = /£|GBP/.test(text) ? 'GBP' : /€|EUR/.test(text) ? 'EUR' : /₹|INR/.test(text) ? 'INR' : /\$|USD/.test(text) ? 'USD' : null;

  return {
    document_type: /receipt/i.test(text) ? 'receipt' : /credit\s*note/i.test(text) ? 'credit_note' : 'invoice',
    supplier: {
      name: lines[0] || null,
      email: match(text, [/([\w.+-]+@[\w-]+\.[\w.]+)/]),
      phone: match(text, [/(?:tel|phone|telephone|mob(?:ile)?)[.:\s]*([+\d][\d\s()-]{7,})/i]),
      vat_number: match(text, [/VAT\s*(?:reg(?:istration)?\.?\s*)?(?:no\.?|number|#)?[:\s]*([A-Z]{0,2}\s?[\d\s]{9,12})/i]),
    },
    customer: {},
    invoice: {
      invoice_number: match(text, [
        /invoice\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]*)/i,
        /receipt\s*(?:no\.?|number|#)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/]*)/i,
        /\binv[-\s]?#?\s*([A-Z0-9\-\/]{3,})/i,
      ]),
      invoice_date: match(text, [
        /(?:invoice\s*)?date\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
        /(?:invoice\s*)?date\s*[:\-]?\s*(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})/i,
        /(\d{4}-\d{2}-\d{2})/,
      ]),
      due_date: match(text, [/due\s*(?:date)?\s*[:\-]?\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i]),
      currency,
      subtotal: match(text, [new RegExp(String.raw`sub\s*-?\s*total[^\d\n£$€₹-]*${AMOUNT}`, 'i')]),
      tax_total: match(text, [new RegExp(String.raw`(?:total\s*)?\b(?:vat|tax|gst)\b(?!\s*reg)(?:\s*@?\s*[\d.]+\s*%)?[^\d\n£$€₹-]*[£$€₹]?\s*(-?[\d,]+\.\d{2})`, 'i')]),
      discount_total: match(text, [new RegExp(String.raw`discount[^\d\n£$€₹-]*${AMOUNT}`, 'i')]),
      total_amount: match(text, [
        new RegExp(String.raw`(?:grand\s*total|total\s*(?:due|payable|amount)|amount\s*due|balance\s*due)[^\d\n£$€₹-]*${AMOUNT}`, 'i'),
        new RegExp(String.raw`\btotal\b[^\d\n£$€₹-]*${AMOUNT}`, 'i'),
      ]),
    },
    taxes: [],
    line_items: [],
    confidence: 0.3,
    warnings: ['Read with basic text matching. Line items were not captured. Check every field.'],
  };
}

/** Regex matching on the PDF text layer. Free and offline, but only for text PDFs and header fields. */
export class BasicTextExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'basic',
      name: 'Basic text matching',
      vendor: 'Built in',
      kind: 'basic',
      description: 'Finds invoice number, dates and totals in a PDF\'s text layer using patterns. Free and runs offline.',
      notes: 'Cannot read scans or photos, and does not capture line items. Every document it reads is marked for review.',
      supportedMimeTypes: [MIME.pdf],
      capabilities: { lineItems: false, scans: false, handwriting: false, multiPage: true },
    });
  }

  async extract({ filePath }) {
    return extractBasic(filePath);
  }
}
