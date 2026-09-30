import { ExtractionProvider } from './ExtractionProvider.js';
import { average, emptyResult, fetchJson, first, MIME, oneLine, sleep } from './shared/helpers.js';

/** Azure AI Document Intelligence (formerly Form Recognizer) prebuilt invoice or receipt model, via REST. */
export class AzureDocumentIntelligenceExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'azure-docintel',
      name: 'Azure Document Intelligence',
      vendor: 'Microsoft Azure',
      kind: 'ocr',
      description: 'Microsoft\'s prebuilt invoice model. Returns structured supplier, customer, totals, tax and line items with confidence scores. Good fit if you already host on Azure.',
      notes: 'Set AZURE_DOCINTEL_MODEL to prebuilt-receipt for till receipts.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png],
      requiredEnv: ['AZURE_DOCINTEL_ENDPOINT', 'AZURE_DOCINTEL_KEY'],
      optionalEnv: { AZURE_DOCINTEL_MODEL: 'prebuilt-invoice', AZURE_DOCINTEL_API_VERSION: '2024-11-30' },
      capabilities: { lineItems: true, scans: true, handwriting: true, multiPage: true },
      docsUrl: 'https://learn.microsoft.com/azure/ai-services/document-intelligence/prebuilt/invoice',
    });
  }

  get modelName() { return process.env.AZURE_DOCINTEL_MODEL || 'prebuilt-invoice'; }

  async extract({ filePath }) {
    const endpoint = process.env.AZURE_DOCINTEL_ENDPOINT.replace(/\/$/, '');
    const version = process.env.AZURE_DOCINTEL_API_VERSION || '2024-11-30';
    const headers = { 'Ocp-Apim-Subscription-Key': process.env.AZURE_DOCINTEL_KEY };
    const url = `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(this.modelName)}:analyze?api-version=${version}`;

    const { headers: resHeaders } = await fetchJson(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Source: await this.readBase64(filePath) }),
    }, { service: 'Azure Document Intelligence' });

    const operation = resHeaders.get('operation-location');
    if (!operation) throw new Error('Azure Document Intelligence did not return an operation to poll.');

    const deadline = Date.now() + 3 * 60 * 1000;
    for (;;) {
      await sleep(1500);
      const { body } = await fetchJson(operation, { headers }, { service: 'Azure Document Intelligence' });
      if (body.status === 'succeeded') return mapAzureInvoice(body.analyzeResult, this.modelName);
      if (body.status === 'failed') {
        throw new Error(`Azure Document Intelligence failed: ${body.error?.message || 'unknown error'}`);
      }
      if (Date.now() > deadline) throw new Error('Azure Document Intelligence took longer than 3 minutes.');
    }
  }
}

const valueOf = (f) => {
  if (!f) return null;
  return first(f.valueString, f.valueDate, f.valueNumber, f.valueCurrency?.amount, f.valuePhoneNumber, f.valueInteger, f.content);
};
const addressOf = (f) => {
  const a = f?.valueAddress;
  if (a) {
    const street = [a.houseNumber, a.road].filter(Boolean).join(' ') || a.streetAddress || null;
    return {
      address_line: street || oneLine(f.content),
      city: a.city || null, postcode: a.postalCode || null, country: a.countryRegion || null,
    };
  }
  return { address_line: oneLine(f?.content) };
};

/** Convert an Azure analyzeResult (invoice or receipt model) into the common raw shape. Exported for testing. */
export function mapAzureInvoice(analyzeResult, model = 'prebuilt-invoice') {
  const doc = analyzeResult?.documents?.[0];
  if (!doc?.fields) throw new Error('Azure Document Intelligence found no invoice or receipt in this document.');
  const f = doc.fields;
  const pick = (...names) => names.map((n) => f[n]).find(Boolean);

  const out = emptyResult();
  out.supplier = {
    name: valueOf(pick('VendorName', 'MerchantName')),
    ...addressOf(pick('VendorAddress', 'MerchantAddress')),
    phone: valueOf(pick('VendorPhoneNumber', 'MerchantPhoneNumber')),
    vat_number: valueOf(pick('VendorTaxId', 'MerchantTaxId')),
  };
  out.customer = {
    name: valueOf(pick('CustomerName', 'BillingAddressRecipient')),
    ...addressOf(pick('CustomerAddress', 'BillingAddress')),
    vat_number: valueOf(f.CustomerTaxId),
    account_number: valueOf(f.CustomerId),
  };
  const totalField = pick('InvoiceTotal', 'Total');
  out.invoice = {
    invoice_number: valueOf(pick('InvoiceId', 'ReceiptId', 'TransactionId')),
    invoice_date: valueOf(pick('InvoiceDate', 'TransactionDate')),
    due_date: valueOf(f.DueDate),
    po_number: valueOf(f.PurchaseOrder),
    currency: first(totalField?.valueCurrency?.currencyCode, f.SubTotal?.valueCurrency?.currencyCode),
    payment_terms: valueOf(f.PaymentTerm),
    subtotal: valueOf(pick('SubTotal', 'Subtotal')),
    discount_total: valueOf(f.TotalDiscount),
    tax_total: valueOf(f.TotalTax),
    shipping: valueOf(pick('ShippingCost', 'FreightAmount')),
    total_amount: valueOf(totalField),
    amount_due: valueOf(f.AmountDue),
    amount_paid: valueOf(f.PaidAmount),
  };
  out.taxes = (f.TaxDetails?.valueArray || []).map((t) => {
    const o = t.valueObject || {};
    return { tax_name: 'Tax', rate: valueOf(o.Rate), taxable_amount: valueOf(o.NetAmount), tax_amount: valueOf(o.Amount) };
  });
  out.line_items = (f.Items?.valueArray || []).map((item) => {
    const o = item.valueObject || {};
    return {
      description: valueOf(o.Description),
      product_code: valueOf(o.ProductCode),
      quantity: valueOf(o.Quantity),
      unit: valueOf(o.Unit),
      unit_price: valueOf(o.UnitPrice || o.Price),
      tax_rate: valueOf(o.TaxRate),
      tax_amount: valueOf(o.Tax),
      net_amount: valueOf(o.Amount || o.TotalPrice),
    };
  });
  const conf = average(Object.values(f).map((x) => x?.confidence));
  out.confidence = first(doc.confidence, conf, 0.5);
  out.document_type = model.includes('receipt') || String(doc.docType || '').startsWith('receipt') ? 'receipt' : 'invoice';
  return out;
}
