import pg from 'pg';

// Return BIGINT/COUNT(*) and NUMERIC (money) results as JS numbers rather than strings.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings: they are calendar days, not instants.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres@localhost:5432/cadence',
  // Serverless instances are many and short-lived: keep each one's share of connections small.
  max: process.env.VERCEL ? 3 : 10,
});

/** Run a parameterised query and return all rows. */
export async function many(sql, params = []) {
  return (await pool.query(sql, params)).rows;
}

/** Run a parameterised query and return the first row (or null). */
export async function one(sql, params = []) {
  return (await pool.query(sql, params)).rows[0] ?? null;
}

/** Run fn(client) inside a transaction; rolls back on throw. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function logActivity(workspaceId, userId, action, detail = '') {
  await pool.query(
    'INSERT INTO activity (workspace_id, user_id, action, detail) VALUES ($1, $2, $3, $4)',
    [workspaceId, userId, action, detail],
  );
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  require_approval BOOLEAN NOT NULL DEFAULT FALSE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
  can_approve BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_ci ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS brands (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6d5efc',
  voice TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channels (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  channel_ids INTEGER[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending','scheduled','published','failed')),
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS posts_brand_time ON posts (brand_id, scheduled_at);
CREATE INDEX IF NOT EXISTS posts_due ON posts (status, scheduled_at);

CREATE TABLE IF NOT EXISTS queue_slots (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  time TEXT NOT NULL CHECK (time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  UNIQUE (brand_id, weekday, time)
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_ws_time ON activity (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('video','image')),
  storage_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  codec TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_ws_time ON media (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS post_media (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);
CREATE INDEX IF NOT EXISTS post_media_media ON post_media (media_id);

-- Feature 11 replaces the free-text image URL with library media.
ALTER TABLE posts DROP COLUMN IF EXISTS media_url;

-- ---------- Feature 12: loan reminders ----------
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS loans_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'INR';

CREATE TABLE IF NOT EXISTS loan_groups (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS loan_groups_name ON loan_groups (workspace_id, lower(name));

CREATE TABLE IF NOT EXISTS loan_customers (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  group_id INTEGER REFERENCES loan_groups(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  consent_sms BOOLEAN NOT NULL DEFAULT FALSE,
  consent_whatsapp BOOLEAN NOT NULL DEFAULT FALSE,
  consent_email BOOLEAN NOT NULL DEFAULT FALSE,
  opted_out_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_customers_ws ON loan_customers (workspace_id, name);

CREATE TABLE IF NOT EXISTS loans (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id INTEGER NOT NULL REFERENCES loan_customers(id) ON DELETE CASCADE,
  reference TEXT NOT NULL DEFAULT '',
  principal NUMERIC(14,2) NOT NULL CHECK (principal > 0),
  installment_amount NUMERIC(14,2) NOT NULL CHECK (installment_amount > 0),
  installments INTEGER NOT NULL CHECK (installments BETWEEN 1 AND 360),
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly')),
  first_due DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_installments (
  id SERIAL PRIMARY KEY,
  loan_id INTEGER NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  paid_at TIMESTAMPTZ,
  UNIQUE (loan_id, seq)
);
CREATE INDEX IF NOT EXISTS loan_installments_due ON loan_installments (due_date) WHERE paid_at IS NULL;

CREATE TABLE IF NOT EXISTS reminder_rules (
  workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  days_before INTEGER[] NOT NULL DEFAULT '{3,1}',
  on_due_day BOOLEAN NOT NULL DEFAULT TRUE,
  overdue_every INTEGER NOT NULL DEFAULT 3 CHECK (overdue_every BETWEEN 0 AND 30),
  channel TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','whatsapp','email')),
  template_before TEXT NOT NULL DEFAULT 'Hi {name}, a reminder from {company}: your payment of {amount} is due on {due_date}.',
  template_due TEXT NOT NULL DEFAULT 'Hi {name}, your payment of {amount} to {company} is due today ({due_date}).',
  template_overdue TEXT NOT NULL DEFAULT 'Hi {name}, your payment of {amount} due on {due_date} is overdue. Please contact {company} if you need help.',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_messages (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES loan_customers(id) ON DELETE SET NULL,
  installment_id INTEGER REFERENCES loan_installments(id) ON DELETE SET NULL,
  sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('manual','before','due','overdue')),
  channel TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email')),
  to_address TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('simulated','sent','failed','skipped')),
  reason TEXT NOT NULL DEFAULT '',
  rule_key TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS loan_messages_ws_time ON loan_messages (workspace_id, created_at DESC);

-- ---------- Link in bio and tracked links (D15) ----------
CREATE TABLE IF NOT EXISTS bio_pages (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id INTEGER NOT NULL UNIQUE REFERENCES brands(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#6d28d9',
  show_posts BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bio_pages_slug ON bio_pages (lower(slug));
CREATE TABLE IF NOT EXISTS bio_links (
  id SERIAL PRIMARY KEY,
  page_id INTEGER NOT NULL REFERENCES bio_pages(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  url TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS short_links (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One row per click; no IP address or other personal data is stored.
CREATE TABLE IF NOT EXISTS link_clicks (
  id BIGSERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  bio_link_id INTEGER REFERENCES bio_links(id) ON DELETE SET NULL,
  short_link_id INTEGER REFERENCES short_links(id) ON DELETE CASCADE,
  referrer_host TEXT NOT NULL DEFAULT '',
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS link_clicks_brand_time ON link_clicks (brand_id, clicked_at);

-- ---------- Content library (D16) ----------
CREATE TABLE IF NOT EXISTS library_items (
  id SERIAL PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  tags TEXT[] NOT NULL DEFAULT '{}',
  media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  approved BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_items_ws ON library_items (workspace_id, updated_at DESC);

-- ---------- brand GSTIN (required for new brands; older brands may have none) ----------
ALTER TABLE brands ADD COLUMN IF NOT EXISTS gstin TEXT;

-- ---------- AI provider per workspace (encrypted keys) ----------
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS ai_provider TEXT
  CHECK (ai_provider IN ('anthropic','gemini','groq','openrouter'));
CREATE TABLE IF NOT EXISTS ai_providers (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic','gemini','groq','openrouter')),
  key_enc TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

-- ---------- Setup: integration credentials (encrypted) ----------
CREATE TABLE IF NOT EXISTS integration_credentials (
  workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('social','messaging')),
  key TEXT NOT NULL,
  data_enc TEXT NOT NULL,
  hint TEXT NOT NULL DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, kind, key)
);
`;

/** Create the target database if the server doesn't have it yet (first run). */
async function ensureDatabase() {
  try {
    await pool.query('SELECT 1');
  } catch (err) {
    if (err.code !== '3D000') throw err; // 3D000 = invalid_catalog_name (database missing)
    const url = new URL(pool.options.connectionString);
    const name = decodeURIComponent(url.pathname.slice(1));
    url.pathname = '/postgres';
    const admin = new pg.Client({ connectionString: url.toString() });
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
      console.log(`Created database "${name}"`);
    } finally {
      await admin.end();
    }
  }
}

export async function migrate() {
  await ensureDatabase();
  await pool.query(SCHEMA);
}
