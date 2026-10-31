// Link in bio and tracked short links (D15).
// - linksApi (mounted at /api): manage a brand's bio page and its UTM short links, read click stats.
// - publicLinks (mounted at /): the public bio page (/b/:slug) and click-tracking redirects
//   (/r/:id for bio buttons, /l/:code for short links).
import crypto from 'node:crypto';
import express from 'express';
import { many, one, pool, tx, logActivity } from './db.js';
import { requireRole } from './auth.js';
import { viewUrl } from './storage.js';

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intId = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : fail(400, 'Invalid id'));

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const RESERVED = new Set(['admin', 'api', 'app', 'login', 'logout', 'settings', 'setup', 'help', 'support', 'cadence', 'nexora', 'static', 'media', 'www']);
const HEX = /^#[0-9a-f]{6}$/i;
const UTM_RE = /^[\w.+-]{0,60}$/;
const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|curl|wget|python-requests|headless/i;

/** Accept only absolute http(s) URLs, so redirects can never point at javascript: or data: targets. */
export function cleanUrl(v) {
  const s = str(v, 2000);
  let u;
  try { u = new URL(s); } catch { fail(400, `“${s.slice(0, 60) || 'that'}” isn't a full web address (start with https://)`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') fail(400, 'Links must start with https:// or http://');
  return u.toString();
}

/** Add UTM parameters to a destination, keeping its existing query string. */
export function withUtm(url, { utm_source, utm_medium, utm_campaign }) {
  const u = new URL(url);
  for (const [k, v] of Object.entries({ utm_source, utm_medium, utm_campaign })) if (v) u.searchParams.set(k, v);
  return u.toString();
}

const newCode = () => crypto.randomBytes(6).toString('base64url').replace(/[-_]/g, '').slice(0, 7).padEnd(7, 'x');

async function brandFor(req, id) {
  return (await one('SELECT * FROM brands WHERE id = $1 AND workspace_id = $2', [intId(id), req.user.workspace_id])) || fail(404, 'Brand not found');
}

// ---------- in-app API ----------

export const linksApi = express.Router();

linksApi.get('/bio', ah(async (req, res) => {
  const b = await brandFor(req, req.query.brand_id);
  const page = await one('SELECT * FROM bio_pages WHERE brand_id = $1', [b.id]);
  const links = page ? await many('SELECT id, label, url FROM bio_links WHERE page_id = $1 ORDER BY position, id', [page.id]) : [];
  const daily = await many(`
    SELECT to_char(date_trunc('day', clicked_at AT TIME ZONE w.timezone), 'YYYY-MM-DD') AS day, count(*) AS clicks
    FROM link_clicks c JOIN workspaces w ON w.id = c.workspace_id
    WHERE c.brand_id = $1 AND c.clicked_at > now() - interval '30 days' GROUP BY 1 ORDER BY 1`, [b.id]);
  const perLink = page ? await many(`
    SELECT l.id, count(c.id) AS clicks FROM bio_links l LEFT JOIN link_clicks c ON c.bio_link_id = l.id
      AND c.clicked_at > now() - interval '30 days'
    WHERE l.page_id = $1 GROUP BY l.id`, [page.id]) : [];
  res.json({
    page: page && { ...page, links: links.map((l) => ({ ...l, clicks: perLink.find((p) => p.id === l.id)?.clicks || 0 })) },
    brand: { id: b.id, name: b.name, color: b.color },
    suggested_slug: b.name.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 40),
    daily,
  });
}));

linksApi.put('/bio', requireRole('editor'), ah(async (req, res) => {
  const b = await brandFor(req, req.body.brand_id);
  const slug = str(req.body.slug, 40).toLowerCase();
  if (!SLUG_RE.test(slug)) fail(400, 'Page address: 3–40 lowercase letters, numbers or dashes (not starting or ending with a dash)');
  if (RESERVED.has(slug)) fail(400, 'That page address is reserved. Choose another.');
  const accent = HEX.test(req.body.accent) ? req.body.accent : '#6d28d9';
  const links = Array.isArray(req.body.links) ? req.body.links : [];
  if (links.length > 20) fail(400, 'A page can have up to 20 links');
  const clean = links.filter((l) => str(l?.label, 80) || str(l?.url, 2000)).map((l, i) => {
    const label = str(l.label, 80) || fail(400, `Link ${i + 1} needs button text`);
    return { label, url: cleanUrl(l.url) };
  });
  const taken = await one('SELECT brand_id FROM bio_pages WHERE lower(slug) = $1', [slug]);
  if (taken && taken.brand_id !== b.id) fail(409, 'That page address is already taken');
  const page = await tx(async (c) => {
    const p = (await c.query(`
      INSERT INTO bio_pages (workspace_id, brand_id, slug, title, bio, accent, show_posts, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, now())
      ON CONFLICT (brand_id) DO UPDATE SET slug = EXCLUDED.slug, title = EXCLUDED.title, bio = EXCLUDED.bio,
        accent = EXCLUDED.accent, show_posts = EXCLUDED.show_posts, updated_at = now()
      RETURNING *`,
    [req.user.workspace_id, b.id, slug, str(req.body.title, 80), str(req.body.bio, 300), accent, req.body.show_posts !== false])).rows[0];
    // Keep existing link rows (and their click history) when label/url are unchanged; replace the rest.
    const existing = (await c.query('SELECT id, label, url FROM bio_links WHERE page_id = $1', [p.id])).rows;
    const keep = new Set();
    for (const [i, l] of clean.entries()) {
      const match = existing.find((e) => !keep.has(e.id) && e.label === l.label && e.url === l.url);
      if (match) {
        keep.add(match.id);
        await c.query('UPDATE bio_links SET position = $2 WHERE id = $1', [match.id, i]);
      } else {
        keep.add((await c.query('INSERT INTO bio_links (page_id, position, label, url) VALUES ($1,$2,$3,$4) RETURNING id', [p.id, i, l.label, l.url])).rows[0].id);
      }
    }
    await c.query('DELETE FROM bio_links WHERE page_id = $1 AND NOT (id = ANY($2::int[]))', [p.id, [...keep]]);
    return p;
  });
  await logActivity(req.user.workspace_id, req.user.id, 'links.bio_saved', `/b/${page.slug}`);
  res.json({ ok: true, slug: page.slug });
}));

linksApi.get('/links', ah(async (req, res) => {
  const params = [req.user.workspace_id];
  let where = 's.workspace_id = $1';
  if (req.query.brand_id) { params.push(intId(req.query.brand_id)); where += ` AND s.brand_id = $${params.length}`; }
  res.json(await many(`
    SELECT s.*, u.display_name AS created_by_name,
      (SELECT count(*) FROM link_clicks c WHERE c.short_link_id = s.id) AS clicks,
      (SELECT count(*) FROM link_clicks c WHERE c.short_link_id = s.id AND c.clicked_at > now() - interval '7 days') AS clicks_7d
    FROM short_links s LEFT JOIN users u ON u.id = s.created_by
    WHERE ${where} ORDER BY s.created_at DESC LIMIT 200`, params));
}));

linksApi.post('/links', requireRole('editor'), ah(async (req, res) => {
  const b = req.body.brand_id ? await brandFor(req, req.body.brand_id) : null;
  const url = cleanUrl(req.body.url);
  const utm = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    utm[k] = str(req.body[k], 60);
    if (!UTM_RE.test(utm[k])) fail(400, `${k.replace('utm_', 'UTM ')}: letters, numbers, dots, dashes, underscores or plus only`);
  }
  let row;
  for (let i = 0; i < 5 && !row; i++) {
    try {
      row = await one(`
        INSERT INTO short_links (workspace_id, brand_id, code, label, url, utm_source, utm_medium, utm_campaign, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.workspace_id, b?.id ?? null, newCode(), str(req.body.label, 80), url, utm.utm_source, utm.utm_medium, utm.utm_campaign, req.user.id]);
    } catch (err) {
      if (err.code !== '23505') throw err; // code collision: try another
    }
  }
  await logActivity(req.user.workspace_id, req.user.id, 'links.created', `/l/${row.code}`);
  res.status(201).json({ ...row, clicks: 0, clicks_7d: 0, destination: withUtm(row.url, row) });
}));

linksApi.delete('/links/:id', requireRole('editor'), ah(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM short_links WHERE id = $1 AND workspace_id = $2', [intId(req.params.id), req.user.workspace_id]);
  if (!rowCount) fail(404, 'Link not found');
  res.json({ ok: true });
}));

// ---------- public pages and redirects ----------

export const publicLinks = express.Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function countable(req) {
  return req.method === 'GET' && !BOT_UA.test(req.headers['user-agent'] || '');
}
function referrerHost(req) {
  try { return new URL(req.headers.referer).hostname.slice(0, 120); } catch { return ''; }
}

publicLinks.get('/r/:id', ah(async (req, res) => {
  const link = await one(`SELECT l.url, p.workspace_id, p.brand_id, l.id FROM bio_links l JOIN bio_pages p ON p.id = l.page_id WHERE l.id = $1`,
    [Number(req.params.id) || 0]);
  if (!link) return res.status(404).type('text').send('Link not found');
  if (countable(req)) {
    await pool.query('INSERT INTO link_clicks (workspace_id, brand_id, bio_link_id, referrer_host) VALUES ($1,$2,$3,$4)',
      [link.workspace_id, link.brand_id, link.id, referrerHost(req)]);
  }
  res.set('Cache-Control', 'no-store').redirect(302, link.url);
}));

publicLinks.get('/l/:code', ah(async (req, res) => {
  const s = await one('SELECT * FROM short_links WHERE code = $1', [String(req.params.code).slice(0, 20)]);
  if (!s) return res.status(404).type('text').send('Link not found');
  if (countable(req)) {
    await pool.query('INSERT INTO link_clicks (workspace_id, brand_id, short_link_id, referrer_host) VALUES ($1,$2,$3,$4)',
      [s.workspace_id, s.brand_id, s.id, referrerHost(req)]);
  }
  res.set('Cache-Control', 'no-store').redirect(302, withUtm(s.url, s));
}));

publicLinks.get('/b/:slug', ah(async (req, res) => {
  const page = await one(`SELECT p.*, b.name AS brand_name FROM bio_pages p JOIN brands b ON b.id = p.brand_id WHERE lower(p.slug) = lower($1)`,
    [String(req.params.slug).slice(0, 40)]);
  if (!page) return res.status(404).type('html').send(renderBio(null));
  const links = await many('SELECT id, label FROM bio_links WHERE page_id = $1 ORDER BY position, id', [page.id]);
  const posts = page.show_posts ? await many(`
    SELECT p.id, p.content, p.published_at,
      (SELECT json_build_object('kind', m.kind, 'key', m.storage_key) FROM post_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.post_id = p.id ORDER BY pm.position LIMIT 1) AS media
    FROM posts p WHERE p.brand_id = $1 AND p.status = 'published' ORDER BY p.published_at DESC LIMIT 6`, [page.brand_id]) : [];
  res.set({ 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  res.type('html').send(renderBio({ ...page, links, posts }));
}));

/** Public bio page: self-contained HTML (no scripts), every value escaped. */
export function renderBio(p) {
  if (!p) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page not found</title>
      <style>body{font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f6f5fa;color:#1a1446}</style></head>
      <body><p>This page doesn't exist.</p></body></html>`;
  }
  const accent = HEX.test(p.accent) ? p.accent : '#6d28d9';
  const title = p.title || p.brand_name;
  const initial = (title.trim()[0] || '?').toUpperCase();
  const posts = (p.posts || []).map((post) => {
    const m = post.media;
    const visual = m ? (m.kind === 'image'
      ? `<img src="${esc(viewUrl(m.key))}" alt="" loading="lazy">`
      : `<video src="${esc(viewUrl(m.key))}#t=0.1" preload="metadata" muted playsinline></video><span class="play">▶</span>`) : '';
    return `<figure class="post ${m ? 'has-media' : ''}">${visual}<figcaption>${esc(post.content.slice(0, 140))}${post.content.length > 140 ? '…' : ''}</figcaption></figure>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(p.bio.slice(0, 160))}">
<style>
:root{--a:${accent};--ink:#1a1446;--muted:#6b6880}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);
background:linear-gradient(180deg,color-mix(in srgb,var(--a) 16%,#fff),#f6f5fa 320px);min-height:100vh}
main{max-width:560px;margin:0 auto;padding:48px 20px 40px;text-align:center}
.av{width:88px;height:88px;border-radius:50%;margin:0 auto 14px;display:grid;place-items:center;font-size:36px;font-weight:900;color:#fff;background:var(--a);box-shadow:0 10px 30px color-mix(in srgb,var(--a) 40%,transparent)}
h1{font-size:26px;margin:0 0 6px;letter-spacing:-.02em}.bio{color:var(--muted);margin:0 auto 26px;max-width:420px;white-space:pre-wrap}
.links{display:grid;gap:12px}.links a{display:block;padding:15px 18px;border-radius:14px;background:#fff;color:var(--ink);font-weight:700;text-decoration:none;
border:2px solid color-mix(in srgb,var(--a) 30%,#fff);box-shadow:0 2px 6px rgb(26 20 70/.06);transition:transform .15s,border-color .15s}
.links a:hover,.links a:focus-visible{transform:translateY(-2px);border-color:var(--a);outline:none}
h2{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin:34px 0 12px}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;text-align:left}
.post{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 6px rgb(26 20 70/.06);position:relative}
.post img,.post video{width:100%;aspect-ratio:1;object-fit:cover;display:block;background:#eee}
.post figcaption{padding:10px 12px;font-size:13px;color:var(--ink)}.post:not(.has-media) figcaption{padding:16px 14px;min-height:100%}
.play{position:absolute;top:10px;right:10px;width:28px;height:28px;border-radius:50%;background:rgb(255 255 255/.9);display:grid;place-items:center;font-size:11px;color:var(--a)}
footer{margin-top:36px;font-size:12px;color:var(--muted)}
</style></head><body><main>
<div class="av" aria-hidden="true">${esc(initial)}</div>
<h1>${esc(title)}</h1>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : ''}
<nav class="links" aria-label="Links">${p.links.map((l) => `<a href="/r/${l.id}" rel="noopener">${esc(l.label)}</a>`).join('')}</nav>
${posts ? `<h2>Latest posts</h2><section class="grid">${posts}</section>` : ''}
<footer>Made with Nexora</footer>
</main></body></html>`;
}
