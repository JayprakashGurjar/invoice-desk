import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, SIGNED_OUT } from './api.js';
import { SessionProvider, useSession } from './session.jsx';
import { resetExtractors, useExtractors } from './useExtractors.js';
import Inbox from './pages/Inbox.jsx';
import InvoiceReview from './pages/InvoiceReview.jsx';
import PartyList from './pages/PartyList.jsx';
import PartyDetail from './pages/PartyDetail.jsx';
import ExtractionTools from './pages/ExtractionTools.jsx';
import Approvals from './pages/Approvals.jsx';
import Login from './pages/Login.jsx';
import AuditLog from './pages/AuditLog.jsx';
import NotificationBell from './components/NotificationBell.jsx';

export default function App() {
  const [session, setSession] = useState(undefined);   // undefined = checking, null = signed out

  const check = useCallback(() => {
    api.me().then(setSession).catch((e) => setSession(e.status === 401 ? null : { error: e.message }));
  }, []);
  useEffect(() => { check(); }, [check]);
  useEffect(() => {
    const onSignedOut = () => { resetExtractors(); setSession(null); };
    window.addEventListener(SIGNED_OUT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT, onSignedOut);
  }, []);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    resetExtractors();
    setSession(null);
  }, []);

  if (session === undefined) return <div className="login"><p className="empty">Loading…</p></div>;
  if (session?.error) return <div className="login"><p className="alert alert-error">The InvoiceDesk API isn't responding. {session.error}</p></div>;
  if (session === null) return <Login onSignedIn={(s) => { resetExtractors(); setSession(s); }} />;

  return (
    <SessionProvider session={session} onSignOut={signOut}>
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  const { user, capabilities, feed, signOut } = useSession();
  const extractors = useExtractors();
  const [health, setHealth] = useState(null);
  // "N documents are waiting for your approval": shown on sign-in and whenever the app is
  // opened with documents waiting, until dismissed for this browser session.
  const dismissKey = `invoicedesk:approvals-banner:${user.agrno}:${user.userId}`;
  const [welcomeShown, setWelcomeShownState] = useState(() => {
    try { return sessionStorage.getItem(dismissKey) === '1'; } catch { return false; }
  });
  const setWelcomeShown = () => {
    setWelcomeShownState(true);
    try { sessionStorage.setItem(dismissKey, '1'); } catch { /* private mode */ }
  };
  const location = useLocation();
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth({ ok: false })); }, []);

  const auto = extractors?.providers?.find((p) => p.id === extractors.auto_provider);
  const aiReady = extractors?.providers?.some((p) => p.ready && p.kind !== 'basic');
  const pending = feed.pending_approval_count;
  const showWelcome = !welcomeShown && pending > 0 && location.pathname !== '/approvals';

  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="wordmark" aria-label="InvoiceDesk home">
          <span className="wordmark-mark" aria-hidden="true" />
          <span className="wordmark-text">InvoiceDesk</span>
        </NavLink>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>Inbox</NavLink>
          {capabilities.approvals && (
            <NavLink to="/approvals">
              Approvals{pending > 0 && <span className="nav-count" aria-label={`${pending} waiting`}>{pending}</span>}
            </NavLink>
          )}
          <NavLink to="/suppliers">Suppliers</NavLink>
          <NavLink to="/customers">Customers</NavLink>
          <NavLink to="/extraction">Extraction tools</NavLink>
          {capabilities.audit && <NavLink to="/audit">Audit log</NavLink>}
        </nav>
        <span className="spacer" />
        {extractors && !extractors.error && (
          <NavLink to="/extraction" className={`engine ${aiReady ? 'engine-ai' : auto ? 'engine-basic' : 'engine-down'}`}>
            {auto ? `Automatic: ${auto.name}` : 'No extraction tool'}
          </NavLink>
        )}
        {capabilities.approvals && <NotificationBell />}
        {capabilities.auth && (
          <div className="usermenu">
            <span className="usermenu-name" title={`${user.email}, agreement ${user.agrno}`}>{user.name}</span>
            <button type="button" className="link-button" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>

      {health?.data && !health.data.ok && (
        <div className="banner banner-error" role="alert">
          The DocuSoft web service isn't responding, so documents can't be loaded or saved. {health.data.error}
        </div>
      )}

      {showWelcome && (
        <div className="banner banner-approval" role="status">
          <span>{pending === 1 ? '1 document is' : `${pending} documents are`} waiting for your approval.</span>
          <Link to="/approvals" onClick={() => setWelcomeShown(true)}>Review now</Link>
          <button type="button" className="link-button" onClick={() => setWelcomeShown(true)}>Later</button>
        </div>
      )}

      {extractors && !extractors.error && !aiReady && (
        <div className="banner">
          {extractors.mode === 'remote'
            ? 'No extraction tool is set up for this agreement yet, so uploaded documents can’t be read. '
            : 'Only basic text matching is available, so scans and photos can’t be read and line items won’t be captured. '}
          <NavLink to="/extraction">Set up an extraction tool</NavLink> such as Claude, AWS Textract, Google Document AI or Azure.
        </div>
      )}

      <main className="main">
        <Routes>
          <Route path="/" element={<Inbox />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/invoices/:id" element={<InvoiceReview />} />
          <Route path="/suppliers" element={<PartyList kind="supplier" />} />
          <Route path="/suppliers/:id" element={<PartyDetail kind="supplier" />} />
          <Route path="/customers" element={<PartyList kind="customer" />} />
          <Route path="/customers/:id" element={<PartyDetail kind="customer" />} />
          <Route path="/extraction" element={<ExtractionTools />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="*" element={<p className="empty">This page doesn't exist.</p>} />
        </Routes>
      </main>
    </div>
  );
}
