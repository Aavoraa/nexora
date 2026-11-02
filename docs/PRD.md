# PRD — Cadence

| Field | Value |
|---|---|
| Document | Product Requirements Document (SOP doc 01) |
| Version | v1.3 (draft for review): loan reminders brought into this release and a content writing page added (D13). Q1, Q9, Q10 open. |
| Date | 31-10-2026 |
| Phase | 0 — Discovery & Kickoff |
| Gate | **PRD sign-off — pending** (approval counts only by email from the client's named approver) |
| Owner | Project Manager |

> **Process note.** A working prototype was built before this PRD existed, which reverses the SOP's "context before code" order. From now on this PRD is the source of truth and the prototype is treated as a reference implementation. Each feature below has a **Status** line (Built / Partial / Not started) so the gap is visible. Nothing in the prototype counts as accepted until this PRD is signed and the feature passes its acceptance criteria.

---

## 1. Product Overview

| Field | Value |
|---|---|
| Product Name | Cadence |
| One-Line Description | A social media workspace for loan officers and their teams: upload a video or image, write the caption with AI, get it approved, and publish it on every network on schedule. |
| Market | Loan officers, branch and team managers, and the compliance reviewers who sign their posts off (D9). Feature parity with the reference product is tracked in [FEATURE_PARITY.md](FEATURE_PARITY.md). |
| Product Type | SaaS (multi-tenant) |
| Primary Platform | Web (responsive: desktop, tablet and mobile browsers) |

## 2. Problem

| Field | Value |
|---|---|
| What problem are we solving? | Loan officers win business through referrals and local visibility, so they need to post regularly: rate updates, client wins, short videos, local market tips. They are busy and not marketers. Every post also has to pass their company's compliance review before it goes out, and today that review happens over email and screenshots. |
| Why does this problem matter? | Inconsistent posting costs leads. A non-compliant post can bring regulatory and reputational risk for the lender, so many officers simply don't post. |
| How are users solving this today? | Posting by hand from their phones, network-native schedulers, marketing departments posting on their behalf, and generic social tools with no compliance approval step. |

## 3. Goal

**Primary Goal:** A loan officer can take a video or image from their phone to a compliance-approved, scheduled post on every connected network in under five minutes.

**Secondary Goals:**
- Make compliance review fast, and keep a permanent record of who approved what.
- Keep each officer's or branch's voice consistent with AI captions grounded in their voice notes.
- Give managers one view of their team's posting (calendar, queue, analytics).

## 4. Target Users

### User Type 1 — Loan officer (role: Editor)

| Field | Value |
|---|---|
| Name | Arjun, Loan Officer |
| Description | Originates loans and builds his pipeline through referrals and local reputation. Films short videos on his phone. Posts between client calls. |

**Needs:**
- Upload a phone video and have it ready for every network without editing.
- A good caption in seconds, in his own voice.
- Know whether compliance has approved it, and if not, why.

**Pain Points:**
- No time to write for each network separately.
- Approvals by email stall for days, so the moment passes.

### User Type 2 — Branch / team manager (role: Owner or Admin)

| Field | Value |
|---|---|
| Name | Priya, Branch Manager |
| Description | Leads 5–25 loan officers. Wants the branch visible online and consistent with the brand. Each brand in Cadence can be one officer, a team or the branch. |

**Needs:**
- One calendar across her officers' brands.
- Regular posting rhythms (queues) she can set up once.
- Proof of activity per officer (analytics).

**Pain Points:**
- Officers who never post, or post off-brand.
- No overview of what went out.

### User Type 3 — Compliance reviewer (role: Viewer or Editor with "can approve")

| Field | Value |
|---|---|
| Name | Meera, Compliance Reviewer |
| Description | Reviews marketing material against the lender's advertising rules before anything is published. |

**Needs:**
- A queue of posts awaiting review, with the exact media, text and target networks.
- Approve, or send back with a note.
- A permanent record of what was approved, by whom and when.

**Pain Points:**
- Reviewing screenshots out of context.
- Posts edited after approval.

## 5. User Stories

- As a loan officer, I want to upload a video from my phone and reuse it across networks so that I can post without editing software.
- As a compliance reviewer, I want any change after approval to send the post back to me so that nothing unapproved is published.
- As a marketing lead, I want to create a workspace so that my team's work lives in one place.
- As a marketing lead, I want to add team members with roles so that people can only do what they're trusted to do.
- As a marketing lead, I want to require approval before posts are scheduled so that nothing goes out unchecked.
- As a marketing lead, I want to manage several brands, each with its own channels and voice, so that client work stays separate.
- As a content creator, I want AI to draft several versions of a post from a short brief so that I start from something good.
- As a content creator, I want to see each network's character limit while writing so that posts aren't truncated.
- As a content creator, I want "add to queue" to pick the next free slot so that I don't have to work out timing.
- As a content creator, I want to see why a post was sent back so that I can fix it quickly.
- As a reviewer, I want to approve or send back a post with a note so that feedback is on record.
- As any team member, I want a calendar of planned and published posts so that I can see gaps and clashes.
- As a marketing lead, I want basic analytics and an activity log so that I can report on output and accountability.

## 6. Core Features

> **Status key:** Built = present in the prototype; still needs formal acceptance testing. Partial = some criteria met. Not started = no implementation.

### Feature 1 — Workspace accounts and sign-in

| Field | Value |
|---|---|
| Status | Built |
| Purpose | Create a workspace with its first owner and sign team members in and out. |
| User Flow | Visitor → Create workspace (workspace name, name, username, password) → lands on the Calendar. Returning user → Sign in → Calendar. |
| Inputs | Workspace name, display name, username, password, browser time zone (automatic). |
| Outputs | Workspace, owner account, default brand with a default queue, signed-in session. |

**Acceptance Criteria:**
- Usernames are 3–32 characters (letters, numbers, `.`, `_`, `-`) and unique regardless of case.
- Passwords are at least 8 characters and are stored only as a salted hash.
- After sign-up the user is signed in and sees the Calendar without a page reload.
- Wrong credentials show "Wrong username or password" without saying which part was wrong.
- Sessions expire after 14 days. Sign-out ends the session on the server.

**Edge Cases:**
- Username already taken → clear error, nothing is created.
- Sign-up fails part-way → nothing is half-created (single transaction).
- An expired session on any page → user goes back to the sign-in screen.

### Feature 2 — Team and roles

| Field | Value |
|---|---|
| Status | Built |
| Purpose | Control what each person can do. |
| User Flow | Admin → Team → enters name, username, temporary password, role and "can approve" → Add. Admin changes a role or approval flag inline, or removes the person. |
| Inputs | Display name, username, temporary password, role (admin / editor / viewer), can-approve flag. |
| Outputs | Team member account, entry in the activity log. |

**Acceptance Criteria:**
- Roles: **Owner** (one per workspace) > **Admin** > **Editor** > **Viewer**. See SECURITY.md for the permission matrix.
- Only the owner can create, change or remove admins. Nobody can change the owner or their own access.
- Owners and admins can always approve. Editors and viewers can approve only when given the flag.
- The server enforces every rule. Hiding controls in the UI is only a convenience.

**Edge Cases:**
- An admin tries to promote someone to admin → 403.
- A removed member's posts stay, with the author shown as "a former member".

### Feature 3 — Brands and channels

| Field | Value |
|---|---|
| Status | Built (channels are publish targets only; see Feature 9) |
| Purpose | Keep each brand's networks, voice and schedule separate. |
| User Flow | Admin → Brands & channels → **+ Add brand** (name, GSTIN, colour, voice and an optional first channel), edit the name, GSTIN, colour and voice, or add a channel (network + handle). Brand switcher in the sidebar. |
| Inputs | Brand name, GSTIN (required for a new brand, D18), colour, voice notes (≤ 2000 chars), network, handle. |
| Outputs | Brand with channels. The selected brand filters the Calendar, Posts, Queue and Analytics. |

**Acceptance Criteria:**
- Networks supported for planning: X, Threads, LinkedIn, Instagram, Facebook, TikTok, Pinterest and YouTube, each with its character limit.
- A workspace always has at least one brand.
- A new brand can't be added without a valid GSTIN (15 characters, correct check character). Brands made before D18 can add one later; once set it can be corrected but not removed.
- Deleting a brand asks for confirmation (the admin types the brand name) and removes its posts, channels and queue.

**Edge Cases:**
- A channel removed while a post is scheduled to it → the post skips it, and fails if it has no channels left.

### Feature 4 — Post composer

| Field | Value |
|---|---|
| Status | Partial: the Instagram media rule and media attachments are built (F11). Blocking over-limit scheduling (D6) is not implemented. |
| Purpose | Write, preview and schedule one post to one or more channels. |
| User Flow | New post (or click a calendar day) → choose channels → write → preview → Save draft / Add to queue / Schedule for a time. |
| Inputs | Channels, text (≤ 10,000 chars), optional media from the library (Feature 11), date and time. The current image-URL field is replaced by Feature 11. |
| Outputs | Post with a status of draft, pending, scheduled, published or failed. |

**Acceptance Criteria:**
- A live counter shows characters used against each selected network's limit and highlights any network that is over.
- The preview shows the brand name, colour, text and image.
- A post can't be scheduled without text, without at least one channel, or for a time in the past.
- A post can't be scheduled or queued while its text is over the limit of any selected network (D6). Saving it as a draft is still allowed. **Not yet implemented.**
- Published posts are read-only.
- Viewers can open posts but can't edit them.

**Edge Cases:**
- Text over a network's limit → the counter turns red, Schedule and Queue return "Too long for <network> (n/limit)", and Save draft still works.
- Image URL that doesn't load → the preview hides the image.

### Feature 5 — AI drafts

| Field | Value |
|---|---|
| Status | Built. Verified with a live API key on 31-10-2026 (drafts in about 4 s, within network limits, in the brand voice). |
| Purpose | Generate 2–4 distinct drafts from a short brief in the brand's voice and the network's style. |
| User Flow | Composer → AI drafts panel → brief, network, tone, count → Write drafts → Use this. |
| Inputs | Brief (≤ 2000 chars), network, tone (optional), count (1–5). |
| Outputs | A list of drafts. The chosen draft goes into the editor. |

**Acceptance Criteria:**
- Drafts follow the brand's voice notes and the network's character limit.
- Each draft is ready to publish as written: no placeholders, no surrounding quotes, no commentary.
- When AI isn't configured, the panel explains how to turn it on, and the server returns 503.
- Refusals, rate limits and timeouts show a plain-language error, and the editor keeps its content.
- AI spend is capped (provider-side limit plus per-user rate limiting).

**Edge Cases:**
- The model declines the brief → "The AI declined this brief. Try rephrasing it."
- Response cut off at the length limit → user is told to ask for fewer drafts.

### Feature 6 — Approval workflow

| Field | Value |
|---|---|
| Status | Built, except the pending-count note in Settings (D7) |
| Purpose | Make sure posts are checked before they go out, when the workspace requires it. |
| User Flow | Admin turns on "Require approval" → an editor schedules or queues a post → it becomes **Awaiting approval** → an approver opens it → **Approve** (becomes Scheduled) or **Send back** with a note (becomes Draft and shows the note). |
| Inputs | Approve / send back, optional note (≤ 1000 chars). |
| Outputs | Status change, approver recorded, activity log entry. Posts awaiting approval are counted in the sidebar. |

**Acceptance Criteria:**
- With approval on, scheduling by a non-approver always produces a pending post.
- Approvers' own posts are scheduled directly.
- If a non-approver edits a pending or scheduled post, it goes back for approval.
- A pending post whose time has passed can't be approved until it is rescheduled.

**Edge Cases:**
- Approval is switched off while posts are pending → they **stay pending** until an approver acts, because nothing goes out without an explicit decision (D7). When pending posts exist, Settings shows "N posts are still awaiting approval" next to the toggle (**not yet implemented**).

### Feature 7 — Calendar and queue

| Field | Value |
|---|---|
| Status | Built |
| Purpose | See the plan and post on a regular rhythm without picking times by hand. |
| User Flow | Calendar: month grid in local time, click a post to open it, click a day to draft for that day. Queue: weekly slots per brand, add or remove slots, "Coming up" list. |
| Inputs | Weekday and time slots. Workspace time zone (Settings). |
| Outputs | Scheduled times for queued posts. |

**Acceptance Criteria:**
- "Add to queue" takes the earliest future slot in the workspace's time zone that no other scheduled or pending post of that brand is using, looking 4 weeks ahead.
- Slot times are correct across daylight-saving changes.
- New workspaces start with weekday slots at 09:00 and 15:00.

**Edge Cases:**
- No slots → "This brand has no queue slots."
- All slots taken for 4 weeks → user is told to add more slots.

### Feature 8 — Analytics and activity

| Field | Value |
|---|---|
| Status | Partial: output metrics and activity log built. The internal success-metrics report and the `ai.draft_used` event (D8) are not started. Engagement metrics depend on Feature 9. |
| Purpose | Report on output and accountability. |
| User Flow | Analytics: status tiles, posts published per week (12 weeks), posts per network, top writers. Settings: activity log. |
| Inputs | Brand filter. |
| Outputs | Charts and the activity list (latest 100). |

**Acceptance Criteria:**
- The counts match the posts table for the selected brand.
- The log covers sign-ins, team changes, brand and channel changes, post create / schedule / submit / approve / reject / publish / fail / delete, and AI use.

### Feature 9 — Publishing to networks

| Field | Value |
|---|---|
| Status | **Partial.** The scheduler is built. The Setup page stores each network's app credentials, encrypted (31-10-2026). The OAuth connection and publishing adapters are not started, so publishing is simulated. |
| Purpose | Send due posts to the real networks. |
| User Flow | Admin connects an account through the network's OAuth. At the scheduled time the publisher sends the post and records the result. |
| Inputs | OAuth tokens per channel. |
| Outputs | Published or failed status, plus the network's post ID or the error. |

**MVP networks (D2):** **LinkedIn** (company pages) and **Facebook Pages + Instagram Business/Creator** (one Meta app). X, Threads, TikTok, Pinterest and YouTube stay **planning-only** channels in the MVP. Posts can be drafted and scheduled for them, but publishing to them is reported as "not connected". X is deferred because posting needs a paid API tier.

**Acceptance Criteria:**
- The scheduler picks up due posts within 15 seconds and never publishes a post twice, even with several server instances.
- Admins connect LinkedIn and Meta accounts through OAuth from Brands & channels. The connected account name is shown, and an expired connection is flagged.
- Instagram posts need an image (the Instagram API rule). The composer blocks scheduling an Instagram post with no image.
- A failure marks the post Failed with the network's reason, and it can be edited and rescheduled.
- Tokens are stored encrypted at the application level and never sent to the browser.
- Publishing to a planning-only channel marks that channel "not connected", and the post fails with that reason.

### Feature 10 — Email invites and password reset

| Field | Value |
|---|---|
| Status | Not started (added by D5) |
| Purpose | Let people join and recover access without an admin sharing passwords. |
| User Flow | Admin → Team → enter an email and role → **Send invite**. The invitee opens the link, sets their name, username and password, and lands in the workspace. Sign-in → **Forgot password?** → email → link → set a new password. |
| Inputs | Email address, role, can-approve flag. Later: the new password. |
| Outputs | Invite or reset email (sent through Resend), single-use token, account. |

**Acceptance Criteria:**
- Invite and reset links are single-use, expire (invites after 7 days, resets after 1 hour), and are stored only as hashes.
- A reset request always shows the same message whether or not the email exists.
- A successful reset signs the user out everywhere else.
- Admins can still create a member with a temporary password (the current flow) as a fallback.
- Users gain an `email` field (unique, case-insensitive). Existing users add theirs on next sign-in.

**Edge Cases:**
- The invite email is already a member → "Already in this workspace".
- The email provider is down → the invite is saved and the admin sees "Email not sent — copy link instead".

### Feature 11 — Media library and video upload

| Field | Value |
|---|---|
| Status | **Built (31-10-2026), with local-disk storage.** The production S3/R2 storage driver is not built yet (needs credentials, DELIVERY 6e). Thumbnails use the video's first frame in the browser; none are generated on the server. |
| Purpose | Upload videos and images once, see whether each one suits each network's format, and attach them to posts. |
| User Flow | **Media** page (or **Add media** in the composer) → drag in, or pick from the phone, an MP4/MOV video or a JPG/PNG/WebP image → a progress bar uploads it straight to storage → the server reads its duration, size and aspect ratio → it appears in the library with a thumbnail and per-network readiness tags → attach it to a post. |
| Inputs | File (video ≤ 500 MB and ≤ 10 min; image ≤ 10 MB), optional title. |
| Outputs | A media item (thumbnail, duration, width × height, aspect ratio, size, readiness per network) that can be reused across posts. |

**Acceptance Criteria:**
- Uploads go straight from the browser to object storage through a short-lived signed URL, so the app server never holds the file. Uploads of up to 500 MB complete over a normal home connection, with progress shown.
- The server checks the real file type (by inspecting the file itself, not the file name) and its limits after upload. Rejected files are deleted, with a plain reason ("Only MP4 or MOV videos").
- Readiness tags compare the media with each network's rules. At minimum: 9:16 vertical (Reels, TikTok, Shorts), 1:1 / 4:5 feed, 16:9 (YouTube, LinkedIn), duration limits. A mismatch is a warning, not a block.
- The composer preview plays the video or shows the image. A post holds at most one video, or up to 10 images.
- Instagram posts can't be scheduled without media (D2 rule, now satisfiable).
- Media can be deleted only when no scheduled or pending post uses it. Published posts keep their reference.
- Only workspace members can read media. Links are signed and expire, and nothing is public.
- Viewers can see media but can't upload or delete it.

**Edge Cases:**
- The upload is interrupted → the item stays "uploading" and is cleaned up after 24 hours. The user can retry.
- Unsupported codec (e.g. HEVC on a network that rejects it) → a warning tag on that network.
- A media item used by a post awaiting approval is changed → not possible, because media is immutable. Replacing it means uploading new media.

**Not included:** video editing, trimming, captions burned into the video, or transcoding (a Phase 2 candidate if networks reject phone formats in practice).

### Feature 12 — Loan reminders

| Field | Value |
|---|---|
| Status | **Built (31-10-2026)**, except real message delivery (no SMS, WhatsApp or email provider connected: messages are logged as "simulated") and CSV import. |
| Purpose | Keep borrowers, their loans and instalment schedules, and remind them of payments automatically, with consent and opt-outs respected. |
| User Flow | An admin turns it on (Settings) → editors add customers (contact details, group, channel consent) → add a loan (amount, instalments, weekly/monthly, first due date), which generates the schedule → the Overview shows overdue and due-this-week instalments → **Mark paid** → the admin sets Reminder rules (days before, due day, overdue repeat, channel, templates) → reminders are created automatically → editors can also send a message to a group or chosen customers → everything appears in the Message log. |
| Inputs | Customer: name, mobile, email, group, consent per channel, notes. Loan: reference, amount, instalments (1–360), frequency, first due date, optional instalment amount. Rules: on/off, days before (1–30), due day, overdue every N days (0 = never), channel, three templates. Message: audience, channel, text with {name} {amount} {due_date} {company}. |
| Outputs | Instalment schedules, an overview with counts and the overdue total, and a message log (logged / sent / skipped with reason / failed). |

**Acceptance Criteria:**
- Off by default for each workspace. Only admins switch it on, change reminder rules or run them manually. Viewers can read. Editors manage customers, loans, payments and messages.
- Monthly schedules keep the day of month and clamp to month end (31 Jan → 28/29 Feb). Weekly schedules step 7 days.
- Paying the last open instalment closes the loan. Un-paying reopens it.
- "Today" is the workspace's time zone. Reminders are checked every 10 minutes and **each reminder is created only once** (unique key per instalment and rule), even across several servers.
- A message is **skipped** (and logged with the reason) when the customer opted out, hasn't consented to that channel, or has no address for it.
- SMS and WhatsApp messages always end with "Reply STOP to opt out." unless the text already mentions STOP.
- Until a provider is connected, the UI states clearly that messages are logged, not delivered.
- All data is scoped to the workspace. Other workspaces get 404.

**Edge Cases:**
- A customer is deleted → their messages stay in the log as "Former customer".
- A group is deleted → its customers stay, without a group.
- More than 500 recipients in one send → refused.

### Feature 13 — Content writing

| Field | Value |
|---|---|
| Status | **Built (31-10-2026)**, verified with a live API key the same day. |
| Purpose | Turn one idea into ready-to-post captions for several networks at once, in the brand's voice. |
| User Flow | Content writing → pick a starter idea (eight loan-officer prompts) or write a brief → choose networks, tone, length (short/medium/long), emoji, hashtags and drafts per network → **Write drafts** → per-network drafts with character checks → **Copy** or **Use in a post** (creates a draft post on that network's channels). "Write your own" checks any text against every network's limit and saves it as a draft post. |

**Acceptance Criteria:**
- Without an AI key the page explains how to enable it and the generator is disabled. The writer and limit checker still work.
- One failing network shows its error without hiding the others' drafts.
- Uses the same per-user AI rate limit as composer drafts.

## 7. Non-Goals

The following are intentionally NOT part of this version:
- Unified social inbox (comments and DMs) and conversation management.
- Real delivery of SMS, WhatsApp or email for loan reminders: messages are logged as "simulated" until providers are chosen and connected (Q11).
- Inbound replies (automatic STOP processing): opt-outs are recorded by staff for now.
- Built-in subscription billing and payments (D3: post-MVP; workspaces are created freely or by invite).
- Real publishing to X, Threads, TikTok, Pinterest and YouTube (D2: planning-only in the MVP).
- Third-party product analytics or tracking scripts (D8).
- Native iOS or Android apps.
- Link shortener and click tracking.
- Push notifications (in-app counts only).
- Video editing, trimming or transcoding (uploads are used as they are, Feature 11).
- The other parity items not chosen for the MVP (D10), e.g. the unified inbox, network analytics, PDF reports, team chat, tasks and targets. See FEATURE_PARITY.md.
- Engagement analytics until Feature 9 is in place.

## 8. MVP Scope

**Must Have:**
- Features 1–7.
- Feature 8 (output metrics and activity log, plus the internal success-metrics report from D8).
- Feature 9 for LinkedIn, Facebook Pages and Instagram (D2).
- Feature 10: email invites and password reset (D5).
- Feature 11: media library and video upload (D10).
- Feature 12: loan reminders (D13).
- Feature 13: content writing page (D13).
- Rate limiting on sign-in, sign-up and AI.
- Spend limit on the AI key.

**Nice to Have:**
- Real publishing to X (needs the paid API tier; client decides on the cost).
- TOTP two-factor sign-in.
- Image upload to object storage.
- Best-time-to-post suggestions.
- Comments on posts.

**Future:**
- Loan reminders: CSV import of customers and loans, provider delivery and inbound STOP handling (see Feature 12).
- Engagement analytics from the networks.
- Publishing to Threads, TikTok, Pinterest and YouTube.
- Unified inbox.
- Billing and plans (Razorpay for INR, chosen when it is scheduled).
- Public API and webhooks.
- Bulk CSV import.
- Mobile apps.

## 9. Success Metrics

**Primary Metrics:**
- **Activation:** % of new workspaces that schedule their first post within 24 hours of sign-up (target ≥ 60%).
- **Reliability:** % of scheduled posts published within 1 minute of their time (target ≥ 99.5%).

**Secondary Metrics:**
- Median time from submission to approval (target < 4 working hours).
- AI draft use rate: % of AI requests where a draft is used (target ≥ 40%).
- Weekly active workspaces.

**How they're measured (D8):** all from Cadence's own database, with no third-party tracking.
- Activation: `workspaces.created_at` compared with the first `post.scheduled`/`post.submitted` row in `activity`.
- Reliability: `published_at − scheduled_at`.
- Approval time: `post.submitted` → `post.approved` in `activity`.
- AI use: `ai.drafts` compared with a new `ai.draft_used` activity event, sent when **Use this** is clicked (**not yet implemented**).

An owner-only internal metrics report is part of Feature 8.

## 10. Constraints

| Field | Value |
|---|---|
| Technical | Node.js 22+, PostgreSQL, server-rendered static SPA with no frontend build step, Claude for AI. Must run as a single deployable service. |
| Business | Budget, pricing and client sponsor are not yet confirmed (Q1). Third-party costs are passed through to the client per the SOP: Render hosting and Postgres, Anthropic API usage, Resend email, and the domain. LinkedIn and Meta API access is free but needs app review. |
| Hosting | Render, Singapore region: a managed Node web service plus managed PostgreSQL with daily backups, on the **client's own Render account** (D4). |
| Design | Must follow DESIGN_SYSTEM.md, be keyboard-accessible, and work at 375 px width without horizontal scrolling. |
| Timeline | SOP "Medium" project: 10 weeks from kickoff, with the Product Demo in week 7 (D12). Feature 11 adds about 8–10 developer-days to Sprint 2. If the Meta or LinkedIn app reviews run late, the fallback is to demo publishing against their test or sandbox apps. Nothing else moves into the MVP without dropping something of equal size. |

## 11. Assumptions

- Teams are small (≤ 25 members per workspace, ≤ 10 brands).
- Users create posts in the browser. No offline mode.
- The workspace time zone is the right zone for every brand's queue.
- Phone-recorded MP4/MOV files are accepted by the MVP networks without transcoding (verify in Sprint 2 with real files).
- English UI only for the MVP.

## 12. Open Questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Who is the client sponsor and named approver? What are the budget and kickoff date? | Dir | PRD sign-off (Day 5) |
| Q9 | Which country (or countries) are the loan officers in? This sets the advertising rules, data-protection law and hosting region; D4's Singapore region assumes India or Asia. | Client | PRD sign-off |
| Q11 | Which SMS, WhatsApp and email providers (and sender IDs or templates) should loan reminders use? In India, SMS needs DLT registration; WhatsApp needs approved message templates. | Client | Before go-live |
| Q10 | What must every post carry, and how long must it be kept? (For example licence or registration IDs, lender disclosures, record-keeping period.) Answers may add an automatic disclosure footer per brand and a retention rule for published posts and their approvals. | Client's compliance team | Day 7 (UX_FLOWS) |

### Decisions (31-10-2026)

No preference was stated for Q2–Q8, so each one takes the **proposed default** below. These are recommendations, not client approvals. They are confirmed or changed at the PRD review Meet, and count as approved only once the PRD sign-off email arrives.

| # | Question | Decision | Why | Changes |
|---|---|---|---|---|
| D2 | Which networks get real publishing? | LinkedIn, then Facebook Pages + Instagram (one Meta app). The rest are planning-only. | No paid API tier needed, and they cover most B2B and B2C use. X needs a paid tier. | F9 scope, Non-goals, DELIVERY (Meta and LinkedIn app reviews start Day 6) |
| D3 | Billing in the MVP? | No, post-MVP | Keeps the 10-week MVP on the core workflow. Avoids gateway KYC on the critical path. | Non-goals, Future |
| D4 | Hosting? | Render, Singapore region, on the client's own account | Managed Node and Postgres, low ops, easy handover, low latency to India | ARCHITECTURE §3, DATABASE §1 |
| D5 | Email for invites and reset? | Yes, through Resend | Removes admins sharing passwords, which is a security improvement. Low cost. | New Feature 10, users gain `email`, SECURITY |
| D6 | Over the character limit: block or warn? | Block Schedule and Queue, allow Save draft | The network would reject it anyway. Failing early beats failing at publish time. | F4 criteria, UX_FLOWS Flow 4 |
| D7 | Approval switched off with posts pending? | They stay pending, and Settings shows the count | Nothing goes out without an explicit decision | F6 edge case, UX_FLOWS Flow 6 |
| D9 | Target market? (**user decision**) | Loan officers, matching the reference product | Chosen by the user, 31-10-2026 | §1–5 personas, problem and goals rewritten |
| D10 | Which parity items join the MVP? (**user decision**) | Video upload + media library only | Chosen by the user, 31-10-2026 | New Feature 11, F4 inputs |
| D11 | Loans CRM in scope? (**user decision**) | Phase 2, after the MVP | Chosen by the user, 31-10-2026 | Non-goals, Future |
| D12 | Timeline? (**user decision**) | Stays at 10 weeks (Medium) | Chosen by the user, 31-10-2026 | Constraints |
| D13 | Loan reminders now, plus a content writing page? (**user decision**) | Yes: Feature 12 (was Phase 2 under D11) and Feature 13 are in this release | Requested by the user, 31-10-2026 | Supersedes D11. **Timeline risk:** D12 (10 weeks) didn't include roughly 20–25 extra developer-days. Confirm budget and timeline at the PRD review. |
| D14 | Which AI does a workspace use? (**user decision**) | Each workspace can pick its own provider and key: Anthropic Claude, Google Gemini, Groq or OpenRouter. Without one, the platform key (ANTHROPIC_API_KEY) is used if set; otherwise AI is off. | Requested by the user, 31-10-2026. Gives free-tier options and keeps AI costs with each workspace. | Feature 5 and 13 use the workspace provider. Setup gains an AI provider section. |
| D15 | Link in bio and tracked links? (**user decision**) | Yes, built now: each brand gets a public link page and the workspace can create short links with UTM tags. Clicks are counted by Cadence. | Requested by the user, 31-10-2026 | New "Link in bio" page (Feature 14). Adds to the D13 timeline risk (about 4–5 developer-days). |
| D16 | Reports and Library pages? (**user decision**) | Yes, built now: a monthly report per brand or for all brands, with a PDF download, and a content library of reusable posts that can be marked pre-approved. | Requested by the user, 31-10-2026 | New Features 15 and 16. Scheduled email reports wait for email delivery (D5). Adds to the D13 timeline risk (about 5–6 developer-days). |
| D17 | Product name? (**user decision**) | The website is called **Nexora** (was Cadence). Visible names are changed: page title, logo, sign-in page, public link pages and report header. Internal names (package, database, file names) stay as they are. Earlier docs still say Cadence and mean the same product. | Requested by the user, 31-10-2026 | Branding only. No behaviour change. |
| D18 | Must a brand have a GSTIN? (**user decision**) | Yes: adding a brand requires a valid GSTIN, checked for format and check character. Brands that already exist (including each workspace's sign-up default brand) keep working without one and can add it later. GSTINs need not be unique, because several officers' brands can share the branch's registration. | Requested by the user, 02-11-2026 | Feature 3. New `brands.gstin` column. |
| D8 | Product analytics tool? | None. Metrics come from Cadence's own database, in an owner-only report. | No tracking scripts, no extra cost, no privacy disclosure needed | §9, Feature 8 |

## 13. Definition of Done

The feature/product is complete when:
- [ ] Requirements are implemented
- [ ] Critical user flows work
- [ ] Tests pass
- [ ] Build succeeds
- [ ] Security requirements are satisfied
- [ ] Documentation is updated


### Feature 5 addendum — AI provider per workspace (D14, built 31-10-2026)

- An admin chooses **Anthropic Claude** (paid), **Google Gemini** (free tier), **Groq** (free tier) or **OpenRouter** (free models available) on the Setup page. They save that provider's API key and optionally a model (empty = the provider's default), and can **Test connection** and **Load models** (OpenRouter's free models are listed first).
- Keys are encrypted at rest, admin-only, and never returned. Every provider request is made by the server.
- Order of use: the workspace's selected provider → the platform key (`ANTHROPIC_API_KEY`) → AI off, with a message pointing admins to Setup.
- All providers return the same draft format, and errors are explained plainly (key rejected, unknown model, rate limit, declined brief).
- **Not verified with live keys yet:** request shapes are covered by tests with stubbed provider responses. Run Test connection with a real key for each provider before relying on it.

- **Update (31-10-2026): no model field.** The model is chosen automatically. On Save or Test, Cadence lists the key's models, skips non-text ones (image, speech, embedding, moderation), ranks the rest (newest general-purpose first, free models first on OpenRouter), and pings up to 4 until one answers. A rejected key or a rate limit stops at once. If a saved model is later retired, drafting re-detects, saves the new model and retries once.

### Feature 14 — Link in bio & tracked links (D15, built 31-10-2026)

- **Link-in-bio page per brand** at `/b/<address>`: title, short bio, accent colour, up to 20 link buttons (reorderable) and, optionally, a grid of the brand's latest published posts. Editors and above can change it; viewers see it read-only.
- **Tracked links**: short links `/l/<code>` that redirect to a destination with `utm_source`, `utm_medium` and `utm_campaign` added, so the brand's own website analytics can see where visitors came from.
- **Clicks**: every bio button and short link goes through a Cadence redirect that records the click. The page shows a 30-day daily chart, the total, clicks per bio button, and all-time / 7-day clicks per short link.
- **Privacy**: no IP address, cookie or user agent is stored, only the time and the referring site's host name. Bots, link previews and HEAD requests are not counted.
- **Not included**: custom domains, QR code download, per-country or per-device breakdowns.

### Feature 15 — Monthly reports (D16, built 31-10-2026)

- **Reports** page: pick a month (‹ › or a month picker; future months are blocked) and **this brand** or **all brands**. Month boundaries follow the workspace time zone.
- Tiles, each compared with the month before: posts published, posts created, link clicks, approvals, AI writing requests and, when loan reminders are on, reminders sent.
- Published-per-day chart, published by network, highlights (busiest day, most active weekday, sent back, failed, media uploaded, scheduled ahead), team table (created and published per writer), per-brand bars for all brands, and the list of published posts (latest 50).
- **Download PDF** uses the browser's print to PDF with a print layout (no sidebar or buttons). No PDF library was added.
- Approvals, AI requests and media are workspace-wide, because the activity log has no brand. The page says so.
- **Not included:** scheduled email reports (needs email delivery, D5) and engagement figures such as reach and likes (need network connections, Feature 9).

### Feature 16 — Content library (D16, built 31-10-2026)

- **Library** page: reusable posts with a title, text, category (Educational, Promotional, Seasonal, Testimonial, Market update, Event, Other), up to 10 tags, optional media from the media library, and scope (all brands or one brand).
- Search across title, text and tags. Filter by category and "pre-approved only". Items are sorted pre-approved first, then by how often they were used.
- **Use** creates a draft post for the current brand with the item's text, media and all the brand's channels, then opens it in the editor. Each use is counted.
- **Save to library** in the post editor stores the current text and first media file as a new item.
- **Pre-approved**: only users who can approve posts can set or remove it. If an editor without approval rights changes the text or media, the mark is removed. Using a pre-approved item does not skip post approval.
- Viewers can browse but not add, edit, delete or use items.
