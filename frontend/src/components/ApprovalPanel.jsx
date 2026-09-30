import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { ago } from '../format.js';
import { useSession } from '../session.jsx';

const ACTIONS = {
  submitted: (h) => `${h.from_user_name} sent it to ${h.to_user_name} for approval`,
  reassigned: (h) => `${h.from_user_name} sent it to ${h.to_user_name} instead`,
  approved: (h) => `${h.from_user_name} approved it`,
  approved_directly: (h) => `${h.from_user_name} approved it without an approver`,
  rejected: (h) => `${h.from_user_name} rejected it`,
  returned: (h) => `${h.from_user_name} sent it back for review`,
};

/**
 * Approval workflow on the review page. persist() saves unsaved edits first and returns
 * the saved document; onUpdated(doc) refreshes the page with the result.
 */
export default function ApprovalPanel({ doc, dirty, busy, persist, onUpdated, onError }) {
  const { user, capabilities, refreshFeed } = useSession();
  const [approvers, setApprovers] = useState(null);
  const [approver, setApprover] = useState('');
  const [comment, setComment] = useState('');
  const [working, setWorking] = useState(null);
  const [reassign, setReassign] = useState(false);
  const inv = doc.invoice;
  const status = inv.status;
  const isApprover = status === 'pending_approval' && Number(inv.assigned_to) === Number(user.userId);
  const canSubmit = ['extracted', 'needs_review', 'rejected'].includes(status) || (status === 'pending_approval' && !isApprover && reassign);

  useEffect(() => {
    if (!canSubmit || approvers) return;
    api.approvers().then((list) => {
      setApprovers(list);
      if (list.length === 1) setApprover(String(list[0].user_id));
    }).catch((e) => onError(e.message));
  }, [canSubmit, approvers, onError]);

  useEffect(() => { setComment(''); setReassign(false); }, [status, inv.assigned_to]);

  if (!capabilities.approvals) return null;

  async function run(label, fn) {
    setWorking(label);
    onError(null);
    try {
      if (dirty) await persist();
      const updated = await fn();
      onUpdated(updated, label);
      refreshFeed();
    } catch (e) {
      onError(e.message);
    } finally {
      setWorking(null);
    }
  }

  const submit = () => run('sent', () => api.assign(inv.id, Number(approver), comment.trim()));
  const decide = (decision) => {
    if (decision !== 'approve' && !comment.trim()) {
      onError(decision === 'reject' ? 'Add a comment saying why you are rejecting it.' : 'Add a comment saying what needs another look.');
      return;
    }
    run(decision, () => api.decide(inv.id, decision, comment.trim()));
  };

  return (
    <div className="block approval">
      <h2>Approval</h2>

      {status === 'pending_approval' && isApprover && (
        <>
          <p className="approval-status">
            <strong>{inv.assigned_by_name}</strong> sent this to you for approval {ago(inv.assigned_at)}.
            {inv.approval_comment && <span className="approval-quote">“{inv.approval_comment}”</span>}
          </p>
          <label className="field field-wide">
            <span className="field-label">Comment (needed to reject or send back)</span>
            <textarea className="input" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional when approving" />
          </label>
          <div className="approval-actions">
            <button type="button" className="btn btn-primary" disabled={busy || !!working} onClick={() => decide('approve')}>
              {working === 'approve' ? 'Approving…' : dirty ? 'Save and approve' : 'Approve'}
            </button>
            <button type="button" className="btn btn-quiet" disabled={busy || !!working} onClick={() => decide('return')}>
              {working === 'return' ? 'Sending back…' : 'Send back for review'}
            </button>
            <button type="button" className="btn btn-danger-quiet" disabled={busy || !!working} onClick={() => decide('reject')}>
              {working === 'reject' ? 'Rejecting…' : 'Reject'}
            </button>
          </div>
        </>
      )}

      {status === 'pending_approval' && !isApprover && (
        <p className="approval-status">
          Waiting for <strong>{inv.assigned_to_name}</strong> to approve, since {ago(inv.assigned_at)}.
          {inv.approval_comment && <span className="approval-quote">“{inv.approval_comment}”</span>}
          {!reassign && <button type="button" className="link-button" onClick={() => setReassign(true)}>Send to someone else</button>}
        </p>
      )}

      {status === 'rejected' && (
        <p className="approval-status approval-rejected">
          <strong>{inv.rejected_by_name}</strong> rejected this {ago(inv.rejected_at)}.
          {inv.approval_comment && <span className="approval-quote">“{inv.approval_comment}”</span>}
        </p>
      )}

      {status === 'approved' && (
        <p className="approval-status approval-approved">
          Approved{inv.approved_by_name ? <> by <strong>{inv.approved_by_name}</strong></> : ''} {ago(inv.approved_at)}.
          {inv.approval_comment && <span className="approval-quote">“{inv.approval_comment}”</span>}
        </p>
      )}

      {canSubmit && (
        <div className="approval-submit">
          {approvers && approvers.length === 0
            ? <p className="muted">There's nobody to send it to yet. People appear here once they've signed in to InvoiceDesk.</p>
            : (
              <>
                <div className="grid">
                  <label className="field">
                    <span className="field-label">Send for approval to</span>
                    <select className="input" value={approver} onChange={(e) => setApprover(e.target.value)} disabled={!approvers}>
                      <option value="">{approvers ? 'Choose a person' : 'Loading…'}</option>
                      {approvers?.map((a) => <option key={a.user_id} value={a.user_id}>{a.name}{a.email && a.email !== a.name ? ` (${a.email})` : ''}</option>)}
                    </select>
                  </label>
                  <label className="field field-wide">
                    <span className="field-label">Note for the approver (optional)</span>
                    <input className="input" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
                  </label>
                </div>
                <div className="approval-actions">
                  <button type="button" className="btn btn-primary" disabled={busy || !approver || !!working} onClick={submit}>
                    {working === 'sent' ? 'Sending…' : dirty ? 'Save and send for approval' : 'Send for approval'}
                  </button>
                  {reassign && <button type="button" className="btn btn-quiet" onClick={() => setReassign(false)}>Cancel</button>}
                </div>
              </>
            )}
        </div>
      )}

      {doc.history?.length > 0 && (
        <ol className="history">
          {doc.history.map((h) => (
            <li key={h.id}>
              <span className="history-what">{(ACTIONS[h.action] || ((x) => x.action))(h)}</span>
              <span className="history-when">{ago(h.created_at)}</span>
              {h.comment && <span className="history-comment">“{h.comment}”</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
