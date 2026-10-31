# SECURITY — Cadence

## 1. Authentication

| Field | Value |
|---|---|
| Authentication Provider | Built in ([server/auth.js](../server/auth.js)) |

**Methods:**
- Username and password. scrypt hash (16-byte salt, 64-byte key). Comparison is timing-safe.
- Session: a 256-bit random token stored in `sessions`, sent as the `cadence_sid` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` when `NODE_ENV=production`). With "Keep me logged in" it lasts 14 days. Without it, the cookie ends when the browser closes and the server expires it after 12 hours at most. Sign-out deletes it on the server.
- Planned for the MVP (PRD Feature 10): email invites and password reset. Single-use tokens are stored as SHA-256 hashes and expire (invite 7 days, reset 1 hour). Reset responses never reveal whether an email exists, and a successful reset ends all other sessions.
- Not in the MVP: OAuth sign-in, magic link, TOTP 2FA (Nice-to-have).

## 2. Authorization

| Field | Value |
|---|---|
| Roles | Owner, Admin, Editor, Viewer, plus a per-user **can approve** flag |

**Permissions** (✓ = allowed):

| Action | Viewer | Editor | Admin | Owner |
|---|---|---|---|---|
| View calendar, posts, queue, analytics, team, activity | ✓ | ✓ | ✓ | ✓ |
| Create / edit / delete / schedule / queue posts, use AI drafts | | ✓ | ✓ | ✓ |
| Edit queue slots | | ✓ | ✓ | ✓ |
| Approve / send back posts | flag | flag | ✓ | ✓ |
| Manage brands, channels, workspace settings | | | ✓ | ✓ |
| Add / change / remove editors and viewers | | | ✓ | ✓ |
| Add / change / remove admins | | | | ✓ |

Rules:
- **Authorization is enforced server-side** (`requireRole`, `requireApprover` and per-route checks). The UI only mirrors it.
- **Tenant isolation:** every lookup is scoped to `req.user.workspace_id`. Records in another workspace return **404**, never 403, so their existence isn't revealed.
- Nobody can change the owner or their own access.

## 3. Secrets

- Never hard-code credentials.
- Never commit production secrets (`.env` is git-ignored; `.env.example` holds placeholders only).
- Never expose private secrets to the client.
- Use environment variables (loaded with `node --env-file-if-exists=.env`).
- Rotate compromised credentials.
- In production, use the hosting provider's secret store. Credentials go to the client only through a secure vault (SOP), never by email or chat.

## 4. Environment Variables

| Field | Variables |
|---|---|
| Public | None. The browser gets configuration only from `/api/me` (`ai_enabled`, platforms). |
| Private | `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CADENCE_MODEL` (optional), `PORT`, `NODE_ENV`. Planned: `RESEND_API_KEY`, `MAIL_FROM`, `APP_URL`, `LINKEDIN_CLIENT_ID`/`_SECRET`, `META_APP_ID`/`_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 bytes, base64; it encrypts channel OAuth tokens and must be rotated if leaked) |

## 5. API Security

| Field | Rules |
|---|---|
| Input validation | Server-side on every write: types, lengths, enums, formats and ownership (see DATABASE.md §7). All SQL is parameterised. |
| Rate limiting | In memory, per instance ([server/ratelimit.js](../server/ratelimit.js)): sign-in 10 / 15 min per IP + username; sign-up 5 / hour per IP; AI drafts 30 / hour per user. Returns 429 with `Retry-After`. |
| CORS | None. The API is same-origin only (no CORS headers are sent). |
| CSRF | Every non-GET `/api` request must be `Content-Type: application/json` (otherwise 415), so cross-site HTML form posts are blocked. This works together with `SameSite=Lax`. |
| Authentication | Session cookie. All routes except `/auth/*` and `/me` require it (otherwise 401). |
| Authorization | See §2. |
| Headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, no `X-Powered-By`. A Content-Security-Policy is still to do (inline `onerror` in the image preview must go first). |
| Body size | JSON body is limited to 200 KB. |

## 6. Data Protection

| Field | Rules |
|---|---|
| Sensitive data | Password hashes, session tokens, future channel OAuth tokens, workspace content (unpublished posts are client-confidential). |
| Encryption | TLS in production (terminated at the host or proxy). Postgres encrypted at rest by the provider. OAuth tokens must be encrypted at the application level. |
| Retention | Workspace data is kept while the workspace exists. Expired sessions are deleted when they are next seen. A periodic cleanup job is to do. |
| Deletion | Deleting a workspace cascades to all of its data. Under the SOP, client data is deleted from our systems after the warranty unless there is an AMC. |
| AI | Only the brand name, voice notes, network, tone and brief are sent to Claude. No credentials or personal data belong in briefs: this is stated in the UI copy and the training. |

## 7. Logging

**Never log:** passwords, API keys, tokens or session ids, request bodies, or sensitive personal information.

**Log:**
- Authentication events (`user.login` in `activity`).
- Important actions (`activity`: team, brand, channel, post lifecycle, AI use).
- Errors (5xx stack traces to stderr only, never to the client).
- Security events (to do: failed sign-in attempts once rate limiting is persisted).

## 8. File Uploads

| Field | Value |
|---|---|
| Allowed file types | Video MP4/MOV (H.264/HEVC), image JPG/PNG/WebP (PRD Feature 11, built). Development uses the local-disk driver (`MEDIA_DIR`) with HMAC-signed URLs (`MEDIA_SIGNING_SECRET`; if unset, a random per-process key, so old links stop working after a restart). |
| Maximum size | Video 500 MB and 10 minutes. Image 10 MB. Enforced in the presigned URL (content-length range) and checked again after upload. |
| Validation | Type is checked from the file's own content, never trusted from the name or browser. Size, duration and dimensions are verified server-side before the item becomes `ready`. Rejected files are deleted. Incomplete uploads are removed after 24 hours. |
| Storage | A private bucket with no public access. Upload and read access is only through short-lived presigned URLs issued to signed-in members of the owning workspace. Object keys are random, scoped by workspace, and never contain file names. |

## 9. Security Checklist

- [x] Authentication implemented
- [x] Authorization implemented (server-side, tenant-scoped)
- [x] Server-side validation
- [x] Secrets protected (`.env` git-ignored, none sent to the client)
- [ ] Sensitive data protected: OAuth token encryption is pending Feature 9
- [x] Rate limiting considered (in memory; must be shared before running multiple instances)
- [x] File uploads validated (n/a: URL only)
- [x] Errors do not expose sensitive details (generic 500 message)
- [ ] Dependencies reviewed: run `npm audit` at each gate (31-10-2026: 0 in runtime dependencies; 5 moderate in dev-only ESLint → minimatch, not shipped)
- [ ] Content-Security-Policy header added (the inline `onerror` blocker was removed with Feature 11)


## 10. Loan reminders: consent and messaging (Feature 12)

- **Consent per channel** is stored on each customer, and a message is sent only on a channel the customer agreed to. Otherwise it is skipped and logged with the reason.
- **Opt-out** (`opted_out_at`) blocks every channel. SMS and WhatsApp messages carry "Reply STOP to opt out." Inbound STOP replies aren't processed yet, so staff must record opt-outs (Mark opted out) until a provider webhook is built.
- **No provider is connected:** messages are recorded as "simulated", and the UI says so. Provider credentials (when added) are environment variables, never stored in the database or sent to the browser.
- **Roles:** reminder rules and the module switch are admin-only. Messaging, customers and payments are editor+. Viewers can read.
- **Regulation (open, Q9/Q11):** SMS in India requires DLT registration and approved templates. WhatsApp requires approved business templates. Debt-collection communication rules vary by country, so confirm content and timing with the client's compliance team before going live.


## 11. Integration credentials (Setup page)

- Admin-only to save or remove. Any member can see whether a network is set up, never the values.
- Encrypted at rest with AES-256-GCM (random 96-bit IV per write, auth tag checked on read) using `TOKEN_ENCRYPTION_KEY` (32 bytes, base64, environment only). Without it, saving is refused (503).
- Never returned by any API. Only a hint (provider · …last4) is shown. Leaving a secret blank on edit keeps the stored one, so secrets never need to round-trip through the browser.
- **Key management:** keep the key stable and secret. Changing it makes saved credentials unreadable, and they must be re-entered. Production stores it in the host's secret store, with rotation as a planned task.
- Saves and removals are written to the activity log (no values).


## 12. AI provider keys (D14)

- Admin-only to save, remove, test or list models. Encrypted with `TOKEN_ENCRYPTION_KEY`, never returned (hint only). Leaving the field blank keeps the saved key.
- Keys are used only by the server, and only against fixed provider hosts (api.anthropic.com via the SDK, generativelanguage.googleapis.com, api.groq.com, openrouter.ai), so there is no user-controlled URL (no SSRF).
- Gemini keys are sent in the `x-goog-api-key` header, never in the URL, so they don't end up in logs or proxies.
- `/ai/test` and `/ai/models` share the per-user AI rate limit (30 per hour).
- What's sent to a provider: brand name, voice notes, network, tone and the brief, as before. Choosing a third-party provider means that content goes to that company under its terms. Free tiers (Gemini, Groq, OpenRouter free models) may use prompts to improve their models, so admins should check each provider's data policy before choosing one for client work.

## 13. Public link pages and redirects (D15)

- `/b/:slug` is rendered on the server with every value HTML-escaped and no scripts. It is sent with a strict Content-Security-Policy (`default-src 'none'`, inline styles only, no frames, no forms).
- **No open redirect:** `/r/:id` and `/l/:code` only redirect to URLs an editor saved, and saving accepts only absolute `http:`/`https:` URLs (`javascript:`, `data:` and others are rejected).
- Short-link codes are random (crypto), not sequential.
- **Click data is minimal:** time and referring host only. No IP address, cookie or user agent. Known bots and link-preview fetchers are not counted.
- Reserved page addresses (app routes such as `api`, `admin`, `login`) cannot be claimed. Addresses are unique across all workspaces (409 if taken).

## 14. Content library and reports (D16)

- Every library and report query is scoped to the caller's workspace. A brand or media file from another workspace gives 404 or 400.
- Only users with `can_approve` can set or remove "pre-approved". An edit by anyone else to the text or media clears it, so an approved item can't be changed silently. Pre-approved items still go through normal post approval when the workspace requires it.
- Reports are read-only and open to every role, viewers included, like Analytics. They contain no customer personal data: loan reminders appear only as a count.
- The PDF is made by the user's own browser. No report data leaves Cadence.
