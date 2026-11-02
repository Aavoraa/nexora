# API — Cadence

Source of truth for the HTTP contracts. Implementation: [server/api.js](../server/api.js).

## Conventions

| Field | Value |
|---|---|
| Base URL | `/api` (same origin as the app) |
| Authentication | Session cookie `cadence_sid`. Routes marked 🔓 work without it. |
| Versioning | Unversioned while the API has only one client (the bundled SPA). Add `/api/v2` before any third-party use. |
| Request format | JSON. **Every non-GET request must send `Content-Type: application/json`** (otherwise 415), including `{}` bodies. |
| Error format | `{ "error": "Human-readable message" }` with the status code. 5xx bodies are always `"Something went wrong"`, except AI errors, which are safe to show. |
| Pagination | None. Lists are capped (posts 500, activity 100). |
| Rate limits | See SECURITY.md §5. 429 + `Retry-After` seconds. |
| Dates | ISO 8601 UTC strings in and out. |

Common errors: **400** invalid input · **401** not signed in · **403** role too low · **404** not found *or in another workspace* · **409** conflict (username taken) · **415** not JSON · **429** rate limited.

## Auth

| Method & path | Role | Body | Success | Notes |
|---|---|---|---|---|
| 🔓 `POST /auth/register` | — | `workspace`, `username`, `password`, `display_name?`, `timezone?` | 201 `{ok}` + cookie | Creates the workspace, owner, default brand and default queue in one transaction. |
| 🔓 `POST /auth/login` | — | `username`, `password`, `remember?` (bool) | 200 `{ok}` + cookie | 401 on a bad pair (the message doesn't say which part). `remember: true` gives a 14-day persistent cookie. Otherwise it is a browser-session cookie, and the server expires it after 12 hours. |
| 🔓 `POST /auth/logout` | — | `{}` | 200 `{ok}` | Deletes the server session. |
| 🔓 `GET /me` | — | — | `{user:null}` or `{user, workspace, platforms, ai_enabled}` | Boot call. |

## Workspace & team

| Method & path | Role | Body | Success |
|---|---|---|---|
| `PATCH /workspace` | admin | `name?`, `require_approval?` (bool), `timezone?` | workspace |
| `GET /activity` | any | — | latest 100 `{id, action, detail, created_at, user}` |
| `GET /team` | any | — | members `{id, username, display_name, role, can_approve, created_at}` |
| `POST /team` | admin (owner for `role:admin`) | `username`, `password`, `role`, `display_name?`, `can_approve?` | 201 member |
| `PATCH /team/:id` | admin (owner for admins) | `role?`, `can_approve?` | member |
| `DELETE /team/:id` | admin (owner for admins) | `{}` | `{ok}` |

Team rules: the owner, and the caller themselves, can't be changed (403 / 400).

## Brands, channels, queue

| Method & path | Role | Body | Success |
|---|---|---|---|
| `GET /brands` | any | — | brands with nested `channels[]` |
| `POST /brands` | admin | `name`, `gstin`, `color?`, `voice?`, `channels?: [{platform, handle}]` | 201 brand with nested `channels[]` (default weekday 10:00 slots). GSTIN is stored uppercase. A missing or invalid GSTIN (format or check character) or a bad channel → 400 and nothing is created. |
| `PATCH /brands/:id` | admin | `name?`, `color?`, `voice?`, `gstin?` | brand. A GSTIN can be added or corrected but not cleared (blank or invalid → 400). |
| `DELETE /brands/:id` | admin | `{}` | `{ok}`. 400 if it is the last brand. Cascades. |
| `POST /brands/:id/channels` | admin | `platform`, `handle` | 201 channel (leading `@` removed) |
| `DELETE /brands/:id/channels/:cid` | admin | `{}` | `{ok}` |
| `GET /brands/:id/slots` | any | — | `[{id, weekday, time}]` |
| `PUT /brands/:id/slots` | editor | `slots: [{weekday 0–6, time "HH:MM"}]` (≤ 100; invalid entries dropped) | the new full list (replaces the old one) |

## Posts

Post object: `id, brand_id, author_id, author_name, content, media[], channel_ids[], status, scheduled_at, published_at, approved_by, approver_name, review_note, created_at, updated_at`.

| Method & path | Role | Body / query | Success | Rules |
|---|---|---|---|---|
| `GET /posts` | any | `?brand_id&status=a,b&from&to` | post[] (≤ 500), newest first | The `from`/`to` range applies to `COALESCE(scheduled_at, published_at)`. |
| `GET /posts/:id` | any | — | post | |
| `POST /posts` | editor | `brand_id`, `content?`, `media_ids?`, `channel_ids?` | 201 post (draft) | Channel ids from other brands are silently dropped. |
| `PATCH /posts/:id` | editor | `content?`, `media_ids?` (replaces the list), `channel_ids?` | post | 400 if published. A failed post becomes draft. When approval is on, a non-approver's edit to a pending or scheduled post sends it back to pending. |
| `DELETE /posts/:id` | editor | `{}` | `{ok}` | |
| `POST /posts/:id/schedule` | editor | `scheduled_at` (ISO) | post (`scheduled` or `pending`) | Needs text, ≥ 1 channel and a time no more than 1 minute in the past. |
| `POST /posts/:id/queue` | editor | `{}` | post | Next free slot within 4 weeks. 400 if there are no slots or the queue is full. |
| `POST /posts/:id/unschedule` | editor | `{}` | post (draft) | Only from scheduled, pending or failed. |
| `POST /posts/:id/approve` | approver | `{}` | post (scheduled) | Only from pending. 400 if the time has passed. |
| `POST /posts/:id/reject` | approver | `note?` | post (draft, `review_note` set) | Only from pending. |

Idempotency: repeating `approve`/`reject` returns 400 (the post is no longer pending). Repeating `schedule` with the same time gives the same result.

## Media (PRD Feature 11)

Media object: `id, kind ("video"|"image"), filename, mime, bytes, width, height, duration_ms, codec, status, created_at, url, aspect, readiness{platform: {ok, note}}`. The `url` is signed and expires within about an hour. The storage key is never returned.

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `GET /media` | any | — | ready media, newest first (≤ 500) | |
| `POST /media` | editor | `filename`, `mime` (video/mp4, video/quicktime, image/jpeg, image/png, image/webp), `bytes` | 201 `{media, upload: {method: "PUT", url}}` | 400 type not allowed, empty, or over the limit (video 500 MB, image 10 MB) |
| `PUT <upload.url>` | signature | raw file body | 200 `{ok, bytes}` | 403 bad or expired signature · 413 body over the signed size |
| `POST /media/:id/complete` | editor | `{}` | ready media | 400 upload missing · 422 not a supported file (by content), too large, or longer than 10 min. The file and row are deleted. |
| `DELETE /media/:id` | editor | `{}` | `{ok, result: "deleted"\|"archived"}` | 409 used by a scheduled or pending post |

Rules: if a published post used the media, it is **archived** (hidden from the library, kept for the record). Uploads still `uploading` after 24 hours are removed by an hourly job.

Posts accept `media_ids` (ordered) on `POST /posts` and `PATCH /posts/:id`: one video, or 1–10 images, all `ready` and in the caller's workspace (otherwise 400). The post object includes `media[]` (media objects as above). `schedule`/`queue` return 400 "Instagram posts need an image or video" when an Instagram channel is selected and no media is attached.

## AI

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `POST /ai/drafts` | editor | `brand_id`, `brief`, `platform?`, `tone?`, `count?` (1–5, default 3) | `{drafts: string[]}` | 503 not configured or key rejected · 429 busy or rate limited · 422 refused · 502 cut off or bad response |

Side effects: one Claude API call (cost), plus an `ai.drafts` activity row.

## Analytics

| Method & path | Role | Query | Success |
|---|---|---|---|
| `GET /analytics` | any | `brand_id?` | `{by_status: {status: n}, by_platform: [{platform, count}], weekly: [{week "YYYY-MM-DD" (UTC Monday), count}], authors: [{name, count}]}` |

## Tests

Each endpoint group is covered in `tests/integration/api.test.js` for success, invalid input, unauthenticated, forbidden and cross-workspace access. See TESTING.md.

## Loan reminders (Feature 12)

All routes return **403 `{code: "loans_disabled"}`** until an admin sets `loans_enabled: true` with `PATCH /workspace` (which also accepts `currency`, an ISO 4217 code). Every record is workspace-scoped (otherwise 404). Money is a number in the workspace currency; dates are `YYYY-MM-DD` in the workspace time zone.

| Method & path | Role | Body / query | Success |
|---|---|---|---|
| `GET /loans/overview` | any | — | `{today, currency, counts{customers, active_loans, due_7, overdue_count, overdue_amount, sent_30}, upcoming[] (overdue + next 7 days, with days), rules{enabled, channel}, channels{sms, whatsapp, email}}` |
| `GET /loans/groups` · `POST` · `PATCH /:id` · `DELETE /:id` | any / editor | `name` | groups with `members`. 409 on a duplicate name. |
| `GET /loans/customers` | any | `?q&group_id` | customers with `group_name, active_loans, next_due, overdue_amount` |
| `GET /loans/customers/:id` | any | — | customer + `loans[].installments[]` + last 50 `messages` |
| `POST /loans/customers` · `PATCH /:id` · `DELETE /:id` | editor | `name`, `phone?`, `email?`, `group_id?`, `consent_sms|whatsapp|email` (bool), `notes?` | customer. 400 on a bad phone or email. |
| `POST /loans/customers/:id/opt-out` | editor | `opted_out` (default true) | customer |
| `POST /loans/customers/:id/loans` | editor | `principal`, `installments` (1–360), `frequency` (weekly/monthly), `first_due`, `reference?`, `installment_amount?` | 201 loan + generated `installments` |
| `PATCH /loans/loans/:id` · `DELETE` | editor | `status` (active/closed) | loan |
| `POST /loans/installments/:id/pay` | editor | `paid` (default true) | instalment. The loan closes when all are paid. |
| `GET /loans/rules` · `PUT /loans/rules` | any / **admin** | `enabled`, `days_before[]` (1–30, ≤ 5), `on_due_day`, `overdue_every` (0–30), `channel`, `template_before|due|overdue` | rules + channel status |
| `POST /loans/rules/run` | admin | `{}` | `{created}`. Idempotent. |
| `POST /loans/send` | editor | `channel`, `body`, and `group_id` or `customer_ids[]` (≤ 500) | `{recipients, simulated, sent, skipped, failed}` |
| `GET /loans/messages` | any | `?status&customer_id` | latest 300 with `customer_name, sent_by_name` |

Message `status`: `simulated` (no provider connected: logged, not delivered) · `sent` · `failed` · `skipped` (`reason`: opted out, no consent, no address).

## AI drafts: Content writing options (Feature 13)

`POST /ai/drafts` also accepts `length` (short/medium/long, default medium), `emoji` (default true) and `hashtags` (default false).

## Setup: integration credentials

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `GET /integrations` | any | — | `{social[8], messaging[3], encryption_ready}`. Each item: `key, label, supports[], portal, steps[], providers?, fields[{name,label,secret}], configured, hint, updated_at, updated_by, available:false, connected:false` | |
| `PUT /integrations/:kind/:key` | **admin** | the item's fields (e.g. `client_id`, `client_secret`, or `provider`, `api_key`, `sender`). A blank secret keeps the saved one. | the item | 400 missing field or unknown provider · 404 unknown integration · 503 no TOKEN_ENCRYPTION_KEY |
| `DELETE /integrations/:kind/:key` | admin | `{}` | `{ok}` | |
| `POST /integrations/:kind/:key/connect` | admin | `{}` | — | **501** with an explanation: connecting and delivery are not built yet |

`kind` is `social` (instagram, facebook, youtube, x, linkedin, threads, tiktok, pinterest) or `messaging` (sms, whatsapp, email). Secrets and full IDs are never returned; `hint` shows only the provider and the last 4 characters of the ID or sender.

## AI provider settings (D14)

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `GET /ai/settings` | any | — | `{selected, source ('workspace'|'platform'|null), active_provider, active_model, platform_available, providers[{key, label, badge, description, key_url, key_prefix, default_model, configured, hint, model, updated_at, updated_by}]}` | |
| `PUT /ai/settings` | **admin**, AI rate limit | `provider` (anthropic/gemini/groq/openrouter), `api_key?` (blank keeps the saved one), `select?` (default true) | settings + `detected{model, ms}`. The model is **detected automatically**: the key's models are listed and ranked, and the best one that answers is saved. Nothing is saved if none does. | 400 no key / key rejected / no usable model / unknown provider · 429 · 503 no TOKEN_ENCRYPTION_KEY |
| `DELETE /ai/settings/:provider` | admin | `{}` | settings (unselects it if it was selected) | |
| `POST /ai/settings/unselect` | admin | `{}` | settings (falls back to the platform key or off) | |
| `POST /ai/test` | admin, AI rate limit | `provider`, `api_key?` (else the saved key) | `{ok, model, ms, tried[]}`: runs the same detection without saving | 400 key rejected / no usable model · 429 · 502 |

`GET /me` → `ai_enabled` is true when the workspace has a usable provider (its own, or the platform key).

## Link in bio & tracked links (D15)

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `GET /bio?brand_id` | any | — | `{page{slug, title, bio, accent, show_posts, links[{id, label, url, clicks}]} or null, suggested_slug, daily[{day, clicks}]}` (30 days) | 404 brand |
| `PUT /bio` | editor | `brand_id, slug, title?, bio?, accent?, show_posts?, links[{label, url}]` (max 20) | the saved page | 400 bad address / reserved / missing button text / not an http(s) URL · 409 address taken |
| `GET /links?brand_id` | any | — | `[{id, code, label, url, utm_source, utm_medium, utm_campaign, clicks, clicks_7d, created_at}]` | |
| `POST /links` | editor | `brand_id, url, label?, utm_source?, utm_medium?, utm_campaign?` | the new link (`code` is 7 random characters) | 400 not an http(s) URL |
| `DELETE /links/:id` | editor | `{}` | `{ok}` | 404 |

**Public routes (no sign-in, outside `/api`):** `GET /b/:slug` (the page, server-rendered, no scripts), `GET /r/:id` (bio button → 302), `GET /l/:code` (short link → 302 with UTM tags). Unknown ids give 404. Redirect targets are only ever saved http(s) URLs.

## Content library (D16)

| Method & path | Role | Body | Success | Errors |
|---|---|---|---|---|
| `GET /library?brand_id` | any | — | `{categories[], items[{id, title, body, category, tags[], brand_id, brand_name, media, approved, approved_by_name, use_count, last_used_at, created_by_name, …}]}`. With `brand_id`: that brand's items plus all-brand items. | 400 bad id |
| `POST /library` | editor | `title, body, category?, tags[]?, brand_id?, media_id?` | 201 item | 400 missing title or text, media not found · 404 brand from another workspace |
| `PUT /library/:id` | editor | same as POST | item. Changing `body` or `media_id` clears `approved` unless the caller can approve. | 400 · 404 |
| `DELETE /library/:id` | editor | `{}` | `{ok}` | 404 |
| `POST /library/:id/approve` | can_approve | `{approved?: bool}` (default true) | item | 403 · 404 |
| `POST /library/:id/use` | editor | `{}` | `{body, media_ids[]}` and `use_count` + 1. The client then creates the draft with `POST /posts`. | 404 |

## Monthly reports (D16)

| Method & path | Role | Query | Success | Errors |
|---|---|---|---|---|
| `GET /reports/monthly` | any | `month?` (YYYY-MM, default this month in the workspace time zone), `brand_id?` (omit for all brands) | `{month, current_month, timezone, brand, period{start,end}, totals{created, published, failed, link_clicks, approved, sent_back, ai_requests, media_uploaded, reminders_sent?}, previous{…same}, daily[{day, published}], by_platform[{platform, published}], by_author[{name, created, published}], by_brand[], published_posts[≤50], scheduled_ahead}` | 400 bad or future month · 404 brand |

`reminders_sent` is present only when the workspace has loan reminders on. `approved`, `sent_back`, `ai_requests` and `media_uploaded` are workspace-wide.
