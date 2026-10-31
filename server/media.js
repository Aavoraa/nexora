// Media library (PRD Feature 11). The only module that talks to storage.
import { many, one, pool } from './db.js';
import * as storage from './storage.js';
import { inspect } from './mediainfo.js';
import { MEDIA_LIMITS, readiness, aspectLabel } from './platforms.js';

const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

const kindForMime = (mime) =>
  Object.keys(MEDIA_LIMITS).find((k) => MEDIA_LIMITS[k].mimes.includes(mime)) || null;

const MB = 1024 * 1024;

/** The shape the API returns: signed view URL and per-network readiness, no storage key. */
export function publicMedia(m) {
  const out = {
    id: m.id,
    kind: m.kind,
    filename: m.filename,
    mime: m.mime,
    bytes: m.bytes,
    width: m.width,
    height: m.height,
    duration_ms: m.duration_ms,
    codec: m.codec,
    status: m.status,
    created_at: m.created_at,
  };
  if (m.status === 'uploading') return out;
  return {
    ...out,
    url: storage.viewUrl(m.storage_key),
    aspect: aspectLabel(m.width, m.height),
    readiness: readiness(m),
  };
}

export async function listMedia(workspaceId) {
  const rows = await many(`
    SELECT * FROM media WHERE workspace_id = $1 AND status = 'ready'
    ORDER BY created_at DESC LIMIT 500`, [workspaceId]);
  return rows.map(publicMedia);
}

/** Register an upload and hand back the signed URL the browser PUTs the file to. */
export async function createUpload(user, { filename, mime, bytes }) {
  const kind = kindForMime(mime);
  if (!kind) throw httpError(400, 'Only MP4 or MOV videos, or JPG, PNG or WebP images');
  const limit = MEDIA_LIMITS[kind].maxBytes;
  if (!Number.isInteger(bytes) || bytes <= 0) throw httpError(400, 'File is empty');
  if (bytes > limit) throw httpError(400, `${kind === 'video' ? 'Videos' : 'Images'} can be up to ${limit / MB} MB`);
  const key = storage.newKey(user.workspace_id);
  const m = await one(`
    INSERT INTO media (workspace_id, uploaded_by, kind, storage_key, filename, mime, bytes)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
  [user.workspace_id, user.id, kind, key, String(filename || '').slice(0, 200), mime, bytes]);
  return { media: publicMedia(m), upload: { method: 'PUT', url: storage.uploadUrl(key, bytes) } };
}

async function reject(m, message) {
  await storage.remove(m.storage_key);
  await pool.query('DELETE FROM media WHERE id = $1', [m.id]);
  throw httpError(422, message);
}

/** Check an uploaded file from its own bytes, then mark it ready (or reject and delete it). */
export async function completeUpload(user, id) {
  const m = await one(`SELECT * FROM media WHERE id = $1 AND workspace_id = $2`, [id, user.workspace_id]);
  if (!m) throw httpError(404, 'Media not found');
  if (m.status !== 'uploading') return publicMedia(m);

  const size = await storage.stat(m.storage_key);
  if (size === null) throw httpError(400, 'The upload did not finish. Try again.');
  const info = await inspect((start, len) => storage.read(m.storage_key, start, len), size);
  if (!info) return reject(m, 'Only MP4 or MOV videos, or JPG, PNG or WebP images');
  const limits = MEDIA_LIMITS[info.kind];
  if (size > limits.maxBytes) return reject(m, `${info.kind === 'video' ? 'Videos' : 'Images'} can be up to ${limits.maxBytes / MB} MB`);
  if (info.kind === 'video' && info.duration_ms > limits.maxSeconds * 1000) {
    return reject(m, `Videos can be up to ${limits.maxSeconds / 60} minutes long`);
  }
  if (!info.width || !info.height) return reject(m, 'Could not read this file\'s dimensions');

  const ready = await one(`
    UPDATE media SET status = 'ready', kind = $2, mime = $3, bytes = $4, width = $5, height = $6,
      duration_ms = $7, codec = $8
    WHERE id = $1 RETURNING *`,
  [m.id, info.kind, info.mime, size, info.width, info.height, info.duration_ms ?? null, info.codec ?? '']);
  return publicMedia(ready);
}

/**
 * Delete a media item. It is refused while a scheduled or pending post uses it. If a
 * published post used it, the item is archived (kept for the record) instead of deleted.
 * @returns {'deleted' | 'archived'}
 */
export async function deleteMedia(user, id) {
  const m = await one(`SELECT * FROM media WHERE id = $1 AND workspace_id = $2 AND status <> 'archived'`,
    [id, user.workspace_id]);
  if (!m) throw httpError(404, 'Media not found');
  const uses = await many(`
    SELECT DISTINCT p.status FROM post_media pm JOIN posts p ON p.id = pm.post_id WHERE pm.media_id = $1`, [m.id]);
  const statuses = new Set(uses.map((u) => u.status));
  if (statuses.has('scheduled') || statuses.has('pending')) {
    throw httpError(409, 'A scheduled or pending post uses this. Remove it from that post first.');
  }
  if (statuses.has('published')) {
    await pool.query(`UPDATE media SET status = 'archived' WHERE id = $1`, [m.id]);
    // Drafts and failed posts lose the attachment; published posts keep it.
    await pool.query(`
      DELETE FROM post_media pm USING posts p
      WHERE pm.post_id = p.id AND pm.media_id = $1 AND p.status <> 'published'`, [m.id]);
    return 'archived';
  }
  await pool.query('DELETE FROM media WHERE id = $1', [m.id]);
  await storage.remove(m.storage_key);
  return 'deleted';
}

/**
 * Validate a list of media ids for a post: same workspace, ready, and either one video
 * or up to 10 images. Returns the ids in order.
 */
export async function validMediaIds(workspaceId, ids) {
  if (!Array.isArray(ids)) throw httpError(400, 'media_ids must be a list');
  const wanted = [...new Set(ids.map(Number))];
  if (wanted.some((n) => !Number.isInteger(n) || n <= 0)) throw httpError(400, 'Invalid media id');
  if (!wanted.length) return [];
  const rows = await many(`SELECT id, kind FROM media WHERE workspace_id = $1 AND status = 'ready' AND id = ANY($2::int[])`,
    [workspaceId, wanted]);
  if (rows.length !== wanted.length) throw httpError(400, 'Some media could not be found');
  const videos = rows.filter((r) => r.kind === 'video').length;
  if (videos > 1 || (videos === 1 && rows.length > 1)) throw httpError(400, 'A post can have one video, or up to 10 images');
  if (rows.length > 10) throw httpError(400, 'A post can have up to 10 images');
  return wanted;
}

export async function setPostMedia(postId, ids) {
  await pool.query('DELETE FROM post_media WHERE post_id = $1', [postId]);
  for (const [i, mediaId] of ids.entries()) {
    await pool.query('INSERT INTO post_media (post_id, media_id, position) VALUES ($1, $2, $3)', [postId, mediaId, i]);
  }
}

/** SQL fragment: a post's media as a JSON array, in order. Needs alias `p` for posts. */
export const POST_MEDIA_SQL = `
  (SELECT COALESCE(json_agg(json_build_object(
      'id', m.id, 'kind', m.kind, 'storage_key', m.storage_key, 'filename', m.filename, 'mime', m.mime,
      'bytes', m.bytes, 'width', m.width, 'height', m.height, 'duration_ms', m.duration_ms,
      'codec', m.codec, 'status', m.status, 'created_at', m.created_at) ORDER BY pm.position), '[]'::json)
   FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = p.id) AS media`;

/** Remove uploads that were started but never completed (PRD F11 edge case). */
export async function cleanupStaleUploads(maxAgeHours = 24) {
  const stale = await many(`
    DELETE FROM media WHERE status = 'uploading' AND created_at < now() - make_interval(hours => $1)
    RETURNING storage_key`, [maxAgeHours]);
  for (const s of stale) await storage.remove(s.storage_key);
  return stale.length;
}
