# DELIVERY — Cadence

Tracks this project against the **Product Build & Delivery SOP** (six phases, gates signed by email, 10-week "Medium" MVP). Update it at every gate. This file is internal: send the client the status summary, not this tracker.

## Current position

| Field | Value |
|---|---|
| Project size | Medium (4–8 features, 2+ roles): 8–10 weeks, Product Demo in week 6–7 |
| Kickoff date | **Not set** (PRD Q1). Day numbers below count from kickoff. |
| Current phase | **0 — Discovery & Kickoff** (PRD v1 drafted, awaiting review) |
| Overall status | Amber: a prototype exists ahead of the gates (see deviation below) |

### Deviation from the SOP

The SOP puts code after documents (Phase 2, Day 16+). Here a working prototype came first. To bring the project back in line:

1. The prototype is a **reference implementation**, not delivered scope. It isn't shown to the client as "done" until the gates pass.
2. All Phase 1 documents were written from the prototype and now drive it. Where a document and the code disagree, the **document wins** once signed, and the code is changed to match.
3. PRD feature **Status** lines show what is Built, Partial or Not started. Sprint planning starts from them.
4. Phase 2 and 3 tasks the prototype already covers become "verify against acceptance criteria", not "build".

## Phase gates

| Phase | Weeks / Days | Exit gate | Status |
|---|---|---|---|
| 0 Discovery & Kickoff | W1 / D1–5 | PRD signed by email, Invoice 1 (40%) paid | ⏳ PRD v1.1: Q2–Q8 have proposed defaults (D2–D8) to confirm at the PRD review. Q1 is open. |
| 1 Documentation & Design | W2–3 / D6–15 | Docs and designs approved by email | 🟡 Docs pack drafted. Wireframes and screen designs not produced (the prototype UI stands in). |
| 2 Build Sprint 1 | W4–5 / D16–25 | Internal review against the PRD passed | 🟡 Scaffold, schema, auth/roles, base UI and Features 1–4 exist. Not yet verified, no staging or CI. |
| 3 Build Sprint 2 + Demo | W6–7 / D26–35 | Demo approved by email, Invoice 2 (30%) | ⬜ Feature 9 (network publishing) not started. No seed data or staging. |
| 4 Testing, UAT & Revisions | W8–9 / D36–45 | UAT signed, Invoice 3 (30%) | ⬜ |
| 5 Deployment & Handover | W10 / D46–50 | Handover signed, final payment | ⬜ |
| Warranty | 30 days after handover | Warranty close review | ⬜ |

## Phase 0–1 document checklist

- [x] PRD.md v1: MVP, non-goals, acceptance criteria, open questions
- [x] DESIGN_SYSTEM.md
- [x] UX_FLOWS.md (loading, empty, error and success states)
- [ ] Wireframes and screen designs shared for comments
- [x] ARCHITECTURE.md
- [x] DATABASE.md
- [x] SECURITY.md
- [x] API.md
- [x] CODE_STYLE.md
- [x] TESTING.md
- [x] AGENTS.md (root, with CLAUDE.md pointing to it)
- [ ] Repository created (git) and shared folder set up
- [ ] Docs pack emailed (D14), design preview held (D15), approval by email

## Engineering backlog to reach the gates

Each item maps to a PRD criterion or SOP checklist line.

| # | Item | Phase | Source |
|---|---|---|---|
| 1 | Put the project under git; tag `v0.1-prototype` | 1 | SOP D14 "repo created" |
| 2 | Dev + staging environments, CI running `npm run check && npm run lint && npm test` | 2 | SOP D16 |
| 3 | Versioned database migrations (replace `IF NOT EXISTS`) | 2 | DATABASE §11 |
| 4 | ✅ `npm run seed` demo data (done 31-10-2026) | 2 | DATABASE §12, SOP D34 |
| 5 | Verify Features 1–7 against their PRD acceptance criteria; record results | 2 | PRD §6 |
| 6 | Network publishing: LinkedIn, Facebook Pages, Instagram (OAuth, encrypted tokens, idempotent adapters, Instagram image rule) | 3 | PRD F9, D2 |
| 6a | Email invites and password reset through Resend (`users.email`, `auth_tokens`) | 2 | PRD F10, D5 |
| 6b | Block over-limit Schedule/Queue, keep Save draft | 2 | PRD F4, D6 |
| 6c | Settings note for pending posts when approval is off | 2 | PRD F6, D7 |
| 6d | `ai.draft_used` event and owner-only success-metrics report | 3 | PRD §9, D8 |
| 6e | ✅ Media library + direct video/image upload (local-disk driver), done 31-10-2026. **Remaining:** S3/R2 storage driver for staging and production (needs bucket credentials) | 3 | PRD F11, D10 |
| 6f | ✅ Loan reminders (Feature 12) built 31-10-2026 (D13). **Remaining:** SMS/WhatsApp/email providers (Q11), inbound STOP webhook, CSV import | 3 | PRD F12 |
| 6g | ✅ Content writing page (Feature 13) built and verified with a live AI key, 31-10-2026 | 3 | PRD F13 |
| 7 | ✅ Live AI test done (31-10-2026). **Remaining:** set a monthly spend limit on the Anthropic key in the Anthropic Console | 3 | SOP "LLM keys have spend limits" |
| 8 | Content-Security-Policy header (remove the inline `onerror`) | 4 | SECURITY §5 |
| 9 | Shared rate-limit store before multi-instance hosting | 4–5 | SECURITY §5 |
| 10 | Playwright E2E for the TESTING §5 flows | 4 | TESTING §2 |
| 11 | Production on the client's own accounts, backups and a tested restore | 5 | SOP D46–47 |

## Third-party accounts (SOP Day 6: client registers, on the client's own accounts)

These have the longest lead times, so they start the day after PRD sign-off.

| Account | Why | Lead time | Cost |
|---|---|---|---|
| Meta for Developers app + Business verification + App Review (`pages_manage_posts`, `instagram_content_publish`) | Facebook and Instagram publishing | 1–4 weeks | Free |
| LinkedIn Developer app + Community Management API access | LinkedIn page publishing | 1–2 weeks | Free |
| Render (region per PRD Q9) | Hosting and Postgres | Same day | Paid monthly |
| Object storage (Cloudflare R2 or AWS S3, region per Q9) | Video and image uploads (F11) | Same day | Storage + egress, usage-based |
| Resend + domain DNS (SPF/DKIM) | Invite and reset emails | 1–2 days | Free tier, then paid |
| Anthropic Console, with a monthly spend limit | AI drafts | Same day | Usage-based |
| Domain + SSL | Production URL | 1 day | Yearly |

Credentials are shared only through the secure vault, never by email (SOP).

## Before-delivery checklist (from the SOP)

- [ ] Applicable tests, lint, type checks and build completed
- [ ] Critical user journeys manually verified where needed
- [ ] Permissions, invalid inputs and failures checked
- [ ] Changed files reviewed for unintended edits
- [ ] Docs reflect the implemented behaviour
- [ ] Unrun checks and remaining limitations recorded

## Check log

| Date | Check | Result |
|---|---|---|
| 31-10-2026 | Nexora "Clean & calm" theme (navy, teal, coral; Manrope + Inter; light sidebar; new logo and favicon): `npm test` 90/90, lint, check. Edge screenshots of sign-in, home, calendar, library and composer at 1440px | Pass |
| 31-10-2026 | Reports + Library (D16): `npm test` 90/90 (5 new), lint, check. Edge screenshots 1440px + 390px, print-to-PDF render. Browser: search and filters, Use → draft opened with text, Save to library from the editor, approve, month back and forth, all brands. Test data removed afterwards. | Pass |
| 31-10-2026 | Link in bio & tracked links (D15): `npm test` 85/85 (new link tests), lint, check. Edge screenshots 1440px + 390px. Browser: save a page (bare address got https://), public page renders, button and short-link clicks counted, UTM short link created. One bug found and fixed (a regex escape was lost, which doubled the https:// on a full URL). | Pass |
| 31-10-2026 | `npm run check` | 16/16 files OK |
| 31-10-2026 | `npm run lint` | Pass |
| 31-10-2026 | `npm test` (unit) | 9/9 pass |
| 31-10-2026 | `npm test` (unit + integration, disposable PostgreSQL 18 instance) | 31/31 pass, 0 skipped |
| 31-10-2026 | Feature 11: `npm test` against the local PostgreSQL 18 (`cadence_test`) | 50/50 pass (19 new media tests) |
| 31-10-2026 | Feature 11 browser check: real browser-recorded MP4 + PNG upload, composer attach, preview playback, save | Pass |
| 31-10-2026 | Automatic model detection (no model field). A user key hit 404 on the fixed default gemini-2.5-flash, so Save and Test now list, rank and ping the key's models, and drafting re-detects retired models. `npm test` 81/81 | Pass |
| 31-10-2026 | AI provider per workspace (Claude, Gemini, Groq, OpenRouter): `npm test` 79/79 (12 new, provider calls stubbed). Edge screenshot. Browser: provider switch, no-key messages for test, save and load. **Not yet run against live provider keys.** | Pass |
| 31-10-2026 | Official network logos (simple-icons, CC0) on Setup, sign-in, channel chips, composer and Content writing; LinkedIn text badge. Tests, lint, check. Edge screenshots | Pass |
| 31-10-2026 | Setup page (integration credentials, encrypted): `npm test` 69 pass + 1 expected skip (7 new). Edge screenshots 1600px + 390px. Browser: save, Connect message, Guide, remove; secret never in the page | Pass |
| 31-10-2026 | Overflow fix: long post text in the Calendar List view ran under the Publishing status panel. Added min-width guards and ellipsis. Measured 15 pages at 1440px: no element overflows its box, no sideways page scroll | Pass |
| 31-10-2026 | Live AI key: `POST /ai/drafts` for LinkedIn and X (200, about 4 s each, within limits), plus Content writing in the browser | Pass |
| 31-10-2026 | Features 12 + 13 (loan reminders, content writing): `npm test` 63/63 (12 new), check, lint. Edge screenshots. Browser: add customer → add loan → message → mark paid. Two bugs found and fixed (post-add link, lingering dialog). | Pass |
| 31-10-2026 | Two-column page layout (Queue, Posts, Analytics, Brands, Team), single-colour queue slots, draft badge class clash fixed. `npm test` 51/51, check, lint. Edge screenshots 1600px + 390px | Pass |
| 31-10-2026 | UI v3: three-colour palette, top bar + dark sidebar, Home dashboard, search, notifications. `npm test` 51/51, check, lint. Edge screenshots 1600px + 390px. Browser: search, bell, user menu | Pass |
| 31-10-2026 | UI redesign v2 (DESIGN_SYSTEM v2): `npm test` 50/50, check, lint. Browser: drag-to-reschedule, theme toggle, analytics animation, light, dark and 375px (no horizontal scroll on 6 screens) | Pass |
| 31-10-2026 | `npm audit --omit=dev` | 0 vulnerabilities (5 moderate in dev-only ESLint dependencies) |
| 31-10-2026 | Manual browser pass (calendar, composer, schedule, queue, analytics, 375px) | Pass (before this docs pass) |
