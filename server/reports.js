// Monthly reports (D16): one calendar month, in the workspace's time zone, for one brand or all brands,
// compared with the month before. Everything comes from Nexora's own tables (PRD D8: no tracking tools).
import express from 'express';
import { many, one } from './db.js';

const ah = (fn) => (req, res, next) => fn(req, res, next).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status, expose: true }); };
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const reports = express.Router();

/** Totals for one period. $1 workspace, $2 brand or null, $3 from, $4 to. */
async function totals(params, loansEnabled) {
  const brandCond = '($2::int IS NULL OR p.brand_id = $2)';
  const posts = `FROM posts p JOIN brands b ON b.id = p.brand_id WHERE b.workspace_id = $1 AND ${brandCond}`;
  const r = await one(`SELECT
    (SELECT count(*) ${posts} AND p.created_at >= $3 AND p.created_at < $4) AS created,
    (SELECT count(*) ${posts} AND p.status = 'published' AND p.published_at >= $3 AND p.published_at < $4) AS published,
    (SELECT count(*) ${posts} AND p.status = 'failed' AND p.scheduled_at >= $3 AND p.scheduled_at < $4) AS failed,
    (SELECT count(*) FROM link_clicks c WHERE c.workspace_id = $1 AND ($2::int IS NULL OR c.brand_id = $2)
       AND c.clicked_at >= $3 AND c.clicked_at < $4) AS link_clicks,
    (SELECT count(*) FROM activity a WHERE a.workspace_id = $1 AND a.action = 'post.approved' AND a.created_at >= $3 AND a.created_at < $4) AS approved,
    (SELECT count(*) FROM activity a WHERE a.workspace_id = $1 AND a.action = 'post.rejected' AND a.created_at >= $3 AND a.created_at < $4) AS sent_back,
    (SELECT count(*) FROM activity a WHERE a.workspace_id = $1 AND a.action = 'ai.drafts' AND a.created_at >= $3 AND a.created_at < $4) AS ai_requests,
    (SELECT count(*) FROM media m WHERE m.workspace_id = $1 AND m.status = 'ready' AND m.created_at >= $3 AND m.created_at < $4) AS media_uploaded,
    (SELECT count(*) FROM loan_messages lm WHERE lm.workspace_id = $1 AND lm.status IN ('sent','simulated')
       AND lm.created_at >= $3 AND lm.created_at < $4) AS reminders_sent`, params);
  if (!loansEnabled) delete r.reminders_sent;
  return r;
}

reports.get('/monthly', ah(async (req, res) => {
  const ws = await one('SELECT timezone, loans_enabled FROM workspaces WHERE id = $1', [req.user.workspace_id]);
  const tz = ws.timezone;
  const now = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  const month = req.query.month || now;
  if (!MONTH_RE.test(month)) fail(400, 'Month must look like 2026-10');
  if (month > now) fail(400, 'That month has not started yet');

  let brand = null;
  if (req.query.brand_id) {
    const id = Number(req.query.brand_id);
    brand = Number.isInteger(id) && id > 0
      ? await one('SELECT id, name, color FROM brands WHERE id = $1 AND workspace_id = $2', [id, req.user.workspace_id])
      : null;
    if (!brand) fail(404, 'Brand not found');
  }

  // Month boundaries as instants, computed in the workspace's time zone.
  const range = await one(`SELECT
      ($1::timestamp AT TIME ZONE $2) AS start,
      (($1::timestamp + interval '1 month') AT TIME ZONE $2) AS end,
      (($1::timestamp - interval '1 month') AT TIME ZONE $2) AS prev_start`, [`${month}-01`, tz]);
  const ctx = [req.user.workspace_id, brand?.id ?? null];
  const cur = [...ctx, range.start, range.end];

  const posts = `FROM posts p JOIN brands b ON b.id = p.brand_id WHERE b.workspace_id = $1 AND ($2::int IS NULL OR p.brand_id = $2)`;
  const published = `${posts} AND p.status = 'published' AND p.published_at >= $3 AND p.published_at < $4`;
  const [current, previous, daily, byPlatform, byAuthor, byBrand, list, upcoming] = await Promise.all([
    totals(cur, ws.loans_enabled),
    totals([...ctx, range.prev_start, range.start], ws.loans_enabled),
    many(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
        (SELECT count(*) ${published} AND (p.published_at AT TIME ZONE $5)::date = d::date) AS published
      FROM generate_series($6::timestamp, $6::timestamp + interval '1 month' - interval '1 day', interval '1 day') d ORDER BY d`,
    [...cur, tz, `${month}-01`]),
    many(`SELECT c.platform, count(DISTINCT p.id) AS published
      ${published.replace('WHERE', 'JOIN channels c ON c.id = ANY(p.channel_ids) WHERE')}
      GROUP BY c.platform ORDER BY published DESC`, cur),
    many(`SELECT u.display_name AS name,
        count(*) FILTER (WHERE p.created_at >= $3 AND p.created_at < $4) AS created,
        count(*) FILTER (WHERE p.status = 'published' AND p.published_at >= $3 AND p.published_at < $4) AS published
      ${posts.replace('WHERE', 'JOIN users u ON u.id = p.author_id WHERE')}
        AND ((p.created_at >= $3 AND p.created_at < $4) OR (p.published_at >= $3 AND p.published_at < $4))
      GROUP BY u.display_name ORDER BY published DESC, created DESC LIMIT 10`, cur),
    brand ? [] : many(`SELECT b.id, b.name, b.color, count(p.id) AS published
      FROM brands b LEFT JOIN posts p ON p.brand_id = b.id AND p.status = 'published' AND p.published_at >= $3 AND p.published_at < $4
      WHERE b.workspace_id = $1 AND $2::int IS NULL GROUP BY b.id ORDER BY published DESC, b.name`, cur),
    many(`SELECT p.id, left(p.content, 220) AS excerpt, p.published_at, b.name AS brand_name, u.display_name AS author_name,
        (SELECT coalesce(array_agg(DISTINCT c.platform), '{}') FROM channels c WHERE c.id = ANY(p.channel_ids)) AS platforms
      ${published.replace('WHERE', 'LEFT JOIN users u ON u.id = p.author_id WHERE')}
      ORDER BY p.published_at DESC LIMIT 50`, cur),
    one(`SELECT count(*) AS scheduled ${posts} AND p.status IN ('scheduled','pending') AND p.scheduled_at >= now()`, ctx),
  ]);

  res.json({
    month, current_month: now, timezone: tz, brand,
    period: { start: range.start, end: range.end },
    totals: current, previous, daily,
    by_platform: byPlatform, by_author: byAuthor, by_brand: byBrand,
    published_posts: list, scheduled_ahead: upcoming.scheduled,
  });
}));
