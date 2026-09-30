import { Link } from 'react-router-dom';
import { ago, money } from '../format.js';
import { toolName, useExtractors } from '../useExtractors.js';

export const AUDIT_ACTIONS = {
  uploaded: 'Uploaded',
  extraction_requested: 'Extraction re-run',
  extracted: 'Extracted',
  extraction_failed: 'Extraction failed',
  edited: 'Edited',
  submitted_for_approval: 'Sent for approval',
  reassigned: 'Sent to another approver',
  approved: 'Approved',
  approved_directly: 'Approved without approver',
  rejected: 'Rejected',
  returned_for_review: 'Sent back for review',
  status_changed: 'Status changed',
  deleted: 'Deleted',
  exported: 'Exported to CSV',
  settings_changed: 'Settings changed',
  split: 'Split into documents',
  created_from_split: 'Created from a merged file',
};

const FIELDS = {
  status: 'Status', document_type: 'Document type', invoice_number: 'Invoice number', invoice_date: 'Invoice date', due_date: 'Due date',
  po_number: 'PO number', currency: 'Currency', payment_terms: 'Payment terms', payment_method: 'Payment method',
  supplier: 'Supplier', supplier_vat_number: 'Supplier VAT number', customer: 'Customer', subtotal: 'Subtotal',
  discount_total: 'Discount', tax_total: 'Tax', shipping: 'Shipping', total_amount: 'Total', amount_paid: 'Amount paid',
  amount_due: 'Amount due', notes: 'Notes', line_item_count: 'Line items', line_items_net_total: 'Line items net total',
  tax_line_count: 'Tax lines', tax_lines_total: 'Tax lines total',
};
const SETTINGS = {
  tool_settings_saved: 'Saved settings for', tool_settings_removed: 'Removed settings for',
  default_tool_changed: 'Automatic tool set to', approval_policy_changed: 'Approval rule set to',
};
const TONE = { approved: 'ok', approved_directly: 'ok', rejected: 'bad', extraction_failed: 'bad', deleted: 'bad', returned_for_review: 'review', edited: 'edit' };

function Summary({ e, extractors, showDocument }) {
  const d = e.details || {};
  const quote = d.comment ? <q>{d.comment}</q> : null;
  switch (e.action) {
    case 'uploaded': {
      const file = showDocument && d.file === e.document_label ? null : d.file;
      const tool = d.tool && d.tool !== 'auto' ? `to be read by ${toolName(d.tool, extractors)}` : null;
      return <>{[file, tool].filter(Boolean).join(', ')}</>;
    }
    case 'extraction_requested': return <>with {toolName(d.tool, extractors) || 'Automatic'}</>;
    case 'extracted': return <>by {toolName(d.tool, extractors)}{d.confidence != null ? `, ${Math.round(d.confidence * 100)}% confidence` : ''}{d.issue_count ? `, ${d.issue_count} to check` : ''}</>;
    case 'extraction_failed': return <>{toolName(d.tool, extractors)}{d.tool ? ': ' : ''}{d.error}</>;
    case 'submitted_for_approval':
    case 'reassigned': return <>to {d.to_user}{quote && ': '}{quote}</>;
    case 'rejected':
    case 'returned_for_review':
    case 'approved': return quote;
    case 'status_changed': return <>{d.from_status} to {d.to_status}</>;
    case 'deleted': return <>{d.document?.total_amount != null ? `total ${money(d.document.total_amount, d.document.currency)}` : d.file}</>;
    case 'exported': return <>{d.rows} lines{d.date_from || d.date_to ? `, ${d.date_from || '…'} to ${d.date_to || '…'}` : ''}</>;
    case 'split': return <>{d.parts?.length} documents ({d.parts?.map((p) => `pages ${p.pages}`).join(', ')}){d.found_by ? `, found by ${d.found_by === 'manual' ? 'hand' : d.found_by === 'text' ? 'the page text' : toolName(d.found_by, extractors)}` : ''}</>;
    case 'created_from_split': return <>pages {d.pages} of {d.parent_invoice_id ? <Link to={`/invoices/${d.parent_invoice_id}`}>{d.parent_file}</Link> : d.parent_file}</>;
    case 'settings_changed': return <>{SETTINGS[d.change] || d.change} {d.tool ? toolName(d.tool, extractors) : d.value === 'auto' ? 'the first ready tool' : d.value}{d.fields?.length ? ` (${d.fields.join(', ')})` : ''}</>;
    default: return null;
  }
}

function Changes({ changes }) {
  if (!changes?.length) return null;
  return (
    <table className="audit-changes">
      <tbody>
        {changes.map((c) => (
          <tr key={c.field}>
            <th>{FIELDS[c.field] || c.field}</th>
            <td className="audit-from">{c.from ?? <span className="muted">empty</span>}</td>
            <td aria-hidden="true">→</td>
            <td className="audit-to">{c.to ?? <span className="muted">empty</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A list of audit entries. showDocument adds the document and supplier (for the global log). */
export default function AuditEntries({ entries, showDocument = false }) {
  const extractors = useExtractors();
  return (
    <ol className="audit">
      {entries.map((e) => {
        const changes = e.details?.changes;
        const time = new Date(`${e.created_at}Z`);
        return (
          <li key={e.id} className={`audit-entry audit-${TONE[e.action] || 'plain'}`}>
            <div className="audit-line">
              <span className="audit-action">{AUDIT_ACTIONS[e.action] || e.action}</span>
              {showDocument && e.invoice_id && (
                <span className="audit-doc">
                  {e.document_exists ? <Link to={`/invoices/${e.invoice_id}`}>{e.document_label || `Document ${e.invoice_id}`}</Link> : <span>{e.document_label || `Document ${e.invoice_id}`}</span>}
                  {e.supplier_name && <span className="muted"> · {e.supplier_name}</span>}
                </span>
              )}
              <span className="audit-summary"><Summary e={e} extractors={extractors} showDocument={showDocument} /></span>
              <span className="audit-meta">
                {e.user_name || 'System'} · <time dateTime={time.toISOString()} title={time.toLocaleString('en-GB')}>{ago(e.created_at)}</time>
              </span>
            </div>
            {changes?.length > 0 && (e.action === 'extracted'
              ? <details className="audit-more"><summary>{changes.length} fields read</summary><Changes changes={changes} /></details>
              : <Changes changes={changes} />)}
          </li>
        );
      })}
    </ol>
  );
}
