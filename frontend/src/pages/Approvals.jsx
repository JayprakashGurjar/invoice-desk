import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ago, date, money, DOC_TYPES } from '../format.js';
import { useSession } from '../session.jsx';

export default function Approvals() {
  const { feed, refreshFeed } = useSession();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.myApprovals().then(setRows).catch((e) => setError(e.message));
    refreshFeed();
  }, [refreshFeed, feed.pending_approval_count]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Waiting for my approval</h1>
        <p className="muted">Documents other people have sent you. Open one to approve it, reject it, or send it back for review.</p>
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {!rows && !error && <p className="empty">Loading…</p>}
      {rows && rows.length === 0 && <p className="empty">Nothing is waiting for you. New requests also appear under the bell at the top.</p>}
      {rows && rows.length > 0 && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Supplier</th><th>Document</th><th>Date</th><th className="num">Total</th><th>Sent by</th><th>Note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/invoices/${r.id}`} className="row-link">
                      <span className="cell-main">{r.supplier_name || 'Unknown supplier'}</span>
                    </Link>
                    <span className="cell-sub">{DOC_TYPES[r.document_type] || 'Document'}</span>
                  </td>
                  <td>{r.invoice_number || r.original_name}</td>
                  <td className="nowrap">{date(r.invoice_date)}</td>
                  <td className="num strong">{money(r.total_amount, r.currency)}</td>
                  <td className="nowrap">{r.assigned_by_name}<span className="cell-sub">{ago(r.assigned_at)}</span></td>
                  <td className="cell-note">{r.approval_comment || <span className="muted">No note</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
