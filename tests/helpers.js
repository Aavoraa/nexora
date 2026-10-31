// Shared setup for integration tests: a disposable database and a cookie-aware HTTP client.

export const TEST_DB = process.env.TEST_DATABASE_URL;

/** Reason to skip integration tests, or false when they can run. */
export function skipReason() {
  if (!TEST_DB) return 'TEST_DATABASE_URL not set — integration tests skipped (see docs/TESTING.md)';
  const name = new URL(TEST_DB).pathname.slice(1);
  // Guard against pointing the destructive reset at a real database.
  if (!/test/i.test(name)) return `Refusing to run: database name "${name}" must contain "test"`;
  return false;
}

/** Point the app at the test DB, wipe it, migrate, and return the app modules. */
export async function setupApp() {
  process.env.DATABASE_URL = TEST_DB;
  // Tests must not depend on a developer's .env for the credential-encryption key.
  process.env.TOKEN_ENCRYPTION_KEY ||= (await import('node:crypto')).randomBytes(32).toString('base64');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs/promises');
  process.env.MEDIA_DIR = path.join(os.tmpdir(), `cadence-test-media-${process.pid}`);
  await fs.rm(process.env.MEDIA_DIR, { recursive: true, force: true });
  const db = await import('../server/db.js');
  const { createApp } = await import('../server/app.js');
  const publisher = await import('../server/publisher.js');
  try {
    await db.pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== '3D000') throw err;
  }
  await db.migrate(); // creates the database if missing
  await db.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.migrate();
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  return { db, publisher, server, base };
}

/** A tiny HTTP client that keeps its own session cookie, like one browser. */
export function client(base) {
  let cookie = '';
  async function req(method, path, body) {
    const headers = {};
    if (cookie) headers.cookie = cookie;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (p) => req('GET', p),
    post: (p, b = {}) => req('POST', p, b),
    patch: (p, b = {}) => req('PATCH', p, b),
    put: (p, b = {}) => req('PUT', p, b),
    del: (p) => req('DELETE', p, {}),
    raw: req,
  };
}
