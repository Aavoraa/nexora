// Content library (D16): reusable post templates the team can start a post from.
// Items are workspace-wide or tied to one brand, may carry one library media file,
// and can be marked "pre-approved" by a user who can approve posts.
import express from 'express';
import { many, one, pool, logActivity } from './db.js';
import { requireRole } from './auth.js';
import { publicMedia } from './media.js';

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fail(400, 'Invalid id'));

export const CATEGORIES = ['Educational', 'Promotional', 'Seasonal', 'Testimonial', 'Market update', 'Event', 'Other'];

const ITEM_SQL = `
  SELECT l.*, b.name AS brand_name, cu.display_name AS created_by_name, au.display_name AS approved_by_name,
    (SELECT row_to_json(m) FROM media m WHERE m.id = l.media_id AND m.status = 'ready') AS media
  FROM library_items l
  LEFT JOIN brands b ON b.id = l.brand_id
  LEFT JOIN users cu ON cu.id = l.created_by
  LEFT JOIN users au ON au.id = l.approved_by`;

const out = (r) => ({ ...r, media: r.media ? publicMedia(r.media) : null });

async function itemFor(req, id) {
  return (await one(`${ITEM_SQL} WHERE l.id = $1 AND l.workspace_id = $2`, [intId(id), req.user.workspace_id])) || fail(404, 'Library item not found');
}

/** Validate the editable fields; brand and media must belong to the caller's workspace. */
async function fields(req) {
  const ws = req.user.workspace_id;
  const title = str(req.body.title, 120) || fail(400, 'Give the item a title');
  const body = str(req.body.body, 10_000) || fail(400, 'The post text is empty');
  const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'Other';
  const tags = [...new Set((Array.isArray(req.body.tags) ? req.body.tags : [])
    .map((t) => str(t, 30).toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 10);
  let brandId = null;
  if (req.body.brand_id) {
    brandId = intId(req.body.brand_id);
    if (!await one('SELECT 1 FROM brands WHERE id = $1 AND workspace_id = $2', [brandId, ws])) fail(404, 'Brand not found');
  }
  let mediaId = null;
  if (req.body.media_id) {
    mediaId = intId(req.body.media_id);
    if (!await one("SELECT 1 FROM media WHERE id = $1 AND workspace_id = $2 AND status = 'ready'", [mediaId, ws])) fail(400, 'That media file could not be found');
  }
  return { title, body, category, tags, brandId, mediaId };
}

export const library = express.Router();

library.get('/', ah(async (req, res) => {
  const params = [req.user.workspace_id];
  const where = ['l.workspace_id = $1'];
  if (req.query.brand_id) {
    params.push(intId(req.query.brand_id));
    where.push(`(l.brand_id IS NULL OR l.brand_id = $${params.length})`);
  }
  const rows = await many(`${ITEM_SQL} WHERE ${where.join(' AND ')} ORDER BY l.approved DESC, l.use_count DESC, l.updated_at DESC LIMIT 500`, params);
  res.json({ categories: CATEGORIES, items: rows.map(out) });
}));

library.post('/', requireRole('editor'), ah(async (req, res) => {
  const f = await fields(req);
  const { id } = await one(`
    INSERT INTO library_items (workspace_id, brand_id, title, body, category, tags, media_id, created_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
  [req.user.workspace_id, f.brandId, f.title, f.body, f.category, f.tags, f.mediaId, req.user.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'library.created', f.title);
  res.status(201).json(out(await itemFor(req, id)));
}));

library.put('/:id', requireRole('editor'), ah(async (req, res) => {
  const item = await itemFor(req, req.params.id);
  const f = await fields(req);
  // Changing the text or media of a pre-approved item needs a fresh approval,
  // unless the editor can approve themselves.
  const changed = f.body !== item.body || f.mediaId !== item.media_id;
  const keep = item.approved && (!changed || req.user.can_approve);
  await pool.query(`
    UPDATE library_items SET brand_id = $2, title = $3, body = $4, category = $5, tags = $6, media_id = $7,
      approved = $8, approved_by = CASE WHEN $8 THEN approved_by END, updated_at = now()
    WHERE id = $1`,
  [item.id, f.brandId, f.title, f.body, f.category, f.tags, f.mediaId, keep]);
  res.json(out(await itemFor(req, item.id)));
}));

library.delete('/:id', requireRole('editor'), ah(async (req, res) => {
  const item = await itemFor(req, req.params.id);
  await pool.query('DELETE FROM library_items WHERE id = $1', [item.id]);
  await logActivity(req.user.workspace_id, req.user.id, 'library.deleted', item.title);
  res.json({ ok: true });
}));

library.post('/:id/approve', ah(async (req, res) => {
  if (!req.user.can_approve) fail(403, 'You cannot approve content');
  const item = await itemFor(req, req.params.id);
  const approved = req.body.approved !== false;
  await pool.query('UPDATE library_items SET approved = $2, approved_by = $3 WHERE id = $1',
    [item.id, approved, approved ? req.user.id : null]);
  await logActivity(req.user.workspace_id, req.user.id, approved ? 'library.approved' : 'library.unapproved', item.title);
  res.json(out(await itemFor(req, item.id)));
}));

/** Count a use and hand back what the new post should start with. */
library.post('/:id/use', requireRole('editor'), ah(async (req, res) => {
  const item = await itemFor(req, req.params.id);
  await pool.query('UPDATE library_items SET use_count = use_count + 1, last_used_at = now() WHERE id = $1', [item.id]);
  res.json({ body: item.body, media_ids: item.media ? [item.media.id] : [] });
}));
