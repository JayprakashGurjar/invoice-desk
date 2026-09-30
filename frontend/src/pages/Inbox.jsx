import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import UploadTray from '../components/UploadTray.jsx';
import StatusStamp from '../components/StatusStamp.jsx';
import { money, date, DOC_TYPES, STATUS_LABELS } from '../format.js';

export default function Inbox() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, s] = await Promise.all([api.listInvoices({ search, status }), api.stats()]);
      setRows(list);
      setStats(s);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [search, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Poll while anything is still being read.
  const working = rows.some((r) => r.status === 'queued' || r.status === 'processing');
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [working, load]);

  const reviewCount = stats?.by_status?.needs_review || 0;
  // A split (merged) file is counted through its parts, not itself.
  const docCount = stats ? Object.entries(stats.by_status).filter(([k]) => k !== 'split').reduce((a, [, b]) => a + b, 0) : 0;
  const singleCurrency = stats?.currencies?.length === 1 ? stats.currencies[0] : null;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Inbox</h1>
        {stats && docCount > 0 && (
          <dl className="tally">
            <div><dt>Documents</dt><dd>{docCount}</dd></div>
            <div className={reviewCount ? 'tally-alert' : ''}><dt>To review</dt><dd>{reviewCount}</dd></div>
            <div><dt>Suppliers</dt><dd>{stats.supplier_count}</dd></div>
            {singleCurrency && <div><dt>Total spend</dt><dd>{money(stats.total_amount, singleCurrency)}</dd></div>}
          </dl>
        )}
      </div>

      <UploadTray onUploaded={load} />

      <div className="toolbar">
        <input
          type="search"
          className="input search"
          placeholder="Search supplier, customer, invoice number or file"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search documents"
        />
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <a className="btn btn-quiet" href={api.exportUrl()}>Export CSV</a>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      {loaded && rows.length === 0 && !error ? (
        <p className="empty">
          {search || status ? 'No documents match these filters.' : 'No documents yet. Upload an invoice or receipt above to get started.'}
        </p>
      ) : (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Number</th>
                <th>Date</th>
                <th>Type</th>
                <th className="num">Tax</th>
                <th className="num">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="row-link" tabIndex={0}
                  onClick={() => navigate(`/invoices/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/invoices/${r.id}`); }}>
                  <td>
                    <span className="cell-main">{r.supplier_name || (r.status === 'failed' ? 'Could not read' : r.status === 'queued' || r.status === 'processing' ? 'Reading document…' : 'Unknown supplier')}</span>
                    <span className="cell-sub">{r.original_name}</span>
                  </td>
                  <td>{r.invoice_number || '—'}</td>
                  <td className="nowrap">{date(r.invoice_date)}</td>
                  <td>{DOC_TYPES[r.document_type] || '—'}</td>
                  <td className="num">{money(r.tax_total, r.currency)}</td>
                  <td className="num strong">{money(r.total_amount, r.currency)}</td>
                  <td>
                    <StatusStamp status={r.status} />
                    {r.status === 'pending_approval' && r.assigned_to_name && <span className="cell-sub">with {r.assigned_to_name}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
