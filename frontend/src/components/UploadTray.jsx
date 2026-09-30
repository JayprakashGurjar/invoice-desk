import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { fileTypes, toolName, useExtractors } from '../useExtractors.js';
import ToolSelect from './ToolSelect.jsx';

const ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/jpeg,image/png,image/webp,image/gif';
const STORAGE_KEY = 'invoicedesk.extractionTool';
const SPLIT_KEY = 'invoicedesk.splitMerged';

function savedTool() {
  try { return localStorage.getItem(STORAGE_KEY) || 'auto'; } catch { return 'auto'; }
}

export default function UploadTray({ onUploaded }) {
  const input = useRef(null);
  const extractors = useExtractors();
  const [tool, setTool] = useState(savedTool);
  const [split, setSplit] = useState(() => { try { return localStorage.getItem(SPLIT_KEY) !== '0'; } catch { return true; } });
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Drop a remembered choice that is no longer set up.
  useEffect(() => {
    if (!extractors || tool === 'auto') return;
    if (!extractors.providers.some((p) => p.id === tool && p.ready)) setTool('auto');
  }, [extractors, tool]);

  function chooseTool(value) {
    setTool(value);
    try { localStorage.setItem(STORAGE_KEY, value); } catch { /* storage unavailable */ }
  }

  const activeId = tool === 'auto' ? extractors?.auto_provider : tool;
  const active = extractors?.providers.find((p) => p.id === activeId);

  async function send(files) {
    if (!files?.length) return;
    setBusy(true);
    setMessage(null);
    try {
      const { documents } = await api.upload(files, tool, split);
      const n = documents.length;
      setMessage({ kind: 'ok', text: `${n} ${n === 1 ? 'file' : 'files'} added. ${toolName(activeId, extractors) || 'Extraction'} is reading ${n === 1 ? 'it' : 'them'} now${split ? ', and will split any PDF that holds several invoices' : ''}.` });
      onUploaded?.();
    } catch (e) {
      setMessage({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div
      className={`tray ${dragging ? 'tray-over' : ''} ${busy ? 'tray-busy' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); send(e.dataTransfer.files); }}
    >
      <div className="tray-sheets" aria-hidden="true"><span /><span /><span /></div>
      <div className="tray-copy">
        <p className="tray-title">{busy ? 'Uploading…' : 'Drop invoices and receipts here'}</p>
        <p className="tray-hint">
          {active
            ? <>{active.name} reads {fileTypes(active)} files. Up to 25 at a time.</>
            : <>No extraction tool is set up. <Link to="/extraction">Set one up</Link>.</>}
        </p>
        {message && <p className={`tray-msg tray-msg-${message.kind}`} role="status">{message.text}</p>}
      </div>
      <div className="tray-actions">
        <label className="tool-pick" htmlFor="upload-tool">
          <span>Extract with</span>
          <ToolSelect id="upload-tool" extractors={extractors} value={tool} onChange={chooseTool} disabled={busy} />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
          Choose files
        </button>
        <label className="split-pick">
          <input type="checkbox" checked={split} disabled={busy}
            onChange={(e) => { setSplit(e.target.checked); try { localStorage.setItem(SPLIT_KEY, e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } }} />
          <span>Split PDFs that hold several invoices</span>
        </label>
      </div>
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => send(e.target.files)} />
    </div>
  );
}
