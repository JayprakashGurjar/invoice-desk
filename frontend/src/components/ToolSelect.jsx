import { toolName } from '../useExtractors.js';

/** Dropdown of extraction tools. Tools that aren't set up are listed but disabled. */
export default function ToolSelect({ extractors, value, onChange, id, disabled }) {
  const providers = extractors?.providers || [];
  const autoName = toolName(extractors?.auto_provider, extractors);
  return (
    <select id={id} className="input tool-select" value={value} disabled={disabled || !extractors}
      onChange={(e) => onChange(e.target.value)}>
      <option value="auto">{autoName ? `Automatic (${autoName})` : 'Automatic'}</option>
      <optgroup label="Ready">
        {providers.filter((p) => p.ready).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </optgroup>
      {providers.some((p) => !p.ready) && (
        <optgroup label="Not set up">
          {providers.filter((p) => !p.ready).map((p) => <option key={p.id} value={p.id} disabled>{p.name}</option>)}
        </optgroup>
      )}
    </select>
  );
}
