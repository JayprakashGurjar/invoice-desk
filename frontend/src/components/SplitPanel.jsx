import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { money } from '../format.js';
import StatusStamp from './StatusStamp.jsx';
import { toolName, useExtractors } from '../useExtractors.js';

const pagesLabel = (from, to) => (to > from ? `pages ${from}-${to}` : `page ${from}`);
const toText = (docs) => docs.map((d) => (d.to > d.from ? `${d.from}-${d.to}` : `${d.from}`)).join(', ');

/** "1, 2-3, 4" -> [{from:1,to:1},{from:2,to:3},{from:4,to:4}], or { error } */
export function parseRanges(text, pageCount) {
  const parts = [];
  for (const piece of text.split(/[,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const m = piece.match(/^(\d+)\s*(?:-|to)\s*(\d+)$/i) || piece.match(/^(\d+)$/);
    if (!m) return { error: `"${piece}" isn't a page or a range like 2-3.` };
    const from = Number(m[1]), to = Number(m[2] || m[1]);
    if (from < 1 || to < from) return { error: `"${piece}" isn't a valid range.` };
    if (pageCount && to > pageCount) return { error: `This file has ${pageCount} pages.` };
    parts.push({ from, to });
  }
  parts.sort((a, b) => a.from - b.from);
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].from <= parts[i - 1].to) return { error: `Page ${parts[i].from} is in two documents.` };
  }
  const covered = new Set(parts.flatMap((p) => Array.from({ length: p.to - p.from + 1 }, (_, k) => p.from + k)));
  const missing = pageCount ? Array.from({ length: pageCount }, (_, k) => k + 1).filter((n) => !covered.has(n)) : [];
  return { parts, missing };
}

/** Parts of a split file (shown on the original). */
export function SplitParts({ doc }) {
  return (
    <div className="block split-summary">
      <h2>Split into {doc.parts.length} documents</h2>
      <p className="muted">This file held several documents, so each one was saved and read separately. Open them below. This file is kept as it was uploaded.</p>
      <ul className="split-parts">
        {doc.parts.map((p) => (
          <li key={p.id}>
            <Link to={`/invoices/${p.id}`} className="split-part-name">{p.supplier_name || p.invoice_number || p.original_name}</Link>
            <span className="muted">{pagesLabel(p.page_from, p.page_to)}{p.invoice_number && p.supplier_name ? ` · ${p.invoice_number}` : ''}</span>
            <span className="num">{p.total_amount != null ? money(p.total_amount, p.currency) : ''}</span>
            <StatusStamp status={p.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Split into separate documents": suggests where each document starts; the user can change it. */
export default function SplitPanel({ id, onSplit }) {
  const extractors = useExtractors();
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState(null);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  async function start() {
    setOpen(true);
    setError(null);
    try {
      const found = await api.pages(id);
      setInfo(found);
      setText(toText(found.documents));
    } catch (e) { setError(e.message); }
  }

  const parsed = info ? parseRanges(text, info.page_count) : null;

  async function confirm() {
    setWorking(true);
    setError(null);
    try {
      const { parts } = await api.split(id, parsed.parts);
      onSplit(parts);
    } catch (e) { setError(e.message); } finally { setWorking(false); }
  }

  if (!open) {
    return (
      <p className="split-offer">
        More than one invoice in this PDF?{' '}
        <button type="button" className="link-button" onClick={start}>Split it into separate documents</button>
      </p>
    );
  }
  return (
    <div className="block split-panel">
      <h2>Split into separate documents</h2>
      {error && <p className="alert alert-error">{error}</p>}
      {!info && !error && <p className="muted">Looking for separate documents…</p>}
      {info && info.page_count < 2 && <p className="muted">This file has one page, so there's nothing to split.</p>}
      {info && info.page_count >= 2 && (
        <>
          <p className="muted">
            {info.page_count} pages.{' '}
            {info.documents.length > 1
              ? `${toolName(info.method, extractors) && info.method !== 'text' ? toolName(info.method, extractors) : 'The page text'} suggests ${info.documents.length} documents.`
              : 'It looks like one document, but you can split it by hand.'}{' '}
            Each part becomes its own document and is read again.
          </p>
          <label className="field field-wide">
            <span className="field-label">Pages of each document, separated by commas</span>
            <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 1, 2-3, 4" />
          </label>
          {parsed?.error && <p className="form-error">{parsed.error}</p>}
          {parsed?.parts && (
            <ol className="split-preview">
              {parsed.parts.map((p, i) => {
                const hint = info.documents.find((d) => d.from === p.from && d.to === p.to);
                return <li key={i}>{pagesLabel(p.from, p.to)}{hint?.invoice_number ? ` · ${hint.invoice_number}` : ''}{hint?.supplier_name ? ` · ${hint.supplier_name}` : ''}</li>;
              })}
            </ol>
          )}
          {parsed?.missing?.length > 0 && <p className="form-error">Page{parsed.missing.length > 1 ? 's' : ''} {parsed.missing.join(', ')} won't be in any document.</p>}
          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={working || !parsed?.parts || parsed.parts.length < 2}
              onClick={confirm}>{working ? 'Splitting…' : `Split into ${parsed?.parts?.length || 0} documents`}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)} disabled={working}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}
