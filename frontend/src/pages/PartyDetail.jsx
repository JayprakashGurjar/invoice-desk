import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import StatusStamp from '../components/StatusStamp.jsx';
import { money, date } from '../format.js';

const FIELDS = {
  supplier: [['name', 'Name'], ['address_line', 'Address'], ['city', 'Town or city'], ['postcode', 'Postcode'], ['country', 'Country'],
    ['phone', 'Phone'], ['email', 'Email'], ['website', 'Website'], ['vat_number', 'VAT number'], ['company_number', 'Company number']],
  customer: [['name', 'Name'], ['address_line', 'Address'], ['city', 'Town or city'], ['postcode', 'Postcode'], ['country', 'Country'],
    ['phone', 'Phone'], ['email', 'Email'], ['vat_number', 'VAT number'], ['account_number', 'Account number']],
};

export default function PartyDetail({ kind }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(null);
  const fields = FIELDS[kind];
  const listPath = `/${kind}s`;

  useEffect(() => {
    (kind === 'supplier' ? api.getSupplier(id) : api.getCustomer(id))
      .then((d) => { setData(d); setForm(d[kind]); })
      .catch((e) => setError(e.message));
  }, [id, kind]);

  async function save() {
    try {
      const saved = await (kind === 'supplier' ? api.saveSupplier(id, form) : api.saveCustomer(id, form));
      setData((d) => ({ ...d, [kind]: saved }));
      setEditing(false);
      setError(null);
    } catch (e) { setError(e.message); }
  }

  if (error && !data) return <div className="page"><p className="alert alert-error">{error}</p></div>;
  if (!data) return <div className="page"><p className="empty">Loading…</p></div>;

  const party = data[kind];
  const total = data.invoices.reduce((a, r) => a + (Number(r.total_amount) || 0), 0);
  const currency = [...new Set(data.invoices.map((r) => r.currency).filter(Boolean))];

  return (
    <div className="page">
      <Link to={listPath} className="back">{kind === 'supplier' ? 'Suppliers' : 'Customers'}</Link>
      <div className="page-head">
        <h1>{party.name}</h1>
        <dl className="tally">
          <div><dt>Documents</dt><dd>{data.invoices.length}</dd></div>
          {currency.length === 1 && <div><dt>Total</dt><dd>{money(total, currency[0])}</dd></div>}
        </dl>
      </div>

      <div className="card">
        <div className="block-head">
          <h2>Details</h2>
          {!editing
            ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(true)}>Edit details</button>
            : <span className="btn-row">
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setForm(party); setEditing(false); }}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={save}>Save details</button>
              </span>}
        </div>
        {error && <p className="alert alert-error">{error}</p>}
        {editing ? (
          <div className="grid">
            {fields.map(([k, l]) => (
              <label key={k} className={`field ${k === 'name' || k === 'address_line' ? 'field-wide' : ''}`}>
                <span className="field-label">{l}</span>
                <input className="input" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        ) : (
          <dl className="details">
            {fields.filter(([k]) => k !== 'name').map(([k, l]) => (
              <div key={k}><dt>{l}</dt><dd>{party[k] || '—'}</dd></div>
            ))}
          </dl>
        )}
      </div>

      <h2 className="section-title">Documents</h2>
      {data.invoices.length === 0 ? <p className="empty">No documents linked yet.</p> : (
        <div className="table-wrap">
          <table className="ledger">
            <thead>
              <tr><th>Number</th><th>Date</th><th>{kind === 'supplier' ? 'Customer' : 'Supplier'}</th><th className="num">Total</th><th>Status</th></tr>
            </thead>
            <tbody>
              {data.invoices.map((r) => (
                <tr key={r.id} className="row-link" tabIndex={0} onClick={() => navigate(`/invoices/${r.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/invoices/${r.id}`); }}>
                  <td><span className="cell-main">{r.invoice_number || '—'}</span><span className="cell-sub">{r.original_name}</span></td>
                  <td className="nowrap">{date(r.invoice_date)}</td>
                  <td>{(kind === 'supplier' ? r.customer_name : r.supplier_name) || '—'}</td>
                  <td className="num strong">{money(r.total_amount, r.currency)}</td>
                  <td><StatusStamp status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
