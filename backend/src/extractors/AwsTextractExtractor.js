import fs from 'node:fs/promises';
import path from 'node:path';
import { ExtractionProvider } from './ExtractionProvider.js';
import { average, emptyResult, findEmail, first, MIME, oneLine, rateFromLabel, sleep } from './shared/helpers.js';

/**
 * AWS Textract AnalyzeExpense.
 * Images and single-page PDFs are sent directly. Multi-page PDFs need an S3 bucket
 * (TEXTRACT_S3_BUCKET) because AWS only analyses those asynchronously from S3.
 * Credentials come from the standard AWS chain: env vars, ~/.aws profile, or an IAM role.
 */
export class AwsTextractExtractor extends ExtractionProvider {
  constructor() {
    super({
      id: 'aws-textract',
      name: 'AWS Textract',
      vendor: 'Amazon Web Services',
      kind: 'ocr',
      description: 'Amazon\'s invoice and receipt OCR (AnalyzeExpense). Reliable on scans and photos, and returns per-field confidence scores.',
      notes: 'Does not return units of measure or per-line tax rates. Multi-page PDFs need TEXTRACT_S3_BUCKET.',
      supportedMimeTypes: [MIME.pdf, MIME.jpeg, MIME.png],
      requiredEnv: ['AWS_REGION'],
      optionalEnv: {
        AWS_ACCESS_KEY_ID: '(from AWS profile or IAM role)',
        AWS_SECRET_ACCESS_KEY: '(from AWS profile or IAM role)',
        TEXTRACT_S3_BUCKET: '(needed for multi-page PDFs)',
        TEXTRACT_S3_PREFIX: 'invoicedesk/',
      },
      capabilities: { lineItems: true, scans: true, handwriting: false, multiPage: true },
      docsUrl: 'https://docs.aws.amazon.com/textract/latest/dg/invoices-receipts.html',
    });
  }

  get dependencies() {
    return process.env.TEXTRACT_S3_BUCKET
      ? ['@aws-sdk/client-textract', '@aws-sdk/client-s3']
      : ['@aws-sdk/client-textract'];
  }
  set dependencies(_v) { /* computed from env */ }

  get modelName() { return 'AnalyzeExpense'; }

  async extract({ filePath, mimeType, originalName }) {
    const textract = await import('@aws-sdk/client-textract');
    const client = new textract.TextractClient({ region: process.env.AWS_REGION });
    const bytes = await fs.readFile(filePath);
    const bucket = process.env.TEXTRACT_S3_BUCKET;

    let documents;
    if (mimeType === MIME.pdf && bucket) {
      documents = await this.analyzeFromS3(client, textract, bytes, mimeType, originalName, bucket);
    } else {
      try {
        const res = await client.send(new textract.AnalyzeExpenseCommand({ Document: { Bytes: bytes } }));
        documents = res.ExpenseDocuments || [];
      } catch (err) {
        if (err.name === 'UnsupportedDocumentException' && mimeType === MIME.pdf) {
          throw new Error('AWS Textract can only read single-page PDFs directly. Set TEXTRACT_S3_BUCKET in backend/.env to read multi-page PDFs.');
        }
        throw err;
      }
    }
    return mapTextractExpense(documents);
  }

  async analyzeFromS3(client, textract, bytes, mimeType, originalName, bucket) {
    const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: process.env.AWS_REGION });
    const key = `${process.env.TEXTRACT_S3_PREFIX || 'invoicedesk/'}${Date.now()}-${path.basename(originalName || 'document.pdf')}`;
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: mimeType }));
    try {
      const { JobId } = await client.send(new textract.StartExpenseAnalysisCommand({
        DocumentLocation: { S3Object: { Bucket: bucket, Name: key } },
      }));
      const deadline = Date.now() + 5 * 60 * 1000;
      for (;;) {
        await sleep(2500);
        const res = await client.send(new textract.GetExpenseAnalysisCommand({ JobId }));
        if (res.JobStatus === 'FAILED') throw new Error(`AWS Textract failed: ${res.StatusMessage || 'unknown error'}`);
        if (res.JobStatus === 'SUCCEEDED' || res.JobStatus === 'PARTIAL_SUCCESS') {
          const docs = [...(res.ExpenseDocuments || [])];
          let token = res.NextToken;
          while (token) {
            const page = await client.send(new textract.GetExpenseAnalysisCommand({ JobId, NextToken: token }));
            docs.push(...(page.ExpenseDocuments || []));
            token = page.NextToken;
          }
          return docs;
        }
        if (Date.now() > deadline) throw new Error('AWS Textract took longer than 5 minutes. Try again later.');
      }
    } finally {
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    }
  }
}

/** Convert Textract ExpenseDocuments into the common raw shape. Exported for testing. */
export function mapTextractExpense(documents) {
  if (!documents?.length) throw new Error('AWS Textract found no invoice or receipt in this document.');
  const summary = documents.flatMap((d) => d.SummaryFields || []);
  const type = (f) => f.Type?.Text;
  const val = (f) => f?.ValueDetection?.Text?.trim() || null;
  const groups = (f) => (f.GroupProperties || []).flatMap((g) => g.Types || []);
  const find = (types, group) => {
    for (const t of types) {
      const f = summary.find((x) => type(x) === t && val(x) && (!group || groups(x).some((g) => g.startsWith(group))));
      if (f) return val(f);
    }
    return null;
  };

  const out = emptyResult();
  const allText = summary.map(val).filter(Boolean);

  out.supplier = {
    name: first(find(['VENDOR_NAME']), find(['NAME'], 'VENDOR')),
    address_line: oneLine(first(find(['STREET'], 'VENDOR'), find(['VENDOR_ADDRESS']), find(['ADDRESS'], 'VENDOR'))),
    city: find(['CITY'], 'VENDOR'),
    postcode: find(['ZIP_CODE'], 'VENDOR'),
    country: find(['COUNTRY'], 'VENDOR'),
    phone: find(['VENDOR_PHONE']),
    website: find(['VENDOR_URL']),
    email: findEmail(...allText),
    vat_number: find(['VENDOR_VAT_NUMBER', 'VENDOR_GST_NUMBER', 'VENDOR_ABN_NUMBER', 'TAX_PAYER_ID']),
  };
  out.customer = {
    name: first(find(['RECEIVER_NAME']), find(['NAME'], 'RECEIVER')),
    address_line: oneLine(first(find(['STREET'], 'RECEIVER'), find(['RECEIVER_ADDRESS']), find(['ADDRESS'], 'RECEIVER'))),
    city: find(['CITY'], 'RECEIVER'),
    postcode: find(['ZIP_CODE'], 'RECEIVER'),
    country: find(['COUNTRY'], 'RECEIVER'),
    phone: find(['RECEIVER_PHONE']),
    account_number: find(['CUSTOMER_NUMBER', 'ACCOUNT_NUMBER']),
  };

  const taxFields = summary.filter((f) => type(f) === 'TAX' && val(f));
  out.taxes = taxFields.map((f) => ({
    tax_name: f.LabelDetection?.Text?.replace(/[:\s]+$/, '') || 'Tax',
    rate: rateFromLabel(f.LabelDetection?.Text),
    tax_amount: val(f),
  }));

  const currencyField = summary.find((f) => type(f) === 'TOTAL' && f.Currency?.Code) || summary.find((f) => f.Currency?.Code);
  out.invoice = {
    invoice_number: find(['INVOICE_RECEIPT_ID']),
    invoice_date: find(['INVOICE_RECEIPT_DATE', 'ORDER_DATE']),
    due_date: find(['DUE_DATE']),
    po_number: find(['PO_NUMBER']),
    currency: currencyField?.Currency?.Code || null,
    payment_terms: find(['PAYMENT_TERMS']),
    subtotal: find(['SUBTOTAL']),
    discount_total: find(['DISCOUNT']),
    tax_total: taxFields.length === 1 ? val(taxFields[0]) : null, // several rates -> summed in normalize
    shipping: find(['SHIPPING_HANDLING_CHARGE']),
    total_amount: find(['TOTAL']),
    amount_paid: find(['AMOUNT_PAID']),
    amount_due: find(['AMOUNT_DUE']),
  };

  out.line_items = documents
    .flatMap((d) => d.LineItemGroups || [])
    .flatMap((g) => g.LineItems || [])
    .map((li) => {
      const fields = li.LineItemExpenseFields || [];
      const get = (t) => val(fields.find((f) => type(f) === t));
      return {
        description: get('ITEM'),
        product_code: get('PRODUCT_CODE'),
        quantity: get('QUANTITY'),
        unit_price: get('UNIT_PRICE'),
        net_amount: get('PRICE'),
      };
    });

  const keyTypes = ['VENDOR_NAME', 'INVOICE_RECEIPT_ID', 'INVOICE_RECEIPT_DATE', 'TOTAL'];
  const conf = average(summary.filter((f) => keyTypes.includes(type(f))).map((f) => f.ValueDetection?.Confidence));
  out.confidence = conf === null ? 0.5 : conf / 100;
  const words = summary.map((f) => `${f.LabelDetection?.Text || ''} ${val(f) || ''}`).join(' ');
  out.document_type = /receipt/i.test(words) && !/invoice/i.test(words) ? 'receipt' : 'invoice';
  return out;
}
