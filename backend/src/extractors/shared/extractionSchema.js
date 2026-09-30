// JSON schema handed to Claude as a tool. Forcing a tool call guarantees structured output.
const str = (description) => ({ type: ['string', 'null'], description });
const num = (description) => ({ type: ['number', 'null'], description });

export const EXTRACTION_TOOL = {
  name: 'record_invoice',
  description: 'Record every piece of data extracted from an invoice, receipt or credit note.',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: ['invoice', 'receipt', 'credit_note', 'proforma', 'other'],
      },
      supplier: {
        type: 'object',
        description: 'The seller / business that issued the document.',
        properties: {
          name: str('Legal or trading name of the supplier'),
          address_line: str('Street address lines joined with ", " (exclude city, postcode, country)'),
          city: str('Town or city'),
          postcode: str('Postcode / ZIP'),
          country: str('Country'),
          phone: str('Phone number exactly as printed'),
          email: str('Email address'),
          website: str('Website'),
          vat_number: str('VAT / GST / tax registration number'),
          company_number: str('Company registration number'),
        },
      },
      customer: {
        type: 'object',
        description: 'The buyer / bill-to party. Leave fields null if not shown (common on receipts).',
        properties: {
          name: str('Customer or company name'),
          address_line: str('Street address lines joined with ", "'),
          city: str('Town or city'),
          postcode: str('Postcode / ZIP'),
          country: str('Country'),
          phone: str('Phone number'),
          email: str('Email address'),
          vat_number: str('Customer VAT number'),
          account_number: str('Customer account / reference number'),
        },
      },
      invoice: {
        type: 'object',
        properties: {
          invoice_number: str('Invoice, receipt or transaction number'),
          invoice_date: str('Issue date in YYYY-MM-DD'),
          due_date: str('Payment due date in YYYY-MM-DD'),
          po_number: str('Purchase order number'),
          currency: str('ISO 4217 code, e.g. GBP, USD, EUR, INR'),
          payment_terms: str('e.g. "Net 30"'),
          payment_method: str('e.g. card, cash, bank transfer'),
          subtotal: num('Total before tax and after line discounts'),
          discount_total: num('Document-level discount as a positive number'),
          tax_total: num('Total VAT / tax'),
          shipping: num('Delivery / shipping / carriage charge'),
          total_amount: num('Grand total payable including tax'),
          amount_paid: num('Amount already paid'),
          amount_due: num('Balance still due'),
          notes: str('Any other notable information (bank details, remarks)'),
        },
      },
      taxes: {
        type: 'array',
        description: 'One entry per tax rate shown in a VAT/tax summary.',
        items: {
          type: 'object',
          properties: {
            tax_name: str('e.g. "VAT", "GST", "CGST"'),
            rate: num('Percentage, e.g. 20 for 20%'),
            taxable_amount: num('Net amount this rate applies to'),
            tax_amount: num('Tax amount'),
          },
        },
      },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: str('Item / service name and description'),
            product_code: str('SKU, product or item code'),
            quantity: num('Quantity'),
            unit: str('Unit of measure, e.g. pcs, hrs, kg, box'),
            unit_price: num('Price per unit before tax'),
            discount: num('Line discount amount'),
            tax_rate: num('Tax percentage for this line'),
            tax_amount: num('Tax amount for this line'),
            net_amount: num('Line total before tax'),
            total_amount: num('Line total including tax, if shown'),
          },
        },
      },
      confidence: {
        type: 'number',
        description: '0 to 1: how confident you are that the extraction is complete and correct.',
      },
      warnings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Anything unclear: illegible text, missing totals, handwritten parts, etc.',
      },
    },
    required: ['document_type', 'supplier', 'invoice', 'line_items', 'confidence'],
  },
};

export const SYSTEM_PROMPT = `You are an expert accounts-payable data extraction engine.
Extract data from the supplied invoice, receipt or credit note and record it with the record_invoice tool.

Rules:
- Only record values that are actually present on the document. Use null when something is not shown. Never invent data.
- All monetary values must be plain numbers without currency symbols or thousand separators (1234.5, not "£1,234.50").
- Dates must be YYYY-MM-DD. When a date is ambiguous (e.g. 03/04/2025), use the supplier's country conventions; default to day-first (UK) unless the document is clearly US.
- Percentages are plain numbers (20 for 20%).
- The supplier is the party issuing the document; the customer is the bill-to / sold-to party.
- Capture every line item, in order, including delivery or service charges that appear as lines.
- For credit notes, keep amounts positive and set document_type to "credit_note".
- If the document is multi-page, combine all pages into one record.
- Lower the confidence score and add a warning when text is blurry, cut off, handwritten or totals do not add up.`;

/** Instructions for LLM providers that take a JSON schema in the prompt rather than as a tool. */
export const JSON_OUTPUT_INSTRUCTIONS = `Extract all data from this document.
Return ONLY one JSON object, with no markdown fences and no commentary, that conforms to this JSON Schema:
${JSON.stringify(EXTRACTION_TOOL.input_schema)}`;
