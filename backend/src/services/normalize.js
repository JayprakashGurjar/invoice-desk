// Cleans raw extraction output and runs arithmetic checks.

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.,]/g, '');
  // "1.234,56" (European) -> "1234.56"
  if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

const pad = (n) => String(n).padStart(2, '0');
const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 2200;

/** Returns YYYY-MM-DD or null. Ambiguous numeric dates are read day-first (UK). */
export function toIsoDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; return validDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null; }
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    let [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    return validDate(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/);
  if (m) { const mo = MONTHS[m[2].toLowerCase().slice(0, 4)] || MONTHS[m[2].toLowerCase().slice(0, 3)]; return mo && validDate(+m[3], mo, +m[1]) ? `${m[3]}-${pad(mo)}-${pad(+m[1])}` : null; }
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) { const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; return mo && validDate(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(+m[2])}` : null; }
  return null;
}

const clean = (v, max = 1000) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

const round2 = (n) => Math.round(n * 100) / 100;
const close = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

export function normalizeExtraction(raw = {}) {
  const s = raw.supplier || {};
  const c = raw.customer || {};
  const i = raw.invoice || {};

  const supplier = {
    name: clean(s.name, 255), address_line: clean(s.address_line, 500), city: clean(s.city, 120),
    postcode: clean(s.postcode, 30), country: clean(s.country, 80), phone: clean(s.phone, 60),
    email: clean(s.email, 255), website: clean(s.website, 255),
    vat_number: clean(s.vat_number, 60), company_number: clean(s.company_number, 60),
  };
  const customer = {
    name: clean(c.name, 255), address_line: clean(c.address_line, 500), city: clean(c.city, 120),
    postcode: clean(c.postcode, 30), country: clean(c.country, 80), phone: clean(c.phone, 60),
    email: clean(c.email, 255), vat_number: clean(c.vat_number, 60), account_number: clean(c.account_number, 60),
  };
  const invoice = {
    document_type: clean(raw.document_type, 30) || 'invoice',
    invoice_number: clean(i.invoice_number, 100),
    invoice_date: toIsoDate(i.invoice_date),
    due_date: toIsoDate(i.due_date),
    po_number: clean(i.po_number, 100),
    currency: clean(i.currency, 3)?.toUpperCase() || null,
    payment_terms: clean(i.payment_terms, 255),
    payment_method: clean(i.payment_method, 100),
    subtotal: toNumber(i.subtotal),
    discount_total: toNumber(i.discount_total),
    tax_total: toNumber(i.tax_total),
    shipping: toNumber(i.shipping),
    total_amount: toNumber(i.total_amount),
    amount_paid: toNumber(i.amount_paid),
    amount_due: toNumber(i.amount_due),
    notes: clean(i.notes, 4000),
  };
  const taxes = (raw.taxes || []).map((t) => ({
    tax_name: clean(t.tax_name, 100), rate: toNumber(t.rate),
    taxable_amount: toNumber(t.taxable_amount), tax_amount: toNumber(t.tax_amount),
  })).filter((t) => t.tax_amount !== null || t.rate !== null);

  const line_items = (raw.line_items || []).map((l, idx) => {
    const item = {
      line_no: idx + 1,
      description: clean(l.description, 1000), product_code: clean(l.product_code, 100),
      quantity: toNumber(l.quantity), unit: clean(l.unit, 50), unit_price: toNumber(l.unit_price),
      discount: toNumber(l.discount), tax_rate: toNumber(l.tax_rate), tax_amount: toNumber(l.tax_amount),
      net_amount: toNumber(l.net_amount), total_amount: toNumber(l.total_amount),
    };
    // Fill gaps we can derive safely.
    if (item.net_amount === null && item.quantity !== null && item.unit_price !== null) {
      item.net_amount = round2(item.quantity * item.unit_price - (item.discount || 0));
    }
    if (item.unit_price === null && item.net_amount !== null && item.quantity) {
      item.unit_price = round2((item.net_amount + (item.discount || 0)) / item.quantity);
    }
    return item;
  }).filter((l) => l.description || l.net_amount !== null || l.total_amount !== null);

  if (invoice.tax_total === null && taxes.length) {
    invoice.tax_total = round2(taxes.reduce((a, t) => a + (t.tax_amount || 0), 0));
  }

  const confidence = Math.max(0, Math.min(1, toNumber(raw.confidence) ?? 0.5));
  const data = { supplier, customer, invoice, taxes, line_items };
  const issues = [...(raw.warnings || []).map(String), ...validateInvoice(data)];
  return { data, issues, confidence };
}

/** Arithmetic and completeness checks. Returns human-readable issues. */
export function validateInvoice({ supplier, invoice, line_items }) {
  const issues = [];
  if (!supplier?.name) issues.push('Supplier name is missing.');
  if (!invoice.invoice_number && invoice.document_type !== 'receipt') issues.push('Invoice number is missing.');
  if (!invoice.invoice_date) issues.push('Invoice date is missing.');
  if (invoice.total_amount === null) issues.push('Total amount is missing.');

  const lineNet = line_items.reduce((a, l) => a + (l.net_amount || 0), 0);
  if (line_items.length && invoice.subtotal !== null && !close(lineNet, invoice.subtotal, 0.1)) {
    issues.push(`Line items add up to ${lineNet.toFixed(2)} but the subtotal is ${invoice.subtotal.toFixed(2)}.`);
  }
  for (const l of line_items) {
    if (l.quantity !== null && l.unit_price !== null && l.net_amount !== null) {
      const expected = l.quantity * l.unit_price - (l.discount || 0);
      if (!close(expected, l.net_amount, 0.1)) {
        issues.push(`Line ${l.line_no}: ${l.quantity} × ${l.unit_price} does not equal ${l.net_amount}.`);
      }
    }
  }
  if (invoice.subtotal !== null && invoice.total_amount !== null) {
    const expected = invoice.subtotal - (invoice.discount_total || 0) + (invoice.tax_total || 0) + (invoice.shipping || 0);
    if (!close(expected, invoice.total_amount, 0.1)) {
      issues.push(`Subtotal − discount + tax + shipping = ${expected.toFixed(2)}, but the total is ${invoice.total_amount.toFixed(2)}.`);
    }
  }
  return issues;
}
