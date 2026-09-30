import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

const SessionContext = createContext(null);

/** Signed-in user, what the backend supports, and the notification summary (polled). */
export function SessionProvider({ session, onSignOut, children }) {
  const [feed, setFeed] = useState({ notifications: [], unread_count: 0, pending_approval_count: 0 });
  const timer = useRef(null);
  const approvals = session.capabilities?.approvals;

  const refreshFeed = useCallback(async () => {
    if (!approvals) return;
    try { setFeed(await api.notifications()); } catch { /* shown elsewhere */ }
  }, [approvals]);

  useEffect(() => {
    if (!approvals) return undefined;
    refreshFeed();
    const tick = () => { if (document.visibilityState === 'visible') refreshFeed(); };
    timer.current = setInterval(tick, 45000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer.current); document.removeEventListener('visibilitychange', tick); };
  }, [approvals, refreshFeed]);

  const value = { ...session, feed, refreshFeed, signOut: onSignOut };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
