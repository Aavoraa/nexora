# FEATURE_PARITY — Cadence vs. SoLo by Fairway

| Field | Value |
|---|---|
| Date | 31-10-2026 |
| Purpose | Decide which capabilities of the reference product Cadence must match, as input to a PRD scope change |
| Sources | The client's reverse-engineering report (28-10-2026, client-side observation only), and the reference product's public sign-in page (feature walkthrough) |
| Rule | **Feature parity, not a clone.** Cadence matches *what users can do*. Its design, wording, branding and code stay original (AGENTS.md: no copying proprietary assets). |

## Key finding: market positioning

The reference product presents itself as a **social media office for loan officers**. Its Loans collections module (customers, loans, instalment schedules, payment reminders with opt-out) serves that niche. Cadence's PRD currently targets **small marketing teams and agencies**. The difference changes personas, onboarding copy and whether the Loans module belongs at all, so it needs a decision before any parity work (**P0** below).

## Comparison

Status: ✅ Cadence has it · 🟡 partial · ⬜ missing. Effort is a rough estimate in developer-days and covers the build only (no design or third-party approval time).

| # | Capability | Reference product | Cadence today | Gap | Effort |
|---|---|---|---|---|---|
| 1 | Workspace per client / brand | ✅ | ✅ brands with voice, colour, channels | none | 0 |
| 2 | Connect networks through official OAuth, tokens renewed automatically | 8 networks | 🟡 channels are planning targets. 3 networks planned (D2). | OAuth + refresh for each network | 3–5 per network |
| 3 | **Video upload** (MP4/MOV from phone or PC), aspect-ratio readiness (9:16 etc.), media library | ✅ | ⬜ image URL only | object storage, upload, transcode/probe, library UI | 8–10 |
| 4 | AI caption writer with tone, length and emoji options | ✅ (several AI providers) | 🟡 Claude drafts with tone and count | length and emoji controls, caption from video context | 1–2 |
| 5 | Content calendar: month **and week view** | ✅ week view shown | 🟡 month view | week view | 2 |
| 6 | **Best time to post** suggestion | ✅ | ⬜ | heuristic first, then from network analytics | 2 (heuristic) / 4 (data-driven) |
| 7 | Queue slots / auto-fill queue | ✅ | ✅ | none | 0 |
| 8 | Bulk calendar upload (CSV / text) | ✅ | ⬜ | CSV import with validation | 3 |
| 9 | **Publish now** + per-network live status (queued → publishing → published) | ✅ | 🟡 one status per post, no publish-now | per-channel delivery records and UI | 3 |
| 10 | Approvals (approver role, approval/download access) | ✅ | ✅ approval workflow, can-approve flag | download permission (if media exists) | 1 |
| 11 | Sub-users with **per-tab access** set by an admin | ✅ | 🟡 four fixed roles | per-tab allow-list on top of roles | 2 |
| 12 | Team **tasks and targets** | ✅ | ⬜ | tasks, assignment, posting targets per period | 5 |
| 13 | Internal **team chat** (conversations, messages, video) | ✅ | ⬜ | real-time chat (WebSockets); video calls are much larger | 6 (text only) |
| 14 | **Analytics**: reach, engagement, followers, views by day, platform comparison | ✅ | 🟡 output counts only | insights APIs per network, daily snapshot job | 8–10 |
| 15 | **Monthly PDF report + scheduled email reports** | ✅ | ⬜ | PDF generation, scheduled email (needs D5 email) | 4 |
| 16 | **Unified inbox**: comments and DMs across networks, sentiment and question tags | ✅ | ⬜ (PRD non-goal) | webhooks or polling per network, threads, replies, AI tagging | 15–20 |
| 17 | Link shortener with click stats | ✅ | ⬜ (non-goal) | short links, redirect, counts | 3 |
| 18 | Push notifications (web push / mobile) | ✅ | ⬜ (non-goal) | service worker, subscriptions, preferences | 4 |
| 19 | Slack alerts | ✅ | ⬜ | incoming-webhook setting and events | 1 |
| 20 | TOTP two-factor sign-in | ✅ | ⬜ (Nice-to-have) | enrol, verify, recovery codes | 3 |
| 21 | Sign-in history, presence | ✅ | 🟡 sign-ins in the activity log | login history view, online indicator | 2 |
| 22 | **Subscription billing** (per-seat, INR, Razorpay) | ✅ | ⬜ (D3: post-MVP) | plans, seats, checkout, invoices, webhooks | 8–10 |
| 23 | **Loans collections CRM** (customers, groups, loans, instalments, reminder campaigns, opt-out, CSV import) | ✅ (feature flag per account) | ⬜ | a separate product module | 20–25 |
| 24 | Brand kit | ✅ | 🟡 brand colour and voice | logos, fonts, hashtag sets | 2 |

**Totals:** items 2–24 add roughly **110–140 developer-days**. Cadence's current MVP is a 10-week "Medium" project under the SOP. Full parity is a **"Large" project** (12–16 weeks, sprint demos), and the inbox and Loans module alone are about 8 weeks.

## Recommendation

| Tier | Items | Why |
|---|---|---|
| **Add to MVP** | 3 video upload & media library, 4 caption options, 5 week view, 6 best time (heuristic), 9 publish now + per-network status, 19 Slack alerts | The reference product's core loop is "upload a video → caption → schedule → publish everywhere". Without video Cadence can't do the main thing it demonstrates. Roughly 18–20 days. |
| **Phase 2 (after MVP)** | 2 remaining networks, 14–15 network analytics + PDF reports, 20 2FA, 11 per-tab access, 8 CSV import, 22 billing | Valuable, but each depends on network approvals or the MVP being live |
| **Separate decision** | 16 unified inbox, 23 Loans CRM, 13 team chat, 12 tasks/targets | Each is a product of its own. The Loans CRM only makes sense if Cadence targets loan officers (P0). |
| **Skip** | 17 link shortener, 18 push notifications, multi-provider AI | Little value for the cost. Claude covers drafting. |

## Decisions (31-10-2026, user, recorded in PRD v1.2 as D9–D12)

| # | Decision |
|---|---|
| P0 → D9 | **Target market: loan officers.** |
| P1 → D10 | **MVP adds item 3 only** (video upload + media library), as PRD Feature 11. |
| P2 → D11 | **Loans CRM (item 23): Phase 2**, after the MVP. |
| P3 → D12 | **Timeline stays at 10 weeks.** Items 4–6, 9 and 19 from the recommended MVP tier move to Phase 2. |

**Phase 2 candidate list** (to plan after go-live): 23 Loans CRM (committed), then 2, 4, 5, 6, 9, 14–15, 19, 20, 11, 8, 22, 24. Separate product decisions: 16, 13, 12.


## Update 31-10-2026 (D13)

- **Item 23 (Loans CRM): built now** as PRD Feature 12. Customers, groups, loans with schedules, automatic reminders, manual messages and the log. Not yet: provider delivery, inbound STOP, CSV import.
- **Item 4 (caption options): built** as part of PRD Feature 13 (Content writing): length, emoji and hashtags, several networks at once, and loan-officer starter ideas.

## Update 31-10-2026 (D15)

- **Link in bio and tracked UTM links: built** (PRD Feature 14), with click counts kept in Cadence. Not included: custom domains, QR codes, geographic or device breakdowns.

## Update 31-10-2026 (D16)

- **Item 15 (monthly report): partly built** as PRD Feature 15: a monthly report with a PDF download, from Cadence's own data. Scheduled email reports wait for email delivery (D5).
- **Content library** (reusable, pre-approved posts): built as PRD Feature 16.
