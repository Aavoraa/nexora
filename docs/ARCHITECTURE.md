# ARCHITECTURE — Cadence

## 1. System Overview

Cadence is a single Node.js service. It serves a static single-page app and a JSON API under `/api`, runs a background publisher that sends out due posts, and calls the Claude API for drafting. All state lives in PostgreSQL.

## 2. Architecture Pattern

| Field | Value |
|---|---|
| Pattern | Modular monolith (one process; modules split by responsibility) |
| Reason | A small team and an MVP scope. One deployable keeps hosting, debugging and the client handover simple. The publisher is safe to run in several instances (`FOR UPDATE SKIP LOCKED`), so the app can scale horizontally without a redesign. |

## 3. Technology Stack

| Field | Value |
|---|---|
| Frontend | Vanilla JavaScript ES modules, hash router, one CSS file. No build step. |
| Backend | Node.js 22+, Express 4 |
| Database | PostgreSQL 16+ through `pg` (node-postgres) |
| Authentication | Own implementation: scrypt password hashes and server-side session tokens in a cookie |
| Storage | Planned for Feature 11: S3-compatible object storage (e.g. Cloudflare R2 or AWS S3, in a region matching PRD Q9). The bucket is private. The browser uploads directly with presigned PUT URLs and reads with short-lived presigned GET URLs. Planned module: `server/media.js` (the only module that talks to storage). Today media is an image URL. |
| Hosting | Render, Singapore region: Node web service plus Render PostgreSQL, on the client's own account (PRD D4). TLS, and a health check on `/api/me`. |
| Payments | Not in the MVP (PRD D3) |
| Email | Resend (HTTP API) for invites and password reset (PRD D5, Feature 10). Planned module: `server/mail.js`. |
| Analytics | Built-in output counts plus an owner-only success-metrics report from the database. No third-party tracking (PRD D8). |
| Other Services | Anthropic Claude API (`@anthropic-ai/sdk`) for AI drafts. LinkedIn Posts API and Meta Graph API (Facebook Pages, Instagram content publishing) for publishing (PRD D2, Feature 9). |

## 4. System Components

### Frontend (`public/`)
- Renders every screen from `/api` data. Owns no business rules.
- Hash routing (`#/calendar`, `#/compose/:id`, …). Escapes all user content with `esc()` before inserting HTML.
- Hides controls the user's role can't use. The server enforces the same rules (this is a convenience only).

### Backend (`server/`)
| Module | Responsibility |
|---|---|
| `index.js` | Starts the process: runs migrations, then starts the HTTP listener and the publisher, and shuts down cleanly. |
| `app.js` | Builds the Express app: security headers, JSON body, session loading, `/api`, static files. |
| `api.js` | All routes: input validation, permission checks, workspace scoping, business rules. |
| `auth.js` | Password hashing, sessions, role guards. |
| `ratelimit.js` | In-memory fixed-window rate limiter. |
| `ai.js` | The only module that calls Claude. Structured JSON output, refusal and error mapping. |
| `publisher.js` | Polls for due posts and publishes them through per-platform adapters (simulated until integrations exist). |
| `time.js` | Time-zone-aware queue slot maths. |
| `platforms.js` | Supported networks, character limits, media format guidance (`readiness`), upload limits. |
| `media.js` | Media library: create upload, complete (inspect + validate), delete or archive, attach to posts, cleanup. The only module that calls `storage.js`. |
| `storage.js` | Storage driver behind signed, expiring URLs. Currently the **local-disk driver** (`MEDIA_DIR`, served at `/media-store`). An S3/R2 driver must export the same functions (`newKey`, `uploadUrl`, `viewUrl`, `stat`, `read`, `remove`, `storageRouter`). |
| `mediainfo.js` | Identifies files from their bytes (MP4/MOV, JPEG, PNG, WebP) and reads dimensions, rotation, duration and codec, without ffmpeg. |
| `db.js` | Connection pool, query helpers, transactions, schema migration. |

### Database
- PostgreSQL is the only store: tenants, users, sessions, brands, channels, posts, queue slots and activity. See DATABASE.md.

## 5. Architecture Diagram

```
Browser (SPA) ──fetch JSON──▶ Express ──▶ loadUser (session) ──▶ api.js routes ──▶ PostgreSQL
                                                     │                  │
                                                     │                  └──▶ ai.js ──▶ Claude API
                                                     │
                  setInterval 15s ──▶ publisher.js ──┴──▶ PostgreSQL (SKIP LOCKED) ──▶ network adapters
```

## 6. Data Flow (schedule a post)

1. The user clicks "Schedule for this time" in the composer.
2. The frontend saves the draft (`POST`/`PATCH /api/posts`), then calls `POST /api/posts/:id/schedule`.
3. `loadUser` resolves the session cookie to a user, or 401.
4. The route checks the role (editor or above) and loads the post **scoped to the user's workspace** (otherwise 404).
5. Business rules: text present, ≥ 1 channel, time not in the past, approval rule → `scheduled` or `pending`.
6. The database is updated and an activity row is written.
7. The updated post is returned as JSON.
8. The UI re-renders and shows a toast. Later the publisher picks the post up when it is due.

## 7. Project Structure

```
server/        backend modules (see table above)
public/        index.html, css/app.css, js/app.js
docs/          SOP documents (this folder)
tests/         unit/ integration/ (see TESTING.md)
AGENTS.md      agent instructions (root, so coding tools find it)
```

## 8. Dependency Rules

- Only `db.js` creates database connections. Other modules use its helpers.
- Only `ai.js` talks to the Claude API. Only `publisher.js` (and its adapters) talks to social networks.
- `api.js` routes call helpers. Helpers never import `api.js`.
- The frontend talks to the backend only through `/api`. It never sees secrets or tokens.
- Every query in a request handler is scoped by `req.user.workspace_id`, directly or through a brand or post lookup that is.

## 9. Key Technical Decisions

| Decision | Context | Alternatives | Reason |
|---|---|---|---|
| PostgreSQL | Multi-tenant relational data, concurrent publisher | SQLite, MongoDB | Client requirement. Row locking (`SKIP LOCKED`) makes the publisher safe across instances. Arrays (`channel_ids INTEGER[]`). |
| Server-side sessions in Postgres | Need instant sign-out and revocation | JWT | Revocable, no token handling in JS, nothing extra to run. |
| No frontend framework or build | Small UI, MVP speed, easy handover | React / Vue + Vite | Nothing to compile and fewer dependencies. Revisit if the UI grows past roughly 3k lines. |
| Hash routing | Static hosting of the shell | History API routing | Works with any static host or CDN without rewrites. |
| Claude with structured JSON output | Need N clean drafts every time | Free-text parsing | A schema-constrained response means no fragile parsing. |
| In-process publisher | MVP simplicity | Separate worker or queue | `SKIP LOCKED` already prevents double publishing. It can be split into a worker later without changing the schema. |

## 10. Performance Considerations

- API p95 < 300ms for list endpoints at ≤ 500 posts per brand. Lists are capped at 500 rows.
- Indexes: `posts(brand_id, scheduled_at)`, `posts(status, scheduled_at)`, `activity(workspace_id, created_at DESC)`.
- The publisher handles at most 50 due posts per tick, every 15s.
- AI drafting uses `effort: low` for latency. Expect a few seconds per request.

## 11. Scalability Considerations

- The app is stateless apart from the rate limiter, which is in memory and per instance. Move it to Postgres or Redis before running more than one instance.
- The publisher is concurrency-safe across instances.
- The connection pool uses the `pg` default of 10 per instance. Size it against Postgres `max_connections`.

## 12. Failure Scenarios

| What happens if… | Expected behaviour |
|---|---|
| Database unavailable at start | The process logs a clear message and exits with code 1 (the supervisor restarts it). |
| Database unavailable at runtime | The request returns 500 "Something went wrong" (details only in the server log). Publisher ticks log the error and retry on the next tick. |
| API times out | The browser shows the error toast. The SDK retries Claude calls (2 retries by default). |
| Claude fails / refuses / rate-limits | 503 / 422 / 429 with a plain message. The editor content is kept. |
| A network publish fails | The post is marked `failed` with the reason in `review_note`, and the failure is logged. The user can edit and reschedule. |
| Authentication fails | 401. The frontend returns to the sign-in screen. Expired sessions are deleted. |
| Process crashes mid-publish | The transaction rolls back and the post stays `scheduled`, so it is retried. (Risk: a network that accepted the post before the crash could get a duplicate. Adapters must use idempotency keys where the network supports them.) |


**Dependency note (31-10-2026):** `simple-icons` (dev dependency, CC0-1.0) supplies the official network logo paths. They're baked into `public/js/brand-icons.js` at build time (`npm run icons`), so nothing extra ships to the browser and there are no runtime requests to an icon CDN.


**AI providers (D14):** `server/aiproviders.js` is the only module that talks to AI services. Claude goes through the official Anthropic SDK. Gemini uses its REST `generateContent` API. Groq and OpenRouter use their OpenAI-compatible `/chat/completions`. Every provider returns the same `{drafts: []}` JSON (structured output or JSON mode where supported, plus an explicit shape in the prompt and tolerant extraction). `ai.js` builds the brief and calls `completeJson()` with the workspace's resolved provider.
