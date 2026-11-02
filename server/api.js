import express from 'express';
import { many, one, pool, tx, logActivity } from './db.js';
import {
  hashPassword, verifyPassword, startSession, endSession,
  requireUser, requireRole,
} from './auth.js';
import { PLATFORMS } from './platforms.js';
import { generateDrafts } from './ai.js';
import { aiSettings, aiAvailable } from './aiproviders.js';
import { upcomingSlots, isValidTimeZone } from './time.js';
import { normalizeGstin } from './gstin.js';
import { loginLimit, registerLimit, aiLimit } from './ratelimit.js';
import { loans } from './loans.js';
import { integrations } from './integrations.js';
import { linksApi } from './links.js';
import { library } from './library.js';
import { reports } from './reports.js';
import {
  listMedia, createUpload, completeUpload, deleteMedia, validMediaIds, setPostMedia,
  publicMedia, POST_MEDIA_SQL,
} from './media.js';

export const api = express.Router();

/** Wrap an async handler so rejections reach the error middleware. */
const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };

const str = (v, max = 10_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fail(400, 'Invalid id');
};

// Mutations must be JSON: blocks cross-site form posts riding on the session cookie.
api.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected application/json' });
  }
  next();
});

// ---------- auth ----------

const USERNAME_RE = /^[a-z0-9_.-]{3,32}$/i;

api.post('/auth/register', registerLimit, ah(async (req, res) => {
  const workspace = str(req.body.workspace, 80);
  const username = str(req.body.username, 32);
  const displayName = str(req.body.display_name, 80) || username;
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const timezone = isValidTimeZone(req.body.timezone) ? req.body.timezone : 'UTC';

  if (!workspace) fail(400, 'Workspace name is required');
  if (!USERNAME_RE.test(username)) fail(400, 'Username must be 3–32 letters, numbers, dots, dashes or underscores');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) fail(409, 'That username is taken');

  const userId = await tx(async (c) => {
    const ws = (await c.query('INSERT INTO workspaces (name, timezone) VALUES ($1, $2) RETURNING id',
      [workspace, timezone])).rows[0];
    const user = (await c.query(
      `INSERT INTO users (workspace_id, username, password_hash, display_name, role, can_approve)
       VALUES ($1, $2, $3, $4, 'owner', TRUE) RETURNING id`,
      [ws.id, username, hashPassword(password), displayName])).rows[0];
    const brand = (await c.query('INSERT INTO brands (workspace_id, name) VALUES ($1, $2) RETURNING id',
      [ws.id, workspace])).rows[0];
    // A sensible default posting schedule: weekdays at 09:00 and 15:00.
    for (let wd = 1; wd <= 5; wd++) {
      await c.query('INSERT INTO queue_slots (brand_id, weekday, time) VALUES ($1, $2, $3), ($1, $2, $4)',
        [brand.id, wd, '09:00', '15:00']);
    }
    return user.id;
  });
  const u = await one('SELECT workspace_id FROM users WHERE id = $1', [userId]);
  await logActivity(u.workspace_id, userId, 'workspace.created', workspace);
  await startSession(res, userId);
  res.status(201).json({ ok: true });
}));

api.post('/auth/login', loginLimit, ah(async (req, res) => {
  const username = str(req.body.username, 32);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const user = await one('SELECT id, workspace_id, password_hash FROM users WHERE lower(username) = lower($1)', [username]);
  if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'Wrong username or password');
  await startSession(res, user.id, req.body.remember === true);
  await logActivity(user.workspace_id, user.id, 'user.login');
  res.json({ ok: true });
}));

api.post('/auth/logout', ah(async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
}));

api.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const workspace = await one('SELECT id, name, require_approval, timezone, loans_enabled, currency FROM workspaces WHERE id = $1',
    [req.user.workspace_id]);
  res.json({ user: req.user, workspace, platforms: PLATFORMS, ai_enabled: await aiAvailable(req.user.workspace_id) });
}));

// Everything below requires a session.
api.use(requireUser);

// ---------- workspace ----------

api.patch('/workspace', requireRole('admin'), ah(async (req, res) => {
  const { name, require_approval, timezone, loans_enabled, currency } = req.body;
  if (timezone !== undefined && !isValidTimeZone(timezone)) fail(400, 'Unknown time zone');
  if (currency !== undefined && !(typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
    && Intl.supportedValuesOf('currency').includes(currency))) fail(400, 'Unknown currency code');
  const ws = await one(`
    UPDATE workspaces SET
      name = COALESCE(NULLIF($2, ''), name),
      require_approval = COALESCE($3, require_approval),
      timezone = COALESCE($4, timezone),
      loans_enabled = COALESCE($5, loans_enabled),
      currency = COALESCE($6, currency)
    WHERE id = $1 RETURNING id, name, require_approval, timezone, loans_enabled, currency`,
    [req.user.workspace_id, str(name, 80), typeof require_approval === 'boolean' ? require_approval : null,
      timezone ?? null, typeof loans_enabled === 'boolean' ? loans_enabled : null, currency ?? null]);
  await logActivity(req.user.workspace_id, req.user.id, 'workspace.updated');
  res.json(ws);
}));

api.get('/activity', ah(async (req, res) => {
  res.json(await many(`
    SELECT a.id, a.action, a.detail, a.created_at, u.display_name AS user
    FROM activity a LEFT JOIN users u ON u.id = a.user_id
    WHERE a.workspace_id = $1 ORDER BY a.created_at DESC LIMIT 100`, [req.user.workspace_id]));
}));

// ---------- team ----------

api.get('/team', ah(async (req, res) => {
  res.json(await many(`
    SELECT id, username, display_name, role, can_approve, created_at
    FROM users WHERE workspace_id = $1 ORDER BY created_at`, [req.user.workspace_id]));
}));

const ROLES = ['admin', 'editor', 'viewer'];

api.post('/team', requireRole('admin'), ah(async (req, res) => {
  const username = str(req.body.username, 32);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const role = ROLES.includes(req.body.role) ? req.body.role : 'editor';
  if (role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can add admins');
  if (!USERNAME_RE.test(username)) fail(400, 'Username must be 3–32 letters, numbers, dots, dashes or underscores');
  if (password.length < 8) fail(400, 'Temporary password must be at least 8 characters');
  if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) fail(409, 'That username is taken');
  const member = await one(`
    INSERT INTO users (workspace_id, username, password_hash, display_name, role, can_approve)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, username, display_name, role, can_approve, created_at`,
    [req.user.workspace_id, username, hashPassword(password), str(req.body.display_name, 80) || username,
      role, !!req.body.can_approve]);
  await logActivity(req.user.workspace_id, req.user.id, 'team.added', `${username} (${role})`);
  res.status(201).json(member);
}));

async function teammate(req, id) {
  const m = await one('SELECT id, username, role FROM users WHERE id = $1 AND workspace_id = $2',
    [id, req.user.workspace_id]);
  if (!m) fail(404, 'Team member not found');
  if (m.role === 'owner') fail(403, 'The workspace owner cannot be changed here');
  if (m.id === req.user.id) fail(400, 'You cannot change your own access');
  if (m.role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can change admins');
  return m;
}

api.patch('/team/:id', requireRole('admin'), ah(async (req, res) => {
  const m = await teammate(req, intId(req.params.id));
  const role = req.body.role === undefined ? null : (ROLES.includes(req.body.role) ? req.body.role : fail(400, 'Unknown role'));
  if (role === 'admin' && req.user.role !== 'owner') fail(403, 'Only the owner can add admins');
  const updated = await one(`
    UPDATE users SET role = COALESCE($2, role), can_approve = COALESCE($3, can_approve)
    WHERE id = $1 RETURNING id, username, display_name, role, can_approve, created_at`,
    [m.id, role, typeof req.body.can_approve === 'boolean' ? req.body.can_approve : null]);
  await logActivity(req.user.workspace_id, req.user.id, 'team.updated', m.username);
  res.json(updated);
}));

api.delete('/team/:id', requireRole('admin'), ah(async (req, res) => {
  const m = await teammate(req, intId(req.params.id));
  await pool.query('DELETE FROM users WHERE id = $1', [m.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'team.removed', m.username);
  res.json({ ok: true });
}));

// ---------- brands & channels ----------

async function brandFor(req, id) {
  const b = await one('SELECT * FROM brands WHERE id = $1 AND workspace_id = $2', [id, req.user.workspace_id]);
  return b || fail(404, 'Brand not found');
}

api.get('/brands', ah(async (req, res) => {
  const brands = await many('SELECT * FROM brands WHERE workspace_id = $1 ORDER BY created_at', [req.user.workspace_id]);
  const channels = await many(`
    SELECT c.* FROM channels c JOIN brands b ON b.id = c.brand_id
    WHERE b.workspace_id = $1 ORDER BY c.created_at`, [req.user.workspace_id]);
  res.json(brands.map((b) => ({ ...b, channels: channels.filter((c) => c.brand_id === b.id) })));
}));

const HEX = /^#[0-9a-f]{6}$/i;
const gstinOf = (v) => normalizeGstin(v) || fail(400, str(v, 40) ? 'Enter a valid 15-character GSTIN' : 'GSTIN is required');

api.post('/brands', requireRole('admin'), ah(async (req, res) => {
  const name = str(req.body.name, 80) || fail(400, 'Brand name is required');
  const gstin = gstinOf(req.body.gstin);
  const color = HEX.test(req.body.color) ? req.body.color : '#6d5efc';
  // Optional first channels, validated up front so a bad one creates nothing.
  const wanted = Array.isArray(req.body.channels) ? req.body.channels.slice(0, Object.keys(PLATFORMS).length) : [];
  const chans = wanted.map((ch) => ({
    platform: PLATFORMS[ch?.platform] ? ch.platform : fail(400, 'Unknown platform'),
    handle: str(ch?.handle, 100).replace(/^@/, '') || fail(400, 'Account handle is required'),
  }));
  const brand = await tx(async (c) => {
    const b = (await c.query('INSERT INTO brands (workspace_id, name, gstin, color, voice) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.workspace_id, name, gstin, color, str(req.body.voice, 2000)])).rows[0];
    for (let wd = 1; wd <= 5; wd++) {
      await c.query('INSERT INTO queue_slots (brand_id, weekday, time) VALUES ($1, $2, $3)', [b.id, wd, '10:00']);
    }
    b.channels = [];
    for (const ch of chans) {
      b.channels.push((await c.query('INSERT INTO channels (brand_id, platform, handle) VALUES ($1, $2, $3) RETURNING *',
        [b.id, ch.platform, ch.handle])).rows[0]);
    }
    return b;
  });
  await logActivity(req.user.workspace_id, req.user.id, 'brand.created', name);
  for (const ch of chans) {
    await logActivity(req.user.workspace_id, req.user.id, 'channel.added', `${PLATFORMS[ch.platform].label} @${ch.handle}`);
  }
  res.status(201).json(brand);
}));

api.patch('/brands/:id', requireRole('admin'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  const updated = await one(`
    UPDATE brands SET name = COALESCE(NULLIF($2, ''), name), color = COALESCE($3, color),
      voice = COALESCE($4, voice), gstin = COALESCE($5, gstin)
    WHERE id = $1 RETURNING *`,
    [b.id, str(req.body.name, 80), HEX.test(req.body.color) ? req.body.color : null,
      typeof req.body.voice === 'string' ? str(req.body.voice, 2000) : null,
      // Once set, a GSTIN can be corrected but not cleared.
      req.body.gstin === undefined ? null : gstinOf(req.body.gstin)]);
  res.json(updated);
}));

api.delete('/brands/:id', requireRole('admin'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  const { count } = await one('SELECT count(*) FROM brands WHERE workspace_id = $1', [req.user.workspace_id]);
  if (count <= 1) fail(400, 'A workspace needs at least one brand');
  await pool.query('DELETE FROM brands WHERE id = $1', [b.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'brand.deleted', b.name);
  res.json({ ok: true });
}));

api.post('/brands/:id/channels', requireRole('admin'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  const platform = PLATFORMS[req.body.platform] ? req.body.platform : fail(400, 'Unknown platform');
  const handle = str(req.body.handle, 100).replace(/^@/, '') || fail(400, 'Account handle is required');
  const ch = await one('INSERT INTO channels (brand_id, platform, handle) VALUES ($1, $2, $3) RETURNING *',
    [b.id, platform, handle]);
  await logActivity(req.user.workspace_id, req.user.id, 'channel.added', `${PLATFORMS[platform].label} @${handle}`);
  res.status(201).json(ch);
}));

api.delete('/brands/:id/channels/:cid', requireRole('admin'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  const { rowCount } = await pool.query('DELETE FROM channels WHERE id = $1 AND brand_id = $2',
    [intId(req.params.cid), b.id]);
  if (!rowCount) fail(404, 'Channel not found');
  res.json({ ok: true });
}));

// ---------- queue slots ----------

api.get('/brands/:id/slots', ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  res.json(await many('SELECT id, weekday, time FROM queue_slots WHERE brand_id = $1 ORDER BY weekday, time', [b.id]));
}));

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

api.put('/brands/:id/slots', requireRole('editor'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.params.id));
  const slots = Array.isArray(req.body.slots) ? req.body.slots : fail(400, 'slots must be a list');
  const clean = slots
    .filter((s) => Number.isInteger(s.weekday) && s.weekday >= 0 && s.weekday <= 6 && TIME_RE.test(s.time))
    .slice(0, 100);
  await tx(async (c) => {
    await c.query('DELETE FROM queue_slots WHERE brand_id = $1', [b.id]);
    for (const s of clean) {
      await c.query('INSERT INTO queue_slots (brand_id, weekday, time) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [b.id, s.weekday, s.time]);
    }
  });
  res.json(await many('SELECT id, weekday, time FROM queue_slots WHERE brand_id = $1 ORDER BY weekday, time', [b.id]));
}));

// ---------- posts ----------

const POST_COLUMNS = `
  p.id, p.brand_id, p.author_id, p.content, p.channel_ids, p.status,
  p.scheduled_at, p.published_at, p.approved_by, p.review_note, p.created_at, p.updated_at,
  a.display_name AS author_name, ap.display_name AS approver_name, ${POST_MEDIA_SQL}`;

/** Replace raw media rows with their public shape (signed URLs, readiness). */
const shapePost = (p) => ({ ...p, media: p.media.map(publicMedia) });
const POST_JOINS = `
  JOIN brands b ON b.id = p.brand_id
  LEFT JOIN users a ON a.id = p.author_id
  LEFT JOIN users ap ON ap.id = p.approved_by`;

async function postFor(req, id) {
  const p = await one(`SELECT ${POST_COLUMNS}, b.workspace_id FROM posts p ${POST_JOINS}
    WHERE p.id = $1 AND b.workspace_id = $2`, [id, req.user.workspace_id]);
  return p || fail(404, 'Post not found');
}

const reload = async (req, id) => {
  const p = await postFor(req, id);
  delete p.workspace_id;
  return shapePost(p);
};

api.get('/posts', ah(async (req, res) => {
  const where = ['b.workspace_id = $1'];
  const params = [req.user.workspace_id];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.brand_id) add('p.brand_id = ?', intId(req.query.brand_id));
  if (req.query.status) add('p.status = ANY(?)', String(req.query.status).split(','));
  if (req.query.from) add('COALESCE(p.scheduled_at, p.published_at) >= ?', new Date(req.query.from));
  if (req.query.to) add('COALESCE(p.scheduled_at, p.published_at) < ?', new Date(req.query.to));
  const rows = await many(`
    SELECT ${POST_COLUMNS} FROM posts p ${POST_JOINS}
    WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(p.scheduled_at, p.published_at, p.updated_at) DESC
    LIMIT 500`, params);
  res.json(rows.map(shapePost));
}));

api.get('/posts/:id', ah(async (req, res) => {
  res.json(await reload(req, intId(req.params.id)));
}));

async function validChannels(brandId, ids) {
  if (!Array.isArray(ids)) return [];
  const wanted = ids.map(Number).filter(Number.isInteger);
  const rows = await many('SELECT id FROM channels WHERE brand_id = $1 AND id = ANY($2::int[])', [brandId, wanted]);
  return rows.map((r) => r.id);
}

api.post('/posts', requireRole('editor'), ah(async (req, res) => {
  const b = await brandFor(req, intId(req.body.brand_id));
  const channelIds = await validChannels(b.id, req.body.channel_ids);
  const mediaIds = req.body.media_ids === undefined ? [] : await validMediaIds(req.user.workspace_id, req.body.media_ids);
  const { id } = await one(`
    INSERT INTO posts (brand_id, author_id, content, channel_ids)
    VALUES ($1, $2, $3, $4) RETURNING id`,
    [b.id, req.user.id, str(req.body.content, 10_000), channelIds]);
  await setPostMedia(id, mediaIds);
  await logActivity(req.user.workspace_id, req.user.id, 'post.created', `Post #${id}`);
  res.status(201).json(await reload(req, id));
}));

api.patch('/posts/:id', requireRole('editor'), ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  if (p.status === 'published') fail(400, 'Published posts cannot be edited');
  const ws = await one('SELECT require_approval FROM workspaces WHERE id = $1', [req.user.workspace_id]);
  const channelIds = req.body.channel_ids === undefined ? null : await validChannels(p.brand_id, req.body.channel_ids);
  const mediaIds = req.body.media_ids === undefined ? null : await validMediaIds(req.user.workspace_id, req.body.media_ids);
  // Changes by someone who can't approve send an approved post back for review.
  const needsReview = ws.require_approval && !req.user.can_approve && ['scheduled', 'pending'].includes(p.status);
  await pool.query(`
    UPDATE posts SET
      content = COALESCE($2, content),
      channel_ids = COALESCE($3, channel_ids),
      status = CASE WHEN $4 THEN 'pending' WHEN status = 'failed' THEN 'draft' ELSE status END,
      approved_by = CASE WHEN $4 THEN NULL ELSE approved_by END,
      updated_at = now()
    WHERE id = $1`,
    [p.id, typeof req.body.content === 'string' ? str(req.body.content, 10_000) : null, channelIds, needsReview]);
  if (mediaIds) await setPostMedia(p.id, mediaIds);
  res.json(await reload(req, p.id));
}));

api.delete('/posts/:id', requireRole('editor'), ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  await pool.query('DELETE FROM posts WHERE id = $1', [p.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'post.deleted', `Post #${p.id}`);
  res.json({ ok: true });
}));

/** Move a post to scheduled (or pending, when approval is required) at `when`. */
async function schedulePost(req, p, when) {
  if (p.status === 'published') fail(400, 'This post is already published');
  if (!p.content.trim()) fail(400, 'Write something before scheduling');
  if (!p.channel_ids.length) fail(400, 'Pick at least one channel');
  if (!p.media.length) {
    const needMedia = await many('SELECT DISTINCT platform FROM channels WHERE id = ANY($1::int[])', [p.channel_ids]);
    const blocked = needMedia.find((c) => PLATFORMS[c.platform]?.needsMedia);
    if (blocked) fail(400, `${PLATFORMS[blocked.platform].label} posts need an image or video`);
  }
  if (!(when instanceof Date) || isNaN(when)) fail(400, 'Pick a valid date and time');
  if (when < new Date(Date.now() - 60_000)) fail(400, 'That time is in the past');
  const ws = await one('SELECT require_approval FROM workspaces WHERE id = $1', [req.user.workspace_id]);
  const autoApprove = !ws.require_approval || req.user.can_approve;
  await pool.query(`
    UPDATE posts SET status = $2, scheduled_at = $3, approved_by = $4, review_note = '', updated_at = now()
    WHERE id = $1`,
    [p.id, autoApprove ? 'scheduled' : 'pending', when, autoApprove && ws.require_approval ? req.user.id : null]);
  await logActivity(req.user.workspace_id, req.user.id,
    autoApprove ? 'post.scheduled' : 'post.submitted', `Post #${p.id} for ${when.toISOString()}`);
}

api.post('/posts/:id/schedule', requireRole('editor'), ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  await schedulePost(req, p, new Date(req.body.scheduled_at));
  res.json(await reload(req, p.id));
}));

api.post('/posts/:id/queue', requireRole('editor'), ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  const ws = await one('SELECT timezone FROM workspaces WHERE id = $1', [req.user.workspace_id]);
  const slots = await many('SELECT weekday, time FROM queue_slots WHERE brand_id = $1', [p.brand_id]);
  if (!slots.length) fail(400, 'This brand has no queue slots. Add some on the Queue page.');
  const taken = new Set((await many(`
    SELECT scheduled_at FROM posts
    WHERE brand_id = $1 AND id <> $2 AND status IN ('scheduled','pending') AND scheduled_at > now()`,
    [p.brand_id, p.id])).map((r) => r.scheduled_at.getTime()));
  const next = upcomingSlots(slots, ws.timezone).find((t) => !taken.has(t.getTime()));
  if (!next) fail(400, 'The queue is full for the next four weeks. Add more slots.');
  await schedulePost(req, p, next);
  res.json(await reload(req, p.id));
}));

api.post('/posts/:id/unschedule', requireRole('editor'), ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  if (!['scheduled', 'pending', 'failed'].includes(p.status)) fail(400, 'This post is not scheduled');
  await pool.query(`UPDATE posts SET status = 'draft', scheduled_at = NULL, approved_by = NULL, updated_at = now() WHERE id = $1`, [p.id]);
  res.json(await reload(req, p.id));
}));

const requireApprover = (req, res, next) =>
  req.user.can_approve ? next() : res.status(403).json({ error: 'You cannot approve posts' });

api.post('/posts/:id/approve', requireApprover, ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  if (p.status !== 'pending') fail(400, 'Only posts awaiting approval can be approved');
  if (p.scheduled_at < new Date()) fail(400, 'The scheduled time has passed — reschedule it first');
  await pool.query(`UPDATE posts SET status = 'scheduled', approved_by = $2, review_note = '', updated_at = now() WHERE id = $1`,
    [p.id, req.user.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'post.approved', `Post #${p.id}`);
  res.json(await reload(req, p.id));
}));

api.post('/posts/:id/reject', requireApprover, ah(async (req, res) => {
  const p = await postFor(req, intId(req.params.id));
  if (p.status !== 'pending') fail(400, 'Only posts awaiting approval can be sent back');
  await pool.query(`UPDATE posts SET status = 'draft', review_note = $2, updated_at = now() WHERE id = $1`,
    [p.id, str(req.body.note, 1000)]);
  await logActivity(req.user.workspace_id, req.user.id, 'post.rejected', `Post #${p.id}`);
  res.json(await reload(req, p.id));
}));

// ---------- media ----------

api.get('/media', ah(async (req, res) => {
  res.json(await listMedia(req.user.workspace_id));
}));

api.post('/media', requireRole('editor'), ah(async (req, res) => {
  const out = await createUpload(req.user, {
    filename: str(req.body.filename, 200), mime: String(req.body.mime || ''), bytes: req.body.bytes,
  });
  res.status(201).json(out);
}));

api.post('/media/:id/complete', requireRole('editor'), ah(async (req, res) => {
  const m = await completeUpload(req.user, intId(req.params.id));
  await logActivity(req.user.workspace_id, req.user.id, 'media.uploaded', m.filename || `Media #${m.id}`);
  res.json(m);
}));

api.delete('/media/:id', requireRole('editor'), ah(async (req, res) => {
  const result = await deleteMedia(req.user, intId(req.params.id));
  await logActivity(req.user.workspace_id, req.user.id, `media.${result}`, `Media #${req.params.id}`);
  res.json({ ok: true, result });
}));

// ---------- AI ----------

api.post('/ai/drafts', requireRole('editor'), aiLimit, ah(async (req, res) => {
  const b = await brandFor(req, intId(req.body.brand_id));
  const brief = str(req.body.brief, 2000) || fail(400, 'Describe what the post should be about');
  const platform = PLATFORMS[req.body.platform] ? req.body.platform : 'linkedin';
  const count = Math.min(Math.max(parseInt(req.body.count, 10) || 3, 1), 5);
  const length = ['short', 'medium', 'long'].includes(req.body.length) ? req.body.length : 'medium';
  const drafts = await generateDrafts({
    brand: b, platform, brief, tone: str(req.body.tone, 100), count, length,
    emoji: req.body.emoji !== false, hashtags: req.body.hashtags === true,
  });
  await logActivity(req.user.workspace_id, req.user.id, 'ai.drafts', `${drafts.length} for ${PLATFORMS[platform].label}`);
  res.json({ drafts });
}));

// ---------- loan reminders (Feature 12) ----------

api.use('/loans', loans);

// ---------- AI provider settings (Setup) ----------

api.use('/ai', aiSettings);

// ---------- link in bio and tracked links (D15) ----------

api.use(linksApi);

// ---------- content library and monthly reports (D16) ----------

api.use('/library', library);
api.use('/reports', reports);

// ---------- setup: integration credentials ----------

api.use('/integrations', integrations);

// ---------- analytics ----------

api.get('/analytics', ah(async (req, res) => {
  const params = [req.user.workspace_id];
  let brandFilter = '';
  if (req.query.brand_id) {
    params.push(intId(req.query.brand_id));
    brandFilter = 'AND p.brand_id = $2';
  }
  const base = `FROM posts p JOIN brands b ON b.id = p.brand_id WHERE b.workspace_id = $1 ${brandFilter}`;
  const [byStatus, byPlatform, weekly, authors] = await Promise.all([
    many(`SELECT p.status, count(*) ${base} GROUP BY p.status`, params),
    many(`SELECT c.platform, count(*) ${base.replace('WHERE', 'JOIN channels c ON c.id = ANY(p.channel_ids) WHERE')}
          AND p.status = 'published' GROUP BY c.platform ORDER BY count DESC`, params),
    many(`SELECT to_char(date_trunc('week', p.published_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS week, count(*) ${base}
          AND p.status = 'published' AND p.published_at > now() - interval '12 weeks'
          GROUP BY week ORDER BY week`, params),
    many(`SELECT u.display_name AS name, count(*) ${base.replace('WHERE', 'JOIN users u ON u.id = p.author_id WHERE')}
          GROUP BY u.display_name ORDER BY count DESC LIMIT 5`, params),
  ]);
  res.json({
    by_status: Object.fromEntries(byStatus.map((r) => [r.status, r.count])),
    by_platform: byPlatform,
    weekly,
    authors,
  });
}));

// ---------- errors ----------

api.use((req, res) => res.status(404).json({ error: 'Not found' }));

api.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500 && !err.expose) console.error(err);
  const safe = err instanceof HttpError || err.expose || status < 500;
  res.status(status).json({ error: safe ? err.message : 'Something went wrong' });
});
