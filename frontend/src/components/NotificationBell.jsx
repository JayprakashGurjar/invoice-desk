import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ago } from '../format.js';
import { useSession } from '../session.jsx';

const ICON = { approval_requested: 'Approve', approved: 'Approved', rejected: 'Rejected', returned: 'Returned' };

export default function NotificationBell() {
  const { feed, refreshFeed } = useSession();
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return undefined;
    refreshFeed();
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open, refreshFeed]);

  async function openItem(n) {
    setOpen(false);
    if (!n.is_read) api.markRead(n.id).then(refreshFeed).catch(() => {});
    if (n.invoice_id) navigate(`/invoices/${n.invoice_id}`);
  }

  async function readAll() {
    await api.markRead(0).catch(() => {});
    refreshFeed();
  }

  const unread = feed.unread_count;
  return (
    <div className="bell" ref={box}>
      <button type="button" className="bell-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z" /></svg>
        {unread > 0 && <span className="bell-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" className="link-button" onClick={readAll}>Mark all as read</button>}
          </div>
          {feed.notifications.length === 0
            ? <p className="bell-empty">Nothing yet. You'll see documents sent to you for approval here, and decisions on documents you sent.</p>
            : (
              <ul className="bell-list">
                {feed.notifications.map((n) => (
                  <li key={n.id}>
                    <button type="button" className={`bell-item ${n.is_read ? '' : 'bell-unread'}`} onClick={() => openItem(n)}>
                      <span className={`bell-tag bell-tag-${n.type}`}>{ICON[n.type] || 'Update'}</span>
                      <span className="bell-message">{n.message}</span>
                      <span className="bell-time">{ago(n.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
