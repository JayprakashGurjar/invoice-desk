import { STATUS_LABELS } from '../format.js';

export default function StatusStamp({ status }) {
  return (
    <span className={`stamp stamp-${status}`}>
      {(status === 'processing' || status === 'queued') && <span className="stamp-spinner" aria-hidden="true" />}
      {STATUS_LABELS[status] || status}
    </span>
  );
}
