import { useEffect, useState } from 'react';
import { api } from './api.js';

// One shared copy of GET /api/extractors; updated in place when settings change.
let cached = null;
let pending = null;
const listeners = new Set();

/** Replace the shared copy (e.g. with the reply of a settings save) and update every user. */
export function setExtractors(data) {
  cached = data;
  listeners.forEach((l) => l(data));
}

/** Forget the shared copy (after sign-out or when switching user). */
export function resetExtractors() {
  cached = null;
  pending = null;
}

export function useExtractors() {
  const [data, setData] = useState(cached);
  useEffect(() => {
    listeners.add(setData);
    if (!cached) {
      pending ||= api.listExtractors()
        .then((d) => { cached = d; return d; })
        .catch(() => { pending = null; return { providers: [], auto_provider: null, error: true }; });
      pending.then(setData);
    }
    return () => listeners.delete(setData);
  }, []);
  return data;
}

// Documents extracted before tools were selectable stored these ids.
const LEGACY = { ai: 'Claude', fallback: 'Basic text matching' };

export function toolName(id, data) {
  if (!id) return null;
  if (id === 'auto') return 'Automatic';
  return data?.providers?.find((p) => p.id === id)?.name || LEGACY[id] || id;
}

const MIME_LABELS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/webp': 'WEBP', 'image/gif': 'GIF' };

export function fileTypes(provider) {
  const labels = (provider?.supported_mime_types || []).map((m) => MIME_LABELS[m] || m);
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
