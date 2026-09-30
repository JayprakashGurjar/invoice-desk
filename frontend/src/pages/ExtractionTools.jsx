import { useState } from 'react';
import { api } from '../api.js';
import { ago } from '../format.js';
import { setExtractors, useExtractors, fileTypes } from '../useExtractors.js';

const KIND = {
  llm: 'Vision language model',
  ocr: 'Invoice OCR service',
  basic: 'Pattern matching',
};

function Capability({ on, children }) {
  return <li className={on ? 'cap-on' : 'cap-off'}>{children}</li>;
}

/**
 * Settings form for one tool (web-service mode). Values go to the DocuSoft web service, which
 * encrypts them into DS_AgreementTable. Secrets are never sent back: the form shows only
 * their last characters, and leaving a secret box empty keeps the stored value.
 */
function ToolSettingsForm({ tool, onSaved }) {
  const initial = Object.fromEntries(tool.fields.map((f) => [f.name, f.secret ? '' : f.value || '']));
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const changed = tool.fields.some((f) => values[f.name] !== initial[f.name]);
  const anySet = tool.fields.some((f) => f.is_set);

  async function act(label, fn, done) {
    setBusy(label);
    setMessage(null);
    try {
      const catalog = await fn();
      onSaved(catalog);
      const updated = catalog.providers.find((p) => p.id === tool.id);
      setValues(Object.fromEntries(updated.fields.map((f) => [f.name, f.secret ? '' : f.value || ''])));
      setMessage({ ok: true, text: done });
    } catch (e) {
      setMessage({ ok: false, text: e.message });
    } finally {
      setBusy(null);
    }
  }

  const save = (e) => {
    e.preventDefault();
    act('save', () => api.saveToolSettings(tool.id, values), 'Saved.');
  };
  const remove = () => {
    if (!window.confirm(`Remove the stored ${tool.name} settings, including its keys?`)) return;
    act('remove', () => api.removeToolSettings(tool.id), 'Removed.');
  };

  return (
    <form className="tool-form" onSubmit={save} autoComplete="off">
      <div className="grid">
        {tool.fields.map((f) => {
          const multiline = f.name === 'service_account_json';
          const common = {
            className: 'input',
            value: values[f.name],
            onChange: (e) => setValues((v) => ({ ...v, [f.name]: e.target.value })),
            placeholder: f.secret && f.is_set ? `Stored (${f.masked}). Leave empty to keep it.` : f.default_value ? `Default: ${f.default_value}` : '',
            spellCheck: false,
          };
          return (
            <label key={f.name} className={`field ${multiline || f.name === 'endpoint' ? 'field-wide' : ''}`}>
              <span className="field-label">
                {f.label}{f.required && !f.default_value ? '' : ' (optional)'}
                {f.secret && f.is_set && <span className="field-set">Stored {f.masked}</span>}
              </span>
              {multiline
                ? <textarea {...common} rows={3} className="input input-mono" />
                : <input {...common} type={f.secret ? 'password' : 'text'} autoComplete={f.secret ? 'new-password' : 'off'} />}
              {f.help && <span className="field-help">{f.help}</span>}
            </label>
          );
        })}
      </div>
      <div className="tool-form-actions">
        <button className="btn btn-primary btn-sm" disabled={!changed || !!busy}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
        {anySet && <button type="button" className="btn btn-danger-quiet btn-sm" onClick={remove} disabled={!!busy}>{busy === 'remove' ? 'Removing…' : 'Remove'}</button>}
        {message && <span className={message.ok ? 'form-ok' : 'form-error'} role="status">{message.text}</span>}
      </div>
    </form>
  );
}

/** Starts open for tools that aren't set up, then stays however the user leaves it. */
function SettingsPanel({ initiallyOpen, children }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details className="tool-settings" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Settings</summary>
      {children}
    </details>
  );
}

function RemoteHeader({ data }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ready = data.providers.filter((p) => p.ready);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try { setExtractors(await fn()); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="policy">
      <label className="field">
        <span className="field-label">“Automatic” uses</span>
        <select className="input" value={data.preferred} disabled={busy} onChange={(e) => run(() => api.setDefaultTool(e.target.value))}>
          <option value="auto">The first ready tool{data.auto_provider && data.preferred === 'auto' ? ` (now ${data.providers.find((p) => p.id === data.auto_provider)?.name})` : ''}</option>
          {ready.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={data.require_approver} disabled={busy} onChange={(e) => run(() => api.setApprovalPolicy(e.target.checked))} />
        <span>
          <strong>Require an approver</strong>
          <span className="muted">Documents must be sent to another person to approve. Nobody can approve their own.</span>
        </span>
      </label>
      {error && <p className="alert alert-error">{error}</p>}
      {data.updated_at && <p className="policy-updated">Last changed {ago(data.updated_at)}{data.updated_by_name ? ` by ${data.updated_by_name}` : ''}.</p>}
    </div>
  );
}

export default function ExtractionTools() {
  const data = useExtractors();

  if (!data) return <div className="page"><p className="empty">Loading…</p></div>;
  if (data.error) return <div className="page"><p className="alert alert-error">Could not load extraction tools. Is the API running?</p></div>;
  const remote = data.mode === 'remote';

  const ready = data.providers.filter((p) => p.ready);
  const notReady = data.providers.filter((p) => !p.ready);

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <h1>Extraction tools</h1>
        <p className="muted">
          Choose which service reads your documents when you upload them or re-run extraction.
          {remote
            ? ' Keys are stored encrypted with your agreement and used only by the DocuSoft web service. They are never shown again, only their last four characters.'
            : <> To set a tool up, add its settings to <code>backend/.env</code> and restart the API.</>}
        </p>
      </div>

      {remote ? <RemoteHeader data={data} /> : (
      <p className="default-line">
        {data.auto_provider
          ? <>“Automatic” currently uses <strong>{data.providers.find((p) => p.id === data.auto_provider)?.name}</strong>
            {data.preferred !== 'auto' && data.preferred !== data.auto_provider && <> because <code>EXTRACTION_PROVIDER={data.preferred}</code> isn't set up</>}.
            Change it with <code>EXTRACTION_PROVIDER</code>.</>
          : 'No tool is set up yet.'}
      </p>
      )}

      {/* One list, ready tools first: a tool's settings form keeps its state (and its
          "Saved" message) when saving makes it ready. */}
      <section className="tool-section">
          <ul className="tool-list">
            {[...ready, ...notReady].map((p) => (
              <li key={p.id} className="tool">
                <div className="tool-head">
                  <div>
                    <h3>{p.name}</h3>
                    <p className="tool-meta">{p.vendor}. {KIND[p.kind]}{p.model ? `, ${p.model}` : ''}.</p>
                  </div>
                  <span className={`stamp ${p.ready ? 'stamp-approved' : 'stamp-off'}`}>{p.ready ? 'Ready' : 'Not set up'}</span>
                  {p.is_default && <span className="tool-default">Automatic</span>}
                </div>
                <p className="tool-desc">{p.description}</p>
                <ul className="caps">
                  <Capability on>Reads {fileTypes(p)}</Capability>
                  <Capability on={p.capabilities.lineItems}>{p.capabilities.lineItems ? 'Line items' : 'No line items'}</Capability>
                  <Capability on={p.capabilities.scans}>{p.capabilities.scans ? 'Scans and photos' : 'Text PDFs only'}</Capability>
                  {p.capabilities.handwriting && <Capability on>Handwriting</Capability>}
                </ul>
                {p.notes && <p className="tool-notes">{p.notes}</p>}
                {remote && (
                  <SettingsPanel initiallyOpen={!p.ready}>
                    <ToolSettingsForm tool={p} onSaved={setExtractors} />
                  </SettingsPanel>
                )}
                {!remote && (p.settings.length > 0 || p.missing_packages.length > 0) && (
                  <details className="tool-settings" open={!p.ready}>
                    <summary>Settings</summary>
                    <table className="settings-table">
                      <tbody>
                        {p.settings.map((s) => (
                          <tr key={s.name}>
                            <td><code>{s.name}</code></td>
                            <td className={s.set ? 'set-yes' : s.required ? 'set-missing' : 'set-optional'}>
                              {s.set ? 'Set' : s.required ? 'Required'
                                : !s.default ? 'Optional'
                                : s.default.startsWith('(') ? `Optional ${s.default}` : `Optional, default ${s.default}`}
                            </td>
                          </tr>
                        ))}
                        {p.missing_packages.map((pkg) => (
                          <tr key={pkg}>
                            <td><code>{pkg}</code></td>
                            <td className="set-missing">Package missing. Run <code>npm install {pkg}</code> in backend</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {p.docs_url && <p className="tool-link"><a href={p.docs_url} target="_blank" rel="noreferrer">Get credentials from {p.vendor}</a></p>}
                  </details>
                )}
              </li>
            ))}
          </ul>
      </section>
    </div>
  );
}
