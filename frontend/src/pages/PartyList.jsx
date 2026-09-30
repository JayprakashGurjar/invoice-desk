import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { money, date } from '../format.js';

export default function PartyList({ kind }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);
  const title = kind === 'supplier' ? 'Suppliers' : 'Customers';

  useEffect(() => {
    setRows(null);
    (kind === 'supplier' ? api.listSuppliers() : api.listCustomers()).then(setRows).catch((e) => setError(e.message));
  }, [kind]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (rows || []).filter((r) => !f || [r.name, r.city, r.vat_number, r.email].some((v) => v?.toLowerCase().includes(f)));
  }, [rows, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
        <p className="muted">Created automatically from uploaded documents and matched by VAT number or name.</p>
      </div>
      <div className="toolbar">
        <input type="search" className="input search" placeholder={`Search ${title.toLowerCase()}`} value={filter}
          onChange={(e) => setFilter(e.target.value)} aria-label={`Search ${title.toLowerCase()}`} />
      </div>
      {error && <p className="alert alert-error">{error}</p>}
      {rows && shown.length === 0 ? (
        <p className="empty">{rows.length ? `No ${title.toLowerCase()} match “${filter}”.` : `No ${title.toLowerCase()} yet. They appear here once documents are extracted.`}</p>
      ) : rows && (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr>
                <th>Name</th>
                <th>Location</th>
                <th>VAT number</th>
                <th className="num">Documents</th>
                <th>Latest</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="row-link" tabIndex={0}
                  onClick={() => navigate(`/${kind}s/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/${kind}s/${r.id}`); }}>
                  <td>
                    <span className="cell-main">{r.name}</span>
                    {r.email && <span className="cell-sub">{r.email}</span>}
                  </td>
                  <td>{[r.city, r.postcode].filter(Boolean).join(', ') || '—'}</td>
                  <td>{r.vat_number || '—'}</td>
                  <td className="num">{r.invoice_count}</td>
                  <td className="nowrap">{date(r.last_invoice_date)}</td>
                  <td className="num strong">{money(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
