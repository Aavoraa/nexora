import crypto from 'node:crypto';
import { one, pool } from './db.js';

const SESSION_COOKIE = 'cadence_sid';
const SESSION_DAYS = 14;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const SHORT_SESSION_HOURS = 12;

/**
 * Start a session. `remember` keeps it for 14 days; otherwise the cookie ends with the
 * browser session and the server expires it after 12 hours at most.
 */
export async function startSession(res, userId, remember = true) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + (remember ? SESSION_DAYS * 24 : SHORT_SESSION_HOURS) * 3600_000);
  await pool.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, $3)',
    [token, userId, expires]);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    ...(remember ? { expires } : {}),
  });
}

export async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.clearCookie(SESSION_COOKIE);
}

/** Attaches req.user (or null) from the session cookie. */
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return next();
  try {
    const row = await one(`
      SELECT u.id, u.workspace_id, u.username, u.display_name, u.role, u.can_approve,
             s.expires_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1`, [token]);
    if (row && row.expires_at > new Date()) {
      delete row.expires_at;
      row.can_approve = row.can_approve || row.role === 'owner' || row.role === 'admin';
      req.user = row;
    } else if (row) {
      await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

const RANK = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const roleAtLeast = (user, min) => RANK[user.role] >= RANK[min];

/** Gate a route on a minimum role. */
export const requireRole = (min) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (!roleAtLeast(req.user, min)) return res.status(403).json({ error: 'You do not have permission to do that' });
  next();
};
