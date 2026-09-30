export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The common raw shape every provider returns. normalize.js does the cleaning. */
export function emptyResult() {
  return {
    document_type: 'invoice',
    supplier: {},
    customer: {},
    invoice: {},
    taxes: [],
    line_items: [],
    confidence: 0.5,
    warnings: [],
  };
}

export const first = (...values) => values.find((v) => v !== null && v !== undefined && v !== '') ?? null;

export function average(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

export const oneLine = (s) => (s ? String(s).replace(/\s*\n\s*/g, ', ').trim() : null);

export function findEmail(...texts) {
  for (const t of texts) {
    const m = t && String(t).match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (m) return m[0];
  }
  return null;
}

export function rateFromLabel(label) {
  const m = label && String(label).match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

/** fetch() that throws a readable error and times out. */
export async function fetchJson(url, options = {}, { timeoutMs = 120000, service = 'Service' } = {}) {
  let res;
  try {
    res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`${service} did not respond within ${Math.round(timeoutMs / 1000)} seconds.`);
    }
    const code = err.cause?.code || err.cause?.message || err.message;
    throw new Error(`Could not reach ${service} (${code}). Check the endpoint setting and your network connection.`);
  }
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  if (!res.ok) {
    const msg = body?.error?.message || body?.message || body?.error || text.slice(0, 300) || res.statusText;
    throw new Error(`${service} returned ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return { body, headers: res.headers, status: res.status };
}

/** Parse a model's JSON reply, tolerating markdown fences or stray text around it. */
export function parseJsonText(text, service = 'The model') {
  if (!text) throw new Error(`${service} returned an empty response.`);
  const cleaned = String(text).replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error(`${service} did not return JSON.`);
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error(`${service} returned JSON that could not be parsed.`);
  }
}

export const MIME = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};
