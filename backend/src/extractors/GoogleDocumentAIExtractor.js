import fs from 'node:fs/promises';
import { ExtractionProvider } from './ExtractionProvider.js';
import { average, emptyResult, first, MIME, oneLine } from './shared/helpers.js';

/**
 * Google Cloud Document AI with an Invoice Parser (or Expense Parser for receipts) processor.
 * Authenticate with a service account: set GOOGLE_APPLICATION_CREDENTIALS to its JSON key file,
 * or use Application Default Credentials (gcloud auth application-default login).
 */
export class GoogleDocumentAIExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'google-documentai',
      name: 'Google Document AI',
      vendor: 'Google Cloud',
      kind: 'ocr',
      description: 'Google Cloud\'s pretrained Invoice Parser. Strong on scanned invoices, returns normalised amounts and dates with confidence scores.',
      notes: 'Synchronous processing reads up to 15 pages per document. Create an Invoice Parser processor in the Google Cloud console first.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png, MIME.webp, MIME.gif],
      requiredEnv: ['GOOGLE_DOCAI_PROJECT_ID', 'GOOGLE_DOCAI_LOCATION', 'GOOGLE_DOCAI_PROCESSOR_ID'],
      optionalEnv: { GOOGLE_APPLICATION_CREDENTIALS: '(path to service account JSON, or use gcloud ADC)' },
      dependencies: ['@google-cloud/documentai'],
      capabilities: { lineItems: true, scans: true, handwriting: false, multiPage: true },
      docsUrl: 'https://cloud.google.com/document-ai/docs/processors-list#processor_invoice-processor',
    });
    this.client = null;
  }

  get modelName() { return 'Invoice Parser'; }

  async getClient() {
    if (this.client) return this.client;
    const mod = await import('@google-cloud/documentai');
    const lib = mod.default ?? mod;
    const Client = lib.v1?.DocumentProcessorServiceClient ?? lib.DocumentProcessorServiceClient;
    this.client = new Client({ apiEndpoint: `${process.env.GOOGLE_DOCAI_LOCATION}-documentai.googleapis.com` });
    return this.client;
  }

  async extract({ filePath, mimeType }) {
    const client = await this.getClient();
    const name = `projects/${process.env.GOOGLE_DOCAI_PROJECT_ID}/locations/${process.env.GOOGLE_DOCAI_LOCATION}/processors/${process.env.GOOGLE_DOCAI_PROCESSOR_ID}`;
    const content = (await fs.readFile(filePath)).toString('base64');
    const [result] = await client.processDocument({ name, rawDocument: { content, mimeType } });
    return mapDocumentAi(result.document);
  }
}

const moneyOf = (e) => {
  const mv = e?.normalizedValue?.moneyValue;
  if (mv && (mv.units !== undefined || mv.nanos !== undefined)) {
    return Number(String(mv.units ?? 0)) + (Number(mv.nanos) || 0) / 1e9;
  }
  return textOf(e);
};
const textOf = (e) => (e ? (e.normalizedValue?.text || e.mentionText || '').trim() || null : null);
const dateOf = (e) => {
  const d = e?.normalizedValue?.dateValue;
  if (d?.year && d?.month && d?.day) return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
  return textOf(e);
};
const addressOf = (e) => {
  const a = e?.normalizedValue?.addressValue;
  if (a && (a.addressLines?.length || a.locality)) {
    return { address_line: a.addressLines?.join(', ') || null, city: a.locality || null, postcode: a.postalCode || null, country: a.regionCode || null };
  }
  return { address_line: oneLine(e?.mentionText) };
};

/** Convert a Document AI Document into the common raw shape. Exported for testing. */
export function mapDocumentAi(document) {
  const entities = document?.entities || [];
  if (!entities.length) throw new Error('Google Document AI found no invoice fields. Check the processor is an Invoice or Expense Parser.');
  const one = (...types) => types.map((t) => entities.find((e) => e.type === t)).find(Boolean);
  const all = (t) => entities.filter((e) => e.type === t);
  const prop = (parent, t) => parent.properties?.find((p) => p.type === t);

  const out = emptyResult();
  out.supplier = {
    name: textOf(one('supplier_name')),
    ...addressOf(one('supplier_address')),
    phone: textOf(one('supplier_phone')),
    email: textOf(one('supplier_email')),
    website: textOf(one('supplier_website')),
    vat_number: textOf(one('supplier_tax_id')),
    company_number: textOf(one('supplier_registration')),
  };
  out.customer = {
    name: textOf(one('receiver_name', 'ship_to_name')),
    ...addressOf(one('receiver_address', 'ship_to_address')),
    phone: textOf(one('receiver_phone')),
    email: textOf(one('receiver_email')),
    vat_number: textOf(one('receiver_tax_id')),
  };
  const total = one('total_amount');
  out.invoice = {
    invoice_number: textOf(one('invoice_id', 'receipt_id')),
    invoice_date: dateOf(one('invoice_date', 'receipt_date', 'purchase_date')),
    due_date: dateOf(one('due_date')),
    po_number: textOf(one('purchase_order')),
    currency: first(textOf(one('currency')), total?.normalizedValue?.moneyValue?.currencyCode),
    payment_terms: textOf(one('payment_terms')),
    subtotal: moneyOf(one('net_amount')),
    tax_total: moneyOf(one('total_tax_amount')),
    shipping: moneyOf(one('freight_amount')),
    total_amount: moneyOf(total),
    amount_due: moneyOf(one('amount_due')),
    amount_paid: moneyOf(one('amount_paid_since_last_invoice')),
  };
  out.taxes = all('vat').map((v) => ({
    tax_name: 'VAT',
    rate: textOf(prop(v, 'vat/tax_rate')),
    taxable_amount: moneyOf(prop(v, 'vat/amount')),
    tax_amount: moneyOf(prop(v, 'vat/tax_amount')),
  }));
  out.line_items = all('line_item').map((li) => ({
    description: first(textOf(prop(li, 'line_item/description')), oneLine(li.mentionText)),
    product_code: textOf(prop(li, 'line_item/product_code')),
    quantity: textOf(prop(li, 'line_item/quantity')),
    unit: textOf(prop(li, 'line_item/unit')),
    unit_price: moneyOf(prop(li, 'line_item/unit_price')),
    net_amount: moneyOf(prop(li, 'line_item/amount')),
  }));
  const conf = average(entities.filter((e) => e.type !== 'line_item').map((e) => e.confidence));
  out.confidence = conf ?? 0.5;
  out.document_type = one('receipt_date', 'receipt_id') ? 'receipt' : 'invoice';
  return out;
}
