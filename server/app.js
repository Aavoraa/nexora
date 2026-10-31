import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadUser } from './auth.js';
import { api } from './api.js';
import { storageRouter } from './storage.js';
import { publicLinks } from './links.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

/** Build the Express app (no listener, no background jobs) so tests can mount it. */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });

  app.use('/api', express.json({ limit: '200kb' }), loadUser, api);
  // Signed upload/download URLs; the signature is the authorization (SECURITY §8).
  app.use('/media-store', storageRouter());
  // Public link-in-bio pages and click-tracking redirects (no sign-in).
  app.use(publicLinks);
  // no-cache: browsers must revalidate (cheap 304 by ETag), so a deploy is picked up on
  // the next load. Without it, module scripts were served stale from the browser cache.
  app.use(express.static(publicDir, { index: 'index.html', setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));
  // The SPA uses hash routes, so any other GET just serves the shell.
  app.get('*', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
  return app;
}
