import { useState } from 'react';
import { api } from '../api.js';

export default function Login({ onSignedIn }) {
  const [form, setForm] = useState({ agrno: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await api.login(form.agrno.trim(), form.email.trim(), form.password));
    } catch (err) {
      setError(err.message);
      setForm((f) => ({ ...f, password: '' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="wordmark login-mark">
          <span className="wordmark-mark" aria-hidden="true" />
          <span className="wordmark-text">InvoiceDesk</span>
        </div>
        <h1>Sign in</h1>
        <p className="muted">Use your DocuSoft login.</p>
        {error && <p className="alert alert-error" role="alert">{error}</p>}
        <label className="field">
          <span className="field-label">Agreement number</span>
          <input className="input" value={form.agrno} onChange={set('agrno')} autoComplete="organization" required autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Email</span>
          <input className="input" type="email" value={form.email} onChange={set('email')} autoComplete="username" required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input className="input" type="password" value={form.password} onChange={set('password')} autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
