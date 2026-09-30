/**
 * Sign-in for the React app.
 *
 * With DATA_BACKEND=asmx users sign in with their DocuSoft agreement number, email and
 * password, checked by the web service (Json_InvoiceDeskLogin -> GetAccessToken). The
 * credentials are kept only in this server's memory, in a session identified by a random
 * HttpOnly cookie, and are used for that user's web-service calls. They are never sent back
 * to the browser. Sessions end after 8 hours without activity, on sign-out, or when the API
 * restarts.
 *
 * With DATA_BACKEND=knex (offline development) there are no user accounts: everyone is
 * a single local user.
 */
import crypto from 'node:crypto';
import express from 'express';
import * as repo from './services/repository.js';
import { publicUser, runAs } from './context.js';

const COOKIE = 'invoicedesk_sid';
const IDLE_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();          // sid -> { user, expires }
const failures = new Map();          // ip|email -> { count, until }
const LOCAL_USER = { userId: 1, email: 'local', name: 'Local user', agrno: 'LOCAL', password: '' };

setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (s.expires < now) sessions.delete(sid);
  for (const [k, f] of failures) if (f.until < now) failures.delete(k);
}, 15 * 60 * 1000).unref();

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(req, res, value, maxAgeSeconds) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`);
}

/** Attaches req.user (if signed in) and runs the rest of the request as that user. */
export function authenticate(req, res, next) {
  if (!repo.capabilities.auth) {
    req.user = LOCAL_USER;
    return runAs(LOCAL_USER, next);
  }
  const sid = cookies(req)[COOKIE];
  const session = sid && sessions.get(sid);
  if (session && session.expires > Date.now()) {
    session.expires = Date.now() + IDLE_MS;
    req.user = session.user;
    req.sessionId = sid;
    return runAs(session.user, next);
  }
  if (sid) sessions.delete(sid);
  return next();
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  res.status(401).json({ error: 'Please sign in.' });
}

/** If the web service rejects a signed-in user's login (e.g. password changed), end the session. */
export function endSessionOnAuthError(err, req, res, next) {
  if (err?.code === 'AUTH' && req.sessionId) {
    sessions.delete(req.sessionId);
    setCookie(req, res, '', 0);
    return res.status(401).json({ error: 'Your DocuSoft login is no longer valid. Please sign in again.' });
  }
  next(err);
}

/** Called after each successful sign-in (used to resume that agreement's queued documents). */
export const signInListeners = [];

export const authRouter = express.Router();

authRouter.get('/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.', capabilities: repo.capabilities });
  res.json({ user: publicUser(req.user), capabilities: repo.capabilities });
});

authRouter.post('/login', async (req, res, next) => {
  if (!repo.capabilities.auth) return res.json({ user: publicUser(LOCAL_USER), capabilities: repo.capabilities });
  const agrno = String(req.body?.agrno || '').trim();
  const email = String(req.body?.email || '').trim();
  const password = String(req.body?.password || '');
  if (!agrno || !email || !password) return res.status(400).json({ error: 'Enter your agreement number, email and password.' });

  const key = `${req.ip}|${email.toLowerCase()}`;
  const f = failures.get(key);
  if (f && f.count >= 5 && f.until > Date.now()) {
    return res.status(429).json({ error: 'Too many failed sign-in attempts. Wait 10 minutes and try again.' });
  }
  try {
    const found = await repo.login({ agrno, email, password });
    failures.delete(key);
    const user = { agrno, email, password, userId: found.userId, name: found.name || email };
    const sid = crypto.randomBytes(32).toString('base64url');
    sessions.set(sid, { user, expires: Date.now() + IDLE_MS });
    setCookie(req, res, sid, IDLE_MS / 1000);
    for (const listener of signInListeners) Promise.resolve().then(() => listener(user)).catch((e) => console.error(e));
    res.json({ user: publicUser(user), capabilities: repo.capabilities });
  } catch (err) {
    if (err.code === 'AUTH') {
      const prev = failures.get(key);
      failures.set(key, { count: (prev?.count || 0) + 1, until: Date.now() + 10 * 60 * 1000 });
      return res.status(401).json({ error: 'The agreement number, email or password is incorrect.' });
    }
    next(err);
  }
});

authRouter.post('/logout', (req, res) => {
  if (req.sessionId) sessions.delete(req.sessionId);
  setCookie(req, res, '', 0);
  res.status(204).end();
});
