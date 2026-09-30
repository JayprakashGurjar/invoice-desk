const cache = {};

export function money(value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const code = (currency || 'GBP').toUpperCase();
  try {
    cache[code] ||= new Intl.NumberFormat('en-GB', { style: 'currency', currency: code });
    return cache[code].format(n);
  } catch {
    return `${n.toFixed(2)} ${code}`;
  }
}

export function date(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const STATUS_LABELS = {
  queued: 'Queued',
  processing: 'Reading',
  extracted: 'Extracted',
  needs_review: 'Needs review',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  failed: 'Failed',
  split: 'Split',
};

export const DOC_TYPES = {
  invoice: 'Invoice',
  receipt: 'Receipt',
  credit_note: 'Credit note',
  proforma: 'Pro forma',
  other: 'Other',
};

/** "5 min ago", "3 Sep" from an ISO time (UTC, as the API returns it). */
export function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
