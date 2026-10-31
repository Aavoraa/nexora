/**
 * Object storage behind signed, expiring URLs (ARCHITECTURE §3, SECURITY §8).
 *
 * This is the local-disk driver: files live under MEDIA_DIR and are read and written
 * through /media-store URLs carrying an HMAC signature, so it behaves like presigned
 * S3/R2 URLs. A cloud driver must implement the same exports.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import express from 'express';

// On Vercel only /tmp is writable, and it is per instance and temporary: real media needs object storage there.
const ROOT = path.resolve(process.env.MEDIA_DIR || (process.env.VERCEL ? '/tmp/nexora-media' : path.join('data', 'media')));
const SECRET = process.env.MEDIA_SIGNING_SECRET
  ? Buffer.from(process.env.MEDIA_SIGNING_SECRET)
  : crypto.randomBytes(32); // Fine for one process: URLs expire within the hour anyway.
const KEY_RE = /^ws\/\d+\/[0-9a-f]{32}$/;

export const PUT_TTL = 15 * 60;
export const GET_TTL = 60 * 60;

export function newKey(workspaceId) {
  return `ws/${workspaceId}/${crypto.randomBytes(16).toString('hex')}`;
}

const sign = (...parts) => crypto.createHmac('sha256', SECRET).update(parts.join('\n')).digest('hex');
const now = () => Math.floor(Date.now() / 1000);
const fileFor = (key) => {
  if (!KEY_RE.test(key)) throw new Error('Invalid storage key');
  return path.join(ROOT, ...key.split('/'));
};

/** URL the browser PUTs the file body to; rejects bodies over `maxBytes`. */
export function uploadUrl(key, maxBytes, ttl = PUT_TTL) {
  const exp = now() + ttl;
  return `/media-store/${key}?exp=${exp}&max=${maxBytes}&sig=${sign('PUT', key, exp, maxBytes)}`;
}

/** Time-limited URL for viewing the file. */
export function viewUrl(key, ttl = GET_TTL) {
  // Round expiry to the TTL so repeated list calls return the same URL (browser caching).
  const exp = Math.ceil((now() + ttl) / ttl) * ttl;
  return `/media-store/${key}?exp=${exp}&sig=${sign('GET', key, exp)}`;
}

/** Size in bytes, or null if the object doesn't exist. */
export async function stat(key) {
  try {
    return (await fsp.stat(fileFor(key))).size;
  } catch {
    return null;
  }
}

/** Read `length` bytes from `start` (fewer at end of file). */
export async function read(key, start, length) {
  const fh = await fsp.open(fileFor(key), 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

export async function remove(key) {
  await fsp.rm(fileFor(key), { force: true });
}

function verified(req, method) {
  const key = req.params[0];
  const exp = Number(req.query.exp);
  if (!KEY_RE.test(key) || !Number.isInteger(exp) || exp < now()) return null;
  const expected = method === 'PUT' ? sign('PUT', key, exp, req.query.max) : sign('GET', key, exp);
  const given = String(req.query.sig || '');
  if (given.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
  return key;
}

/** Express router serving the signed URLs. Mounted at /media-store. */
export function storageRouter() {
  const r = express.Router();

  r.put(/^\/(.+)$/, async (req, res) => {
    const key = verified(req, 'PUT');
    if (!key) return res.status(403).json({ error: 'Upload link is invalid or has expired' });
    const max = Number(req.query.max);
    const declared = Number(req.headers['content-length']);
    if (declared > max) return res.status(413).json({ error: 'File is larger than allowed' });

    const file = fileFor(key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.part`;
    const out = fs.createWriteStream(tmp);
    let bytes = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > max && !tooBig) {
        tooBig = true;
        req.unpipe(out);
        out.destroy();
        fsp.rm(tmp, { force: true });
        res.status(413).json({ error: 'File is larger than allowed' });
        req.resume();
      }
    });
    req.pipe(out);
    out.on('finish', async () => {
      if (tooBig) return;
      await fsp.rename(tmp, file);
      res.status(200).json({ ok: true, bytes });
    });
    out.on('error', () => { if (!res.headersSent) res.status(500).json({ error: 'Upload failed' }); });
    req.on('aborted', () => { out.destroy(); fsp.rm(tmp, { force: true }); });
  });

  r.get(/^\/(.+)$/, (req, res) => {
    const key = verified(req, 'GET');
    if (!key) return res.status(403).end();
    // sendFile handles Range requests, which video seeking needs.
    res.sendFile(fileFor(key), { headers: { 'Cache-Control': 'private, max-age=3600' } }, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });

  return r;
}
