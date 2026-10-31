# DATABASE — Cadence

The schema is defined in [server/db.js](../server/db.js) (`SCHEMA`) and applied on startup. Change the schema there and here together.

## 1. Database Engine

| Field | Value |
|---|---|
| Database | PostgreSQL 16+ (developed against 18) |
| Hosting | Local development: Postgres on the developer machine. Production: Render PostgreSQL, Singapore, on the client's account (PRD D4), with daily backups and a restore tested before go-live. |

**Planned schema changes** (not built; each needs a migration and a test per §11):
- `users.email` (unique on `lower(email)`, nullable until existing users add one) for Feature 10.
- `auth_tokens` (id, user_id or workspace_id, purpose ∈ {invite, reset}, token_hash, email, role, can_approve, expires_at, used_at) for invites and resets.
- `channels.credentials` (encrypted bytea), `channels.external_id` and `channels.status` ∈ {planning, connected, expired} for Feature 9.

## 2. Naming Conventions

| Field | Convention |
|---|---|
| Tables | `snake_case`, plural (`posts`, `queue_slots`) |
| Columns | `snake_case` |
| Primary Keys | `id SERIAL` (sessions use `token TEXT`) |
| Foreign Keys | `<singular>_id` (`brand_id`, `workspace_id`) with an explicit `ON DELETE` rule |
| Timestamps | `TIMESTAMPTZ`, named `*_at`, default `now()`. Always stored in UTC. |
| Booleans | Plain adjective or verb phrase (`require_approval`, `can_approve`) |

## 3. Tables

### workspaces
| Field | Value |
|---|---|
| Purpose | Tenant boundary. Everything belongs to exactly one workspace. |
| Columns | id, name, require_approval (bool, default false), timezone (IANA, default 'UTC'), created_at |

### users
| Field | Value |
|---|---|
| Purpose | People who sign in. Each belongs to one workspace. |
| Columns | id, workspace_id → workspaces, username (unique on `lower(username)`), password_hash, display_name, role ∈ {owner, admin, editor, viewer}, can_approve (bool), created_at |

### sessions
| Field | Value |
|---|---|
| Purpose | Server-side sign-in sessions. |
| Columns | token (PK, 64 hex chars), user_id → users (cascade), expires_at |

### brands
| Field | Value |
|---|---|
| Purpose | A client or brand inside a workspace, with its own voice, channels and queue. |
| Columns | id, workspace_id → workspaces (cascade), name, color (#RRGGBB), voice, created_at |

### channels
| Field | Value |
|---|---|
| Purpose | A network account a brand publishes to. |
| Columns | id, brand_id → brands (cascade), platform (key in `platforms.js`), handle, created_at |

### posts
| Field | Value |
|---|---|
| Purpose | A piece of content and its lifecycle. |
| Columns | id, brand_id → brands (cascade), author_id → users (set null), content, channel_ids INTEGER[], status ∈ {draft, pending, scheduled, published, failed}, scheduled_at, published_at, approved_by → users (set null), review_note, created_at, updated_at |

### media (Feature 11)
| Field | Value |
|---|---|
| Purpose | Uploaded videos and images, shared across a workspace's brands. |
| Columns | id, workspace_id → workspaces (cascade), uploaded_by → users (set null), kind ∈ {video, image}, storage_key (unique, never sent to the client), filename, mime (from the file's content after checking), bytes, width, height (display orientation, rotation applied), duration_ms, codec (e.g. `avc1`, `hvc1`), status ∈ {uploading, ready, archived}, created_at |

### post_media (Feature 11)
| Field | Value |
|---|---|
| Purpose | Which media a post uses, in order. |
| Columns | post_id → posts (cascade), media_id → media (cascade), position; PK (post_id, media_id) |

`posts.media_url` was dropped when Feature 11 shipped (31-10-2026). Development data only, nothing to migrate.

### queue_slots
| Field | Value |
|---|---|
| Purpose | Weekly posting times per brand, in the workspace's time zone. |
| Columns | id, brand_id → brands (cascade), weekday 0–6 (0 = Sunday), time 'HH:MM'; unique (brand_id, weekday, time) |

### activity
| Field | Value |
|---|---|
| Purpose | Audit trail shown in Settings. |
| Columns | id, workspace_id → workspaces (cascade), user_id → users (set null; null = system), action (e.g. `post.approved`), detail, created_at |

## 4. Relationships

| Relationship | Rule |
|---|---|
| workspaces → users | One workspace has many users. Exactly one has the role `owner`. |
| workspaces → brands | One workspace has many brands (at least one, enforced in the API). |
| brands → channels | One brand has many channels. |
| brands → posts | One brand has many posts. |
| posts → channels | Many-to-many through `posts.channel_ids` (array). The API checks that each id belongs to the post's brand. There is no FK on array elements: deleted channels are skipped at publish time. |
| brands → queue_slots | One brand has many slots. |
| users → posts | Author and approver. `SET NULL` when the user is removed, so the history survives. |
| users → sessions | One user has many sessions. Cascade on delete. |

## 5. Constraints

**Required:** every `NOT NULL` column above. Notably `users.password_hash`, `posts.status`, `queue_slots.time`.

**Unique:** `lower(users.username)`, `queue_slots (brand_id, weekday, time)`, `sessions.token`.

**Foreign Keys:** as listed. Tenant deletion cascades from `workspaces`.

**Checks:** `users.role`, `posts.status`, `queue_slots.weekday BETWEEN 0 AND 6`, `queue_slots.time ~ '^[0-2][0-9]:[0-5][0-9]$'`.

## 6. Indexes

| Index | Reason |
|---|---|
| `users_username_ci` on `lower(username)` | Case-insensitive unique sign-in lookup |
| `posts_brand_time` on `(brand_id, scheduled_at)` | Calendar, queue and list queries |
| `posts_due` on `(status, scheduled_at)` | Publisher's due-post scan |
| `activity_ws_time` on `(workspace_id, created_at DESC)` | Activity feed |

## 7. Data Validation

These rules are enforced in `api.js` before any write:
- Strings are trimmed and length-capped: names 80, voice 2000, content 10,000, media URL 2000, review note 1000, brief 2000.
- Colours must match `#RRGGBB`. Times must match `HH:MM` (00–23). The time zone must be a valid IANA zone.
- Every referenced id (brand, channel, post, member) is checked to belong to the caller's workspace. Invalid ids give 400, out-of-scope ids give 404.

## 8. Soft Delete

| Field | Value |
|---|---|
| Does the system use soft deletion? | No |
| If yes | — Deletes are hard and always confirmed in the UI. Deletions are recorded in `activity`. |

## 9. Auditing

| Question | Answer |
|---|---|
| Created by? | Yes: `posts.author_id`. Brands, channels and members through `activity`. |
| Updated by? | Partly: `posts.updated_at`. Who edited is not stored per edit (Nice-to-have). |
| Deleted by? | Yes, through `activity` (`post.deleted`, `brand.deleted`, `team.removed`). |
| Activity history? | Yes, the `activity` table. It is kept for the life of the workspace. |

## 10. Sensitive Data

| Field | Protection |
|---|---|
| `users.password_hash` | scrypt with a 16-byte random salt and 64-byte key. Never returned by any API. |
| `sessions.token` | 256-bit random. Only ever in an HttpOnly cookie. |
| Future channel OAuth tokens | Must be encrypted at rest (application-level key from the environment) and never sent to the client. |

## 11. Migration Rules

Schema changes must:
1. Be documented here.
2. Have a migration. Currently that is `CREATE … IF NOT EXISTS` in `db.js`. **Before the first production deploy, move to versioned migration files** (e.g. `node-pg-migrate`). `IF NOT EXISTS` can't alter existing tables.
3. Be tested (the integration tests run against a fresh database).
4. Avoid breaking existing production data: additive changes first, backfill, then remove old columns in a later release.

## 12. Seed Data

`npm run seed` ([scripts/seed.js](../scripts/seed.js)) creates the **Demo Agency** workspace:
- Approval on, time zone Asia/Kolkata.
- Users `demo_owner`, `demo_editor` and `demo_viewer` (viewer with can-approve), all with the password from `SEED_PASSWORD` in `.env`.
- Two brands with voices and channels, weekday 09:00/15:00 queues, and 17 posts in every status spread around today.

Re-running replaces only the demo workspace. Demo passwords live only in `.env`, never in docs sent to clients.


## Loan reminder tables (Feature 12)

| Table | Purpose and columns |
|---|---|
| `workspaces` (+) | `loans_enabled` (default false), `currency` (ISO 4217, default INR) |
| `loan_groups` | id, workspace_id (cascade), name. Unique on (workspace_id, lower(name)). |
| `loan_customers` | id, workspace_id (cascade), group_id (set null), name, phone, email, consent_sms / consent_whatsapp / consent_email, opted_out_at, notes, created_at |
| `loans` | id, workspace_id, customer_id (cascade), reference, principal NUMERIC(14,2) > 0, installment_amount > 0, installments 1–360, frequency ∈ {weekly, monthly}, first_due DATE, status ∈ {active, closed} |
| `loan_installments` | id, loan_id (cascade), seq, due_date DATE, amount, paid_at. Unique (loan_id, seq). Partial index on due_date where unpaid. |
| `reminder_rules` | workspace_id PK, enabled, days_before INT[], on_due_day, overdue_every 0–30, channel, template_before / due / overdue |
| `loan_messages` | id, workspace_id, customer_id (set null), installment_id (set null), sent_by, kind ∈ {manual, before, due, overdue}, channel, to_address, body, status ∈ {simulated, sent, failed, skipped}, reason, **rule_key UNIQUE** (makes automatic reminders idempotent), created_at |

NUMERIC values are parsed to JS numbers (fine for currency amounts up to 10¹¹ with 2 decimals). DATE values stay `YYYY-MM-DD` strings: they are calendar days, not instants. **Sensitive data:** customer phone numbers, emails and payment status are personal data. They are workspace-scoped, never sent to the AI, and deleted with the customer.


## integration_credentials (Setup)

| Column | Notes |
|---|---|
| workspace_id, kind ∈ {social, messaging}, key | Primary key. Cascade on workspace delete. |
| data_enc | JSON of the fields, encrypted with AES-256-GCM: `v1:iv:tag:ciphertext` (base64). The key comes from `TOKEN_ENCRYPTION_KEY`. |
| hint | Safe-to-show summary (provider · …last4) |
| updated_by, updated_at | Who saved it, and when |


## AI provider tables (D14)

| Table / column | Notes |
|---|---|
| `workspaces.ai_provider` | Selected provider or NULL. CHECK ∈ {anthropic, gemini, groq, openrouter}. |
| `ai_providers` | PK (workspace_id, provider). `key_enc` holds `{api_key}` encrypted with AES-256-GCM (same scheme as integration_credentials), plus `hint` (…last4), `model` (empty = default), updated_by, updated_at. Cascades with the workspace. |

## Link in bio tables (D15)

| Table | Purpose | Key columns |
|---|---|---|
| `bio_pages` | One public page per brand | `brand_id` UNIQUE, `slug` (unique, case-insensitive), `title`, `bio`, `accent`, `show_posts` |
| `bio_links` | Buttons on a page | `page_id` → bio_pages (cascade), `position`, `label`, `url` |
| `short_links` | Tracked short links | `code` UNIQUE, `url`, `utm_source/medium/campaign`, `brand_id` (set null on delete) |
| `link_clicks` | One row per counted click | `bio_link_id` or `short_link_id`, `referrer_host`, `clicked_at`; index (brand_id, clicked_at). **No IP or user agent is stored.** |

Saving a page replaces its buttons, so click counts are kept per button only while the button exists; the 30-day brand total is unaffected.

## Content library (D16)

| Table | Purpose | Key columns |
|---|---|---|
| `library_items` | Reusable posts | `workspace_id`, `brand_id` (null = all brands, cascade), `title`, `body`, `category`, `tags TEXT[]`, `media_id` → media (set null), `approved`, `approved_by`, `use_count`, `last_used_at`, `created_by`; index (workspace_id, updated_at DESC) |

Reports (D16) add no tables. They read `posts`, `link_clicks`, `activity`, `media` and `loan_messages`.
