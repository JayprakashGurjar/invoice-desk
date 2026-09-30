import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import AuditEntries, { AUDIT_ACTIONS } from '../components/AuditEntries.jsx';

const EMPTY = { from: '', to: '', action: '', search: '' };

export default function AuditLog() {
  const [filters, setFilters] = useState(EMPTY);
  const [applied, setApplied] = useState(EMPTY);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (f) => {
    setError(null);
    try { setData(await api.auditLog({ ...f, top: 100 })); } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(applied); }, [applied, load]);

  async function more() {
    setLoadingMore(true);
    try {
      const last = data.entries[data.entries.length - 1];
      const page = await api.auditLog({ ...applied, top: 100, before: last.id });
      setData((d) => ({ ...d, entries: [...d.entries, ...page.entries] }));
    } catch (e) { setError(e.message); } finally { setLoadingMore(false); }
  }

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));
  const apply = (e) => { e.preventDefault(); setApplied(filters); };
  const filtered = Object.values(applied).some(Boolean);

  return (
    <div className="page">
      <div className="page-head page-head-row">
        <div>
          <h1>Audit log</h1>
          <p className="muted">Everything done to invoices and receipts, newest first. Entries can't be changed or deleted.</p>
        </div>
        <a className="btn btn-quiet" href={api.auditExportUrl(applied)}>Download CSV</a>
      </div>

      <form className="filters audit-filters" onSubmit={apply}>
        <label className="field"><span className="field-label">From</span><input className="input" type="date" value={filters.from} onChange={set('from')} /></label>
        <label className="field"><span className="field-label">To</span><input className="input" type="date" value={filters.to} onChange={set('to')} /></label>
        <label className="field">
          <span className="field-label">What happened</span>
          <select className="input" value={filters.action} onChange={set('action')}>
            <option value="">Anything</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field field-grow"><span className="field-label">Search</span><input className="input" value={filters.search} onChange={set('search')} placeholder="Invoice number, supplier, person or comment" /></label>
        <button className="btn btn-primary">Show</button>
        {filtered && <button type="button" className="btn btn-quiet" onClick={() => { setFilters(EMPTY); setApplied(EMPTY); }}>Clear</button>}
      </form>

      {error && <p className="alert alert-error">{error}</p>}
      {!data && !error && <p className="empty">Loading…</p>}
      {data && (
        <>
          <p className="audit-count">{data.total === 0 ? 'No entries' : `${data.entries.length} of ${data.total} ${data.total === 1 ? 'entry' : 'entries'}`}{filtered ? ' matching these filters' : ''}</p>
          {data.entries.length > 0 && <AuditEntries entries={data.entries} showDocument />}
          {data.entries.length < data.total && (
            <button type="button" className="btn btn-quiet audit-more-btn" onClick={more} disabled={loadingMore}>{loadingMore ? 'Loading…' : 'Show older entries'}</button>
          )}
        </>
      )}
    </div>
  );
}
