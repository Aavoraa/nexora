// Vercel entry point: the whole Express app as one serverless function.
// vercel.json rewrites /api/*, the public link routes and /media-store/* here; Vercel serves public/ itself.
// There are no timers on serverless, so due posts are published on incoming requests (at most once a
// minute per instance) and by the cron endpoint /api/cron/tick (see server/app.js and vercel.json).
import { migrate } from '../server/db.js';
import { createApp } from '../server/app.js';
import { runDuePosts } from '../server/publisher.js';

const app = createApp();
let ready = null;
let lastDueRun = 0;

export default async function handler(req, res) {
  ready ??= migrate().catch((err) => { ready = null; throw err; });
  try {
    await ready;
  } catch (err) {
    console.error('[startup] database', err);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'The database is not reachable. Check DATABASE_URL in the Vercel project settings.' }));
    return;
  }
  if (Date.now() - lastDueRun > 60_000) {
    lastDueRun = Date.now();
    await runDuePosts().catch((err) => console.error('[publisher]', err));
  }
  return app(req, res);
}
