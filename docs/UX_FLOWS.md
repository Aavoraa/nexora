# UX_FLOWS — Cadence

Main journey: **Sign-up → Calendar (empty) → Brands & channels (add a channel) → New post → AI draft → Schedule / Queue → (Approval) → Published → Analytics.**

States follow DESIGN_SYSTEM §12. "Toast" means the bottom-centre message.

## Flow 1 — Create workspace

1. The user opens the app and picks **Create workspace**.
2. They enter the workspace name, their name, username and password.
3. The browser sends its time zone automatically.
4. The server validates the input and creates the workspace, owner, default brand and default queue in one transaction.
5. The user is signed in and lands on the Calendar.

| Field | Behaviour |
|---|---|
| Success | Calendar for the current month, with the default brand selected. |
| Failure | Inline red message under the form (e.g. "That username is taken"). The fields keep their values. |
| Loading | The submit button is disabled while the request runs. |

## Flow 2 — Sign in / sign out

The sign-in page has three parts: a product hero with six feature tiles, an auto-playing six-step walkthrough (pause/play, clickable steps; hidden below 1280px) and the sign-in card (shown first on phones).

1. Enter the username and password (the eye button shows or hides the password). "Keep me logged in" is on by default. Then **Log in**.
2. The user returns to the page they asked for (hash kept), or the Calendar.
3. **Sign out** (sidebar) ends the session and shows the sign-in screen.

| Field | Behaviour |
|---|---|
| Failure | "Wrong username or password", and the card shakes. An empty field shows "Enter your username/password". After 10 attempts in 15 minutes: "Too many sign-in attempts…" (429). |
| Forgot password | Shows a note: reset by email isn't available yet (PRD Feature 10). Ask the workspace owner or the Cadence administrator. |
| Session expired | Any API call returns 401 and the sign-in screen appears. |

## Flow 3a — Add a brand

1. Admin → **Brands & channels** → **+ Add brand**.
2. The dialog asks for the brand name and GSTIN (both required), colour, voice (optional) and a first channel (optional: network + handle). The GSTIN can be typed in lower case or with spaces; it is saved in upper case.
3. **Add brand** creates the brand with a weekday 10:00 queue, makes it the selected brand and shows "<name> added".

| Field | Behaviour |
|---|---|
| Loading | The **Add brand** button is disabled while saving. |
| Error | Shown inside the dialog ("Brand name is required", "GSTIN is required", "Enter a valid 15-character GSTIN", "Account handle is required", "Unknown platform"); nothing is created. |
| Older brands | A brand made before GSTINs were required shows "GSTIN (not added yet)" on its card. Saving with the field blank keeps it blank; once added it can be corrected but not removed. |
| Cancel | ✕, Cancel or Esc closes the dialog with no changes. |
| Non-admin | No **+ Add brand** button. |
| Delete | **Delete brand** (shown only when there is more than one brand) opens a dialog listing what goes with it: posts, channels, queue slots, link-in-bio page and clicks, and brand-only library items. Short links and all-brand library items stay. **Delete brand** stays disabled until the brand name is typed exactly. Success → "<name> deleted". |

## Flow 3 — Add a channel

1. Admin → **Brands & channels**.
2. Pick the network, type the handle, then **Add channel**.
3. The chip appears under the brand.

| Field | Behaviour |
|---|---|
| Empty | "No channels yet." The composer links here when a brand has none. |
| Error | Toast (e.g. "Account handle is required"). |
| Non-admin | Read-only view with no add or remove controls. |

## Flow 4 — Write and schedule a post

1. **+ New post** (or click a calendar day, which preselects that day at 10:00).
2. All the brand's channels start selected. Untick any that aren't wanted.
3. Write the text. Per-network counters update live, and any network over its limit is shown in red.
4. Optionally add an image URL. The preview updates.
5. Choose an action:
   - **Save draft:** the toast says "Draft saved" and the URL changes to `#/compose/:id`.
   - **Add to queue:** goes into the next free slot. The toast gives the time.
   - **Schedule for this time:** uses the date and time picker.

| Field | Behaviour |
|---|---|
| Loading | The clicked button is disabled until the request finishes. |
| Error | Toast with the server message ("Write something before scheduling", "Pick at least one channel", "That time is in the past", "The queue is full…"). The editor content is kept. |
| Approval on, non-approver | The toast says "Sent for approval · <time>". The status badge shows **Awaiting approval**. |

## Flow 5 — AI drafts

1. In the composer, open the **✨ AI drafts** panel and enter a brief.
2. Choose the network (only the brand's networks are listed), tone and count.
3. **Write drafts.** The button reads "Writing…" and is disabled.
4. The drafts appear as cards with character counts. **Use this** puts a draft in the editor and focuses it.

| Field | Behaviour |
|---|---|
| Not configured | The panel explains that `ANTHROPIC_API_KEY` must be set. No form is shown. |
| Error | Toast ("The AI declined this brief. Try rephrasing it.", "AI is busy…"). The brief is kept. |
| Empty brief | "Describe what the post should be about". |

## Flow 6 — Approve or send back

1. The approver sees the count badge on **Posts**, opens Posts, and filters to **Awaiting approval**.
2. They open a post and the note says "Awaiting approval for <time>".
3. **Approve:** the post becomes Scheduled and the approver is recorded. Or **Send back:** a prompt asks for an optional note, then the post becomes Draft.
4. The author opens the post and sees "Reviewer note: …".

| Field | Behaviour |
|---|---|
| Error | "The scheduled time has passed — reschedule it first". |
| Non-approver | No Approve or Send back buttons. The API returns 403 if called directly. |

## Flow 7 — Manage the queue

1. **Queue** shows the brand's weekly slots in the workspace time zone, plus the posts coming up.
2. Add a slot (day + time), or **Add to every weekday**. Remove a slot with ×.

| Field | Behaviour |
|---|---|
| Empty upcoming | "Nothing scheduled." |
| Viewer | Read-only. |

## Flow 8 — Team

1. Admin → **Team** → fill in "Add a team member" (temporary password ≥ 8 characters), then **Add member**.
2. Change a role or the "Can approve" flag inline. The toast confirms each change.
3. **Remove** asks for confirmation.

| Field | Behaviour |
|---|---|
| Error | Toast ("That username is taken", "Only the owner can add admins"). |

## Flow 9 — Publish (system)

1. The publisher checks for due posts every 15 seconds.
2. Each due post is sent to each of its channels.
3. The post becomes Published (or Failed with the reason), and an activity entry is written.

| Field | Behaviour |
|---|---|
| Failure | The post shows a **Failed** badge and the note "Publishing failed: <reason>". Editing it moves it back to Draft. |

## Decided UX rules (PRD D6, D7) — not yet implemented

- **Over the limit (D6):** in Flow 4, Schedule and Queue are refused with "Too long for <network> (n/limit)". Save draft still works.
- **Instagram without an image (D2):** in Flow 4, Schedule and Queue are refused with "Instagram posts need an image".
- **Approval switched off with posts pending (D7):** in Settings, the toggle shows "N posts are still awaiting approval. They stay pending until approved." Nothing is approved automatically.

## Flow 10 — Invite by email (PRD Feature 10, not built)

1. Admin → Team → enters an email and role → **Send invite**. The toast says "Invite sent to <email>".
2. The invitee opens the link → sets name, username and password → is signed in to the workspace.

| Field | Behaviour |
|---|---|
| Expired or used link | "This invite has expired. Ask your admin for a new one." |
| Email not sent | The admin sees "Email not sent — copy link instead" with a copy button. |

## Flow 12 — Upload a video and post it (PRD Feature 11, built)

1. Composer → **Add media** (or the **Media** page) → drag a file in or pick one from the phone.
2. A progress bar shows the upload. The item then shows "Checking…" while the server reads its details.
3. The item appears with a thumbnail, duration and readiness tags (e.g. "9:16 ✓ Reels · TikTok · Shorts", "YouTube: vertical").
4. **Use** attaches it to the post. The preview plays the video.
5. Write the caption (AI drafts can use the video's title) → schedule as usual.

| Field | Behaviour |
|---|---|
| Loading | Per-file progress bar. The composer stays usable during the upload. |
| Empty | Media page: "No media yet. Drop a video or image here." |
| Error | "Only MP4 or MOV videos", "Videos can be up to 500 MB", "Upload interrupted — retry". |
| Format warning | Amber tag on the networks whose format doesn't fit. Scheduling is still allowed. |

## Flow 11 — Reset password (PRD Feature 10, not built)

1. Sign-in → **Forgot password?** → enter an email → always "If that email has an account, a reset link is on its way."
2. The link opens "Set a new password" → submit → signed in, and other sessions end.

## Flow 13 — Home dashboard (built)

1. After signing in the user lands on **Home** (`#/home`).
2. The stat cards show what was created and published in the chosen range (7, 30 or 90 days), plus what is waiting for approval and what is scheduled now.
3. The pipeline board shows the brand's posts by stage. **Approve** (approvers only) schedules a pending post on the spot. **Open** or clicking a card opens the composer.
4. **Export** downloads a CSV of the brand's posts that were created, scheduled or published in the range.

| Field | Behaviour |
|---|---|
| Empty column | Dashed placeholder naming the next step |
| Overdue | Red "Overdue by …" on pending or scheduled posts past their time. Approve is hidden until the post is rescheduled. |
| Error | Toast. The board stays as it was. |

## Flow 14 — Search and notifications (built)

1. **Ctrl/⌘ K**, **/** or the top-bar search opens the palette. Typing filters the pages and matches post text across all brands. Enter opens the selected item.
2. The **bell** shows how many posts are awaiting approval. Its menu lists failed posts and pending posts with links. "View all posts" opens Posts.


## Flow 15 — Loan reminders (built)

1. An admin turns on **Loan reminders** in Settings (or with the button on the page). "Loan reminders" appears in the sidebar.
2. **+ Customer** → dialog (name, mobile, email, group, consent per channel, notes) → the customer's page opens.
3. **Add a loan** → the schedule is generated. **Mark paid** on each instalment, and the loan closes when all are paid.
4. **Overview:** counts, the reminder and channel status banner, overdue and due-this-week instalments with **✓ Paid**, and recent messages.
5. **Reminder rules** (admin): on/off, days before, due day, overdue repeat, channel, three templates. **Run now** creates any due reminders immediately.
6. **Send message:** a group or chosen customers, channel, text with placeholders and a live phone preview. **Message log** shows every message with its status and the reason for any skip.

| Field | Behaviour |
|---|---|
| Module off | The page explains it. Admins see "Turn on loan reminders". |
| Opted out | Shown on the customer and in lists. Excluded from selection, and any message to them is skipped. |
| Not delivered | Banner and log state "Logged (not delivered)" while no provider is connected. |

## Flow 16 — Content writing (built)

1. **Content writing** → pick an idea or write a brief → networks, tone, length, emoji, hashtags, drafts per network → **Write drafts**.
2. Each network gets its drafts with a character check. **Copy**, or **Use in a post** opens the composer with a draft on that network's channels.
3. **Write your own** checks any caption against the chosen networks' limits and saves it as a draft post.

| Field | Behaviour |
|---|---|
| No AI key | Note explaining how to enable it. Generator disabled. The writer and checker still work. |
| Loading | "Writing drafts for each network…" with an animated icon |
| One network fails | That card shows the error; the others show their drafts. |


## Flow 17 — Setup: save an app's details (built)

1. Account → **Setup**. There are cards for 8 social networks and 3 messaging channels, each with a status, what it supports, and Add details / Connect / Guide.
2. **Guide** shows the setup steps and a link to the network's official developer site (opens in a new tab).
3. **Add details** (admins) asks for the app's ID and secret (or provider, API key and sender for messaging). Saving shows "Details saved (…last4) by NAME on DATE".
4. **Connect** explains that connecting isn't available yet, and why.

| Field | Behaviour |
|---|---|
| Not an admin | Add details and Connect are disabled. Guide still works. |
| Editing | Secret fields are empty, with "Saved: leave blank to keep". "Remove the saved details instead" deletes them. |
| No encryption key | A banner says TOKEN_ENCRYPTION_KEY is needed, and saving returns that message. |


## Flow 18 — Choose the workspace's AI provider (built)

1. Setup → **AI provider for your workspace**. The status line reads "Using {provider} with your workspace's key", "Using the platform's AI for now" or "AI is off".
2. Pick a provider card (badge Paid / Free tier / Free models). The key placeholder, **Get a key ↗** link and default model follow the choice.
3. Paste the API key. Optionally **Load models** and pick one (free ones are marked and listed first). Otherwise leave the model empty for the default.
4. **Test connection** shows "✓ Connected · model · 1.2 s" or the reason it failed.
5. **Save AI settings** selects the provider for the whole workspace. **Stop using a workspace provider** or **Remove key** undo it.

| Field | Behaviour |
|---|---|
| Not an admin | The section is read-only with a note |
| No key | Test, Save and Load models say "No API key provided." |
| AI off | The composer and Content writing show "AI is off … choose an AI provider in Setup" (linked for admins) |

**Update (31-10-2026):** steps 3–4 no longer ask for a model. Paste the key → **Test connection** ("✓ Connected · gemini-3.0-flash · 1.1 s") or **Save & connect** ("Connected to Google Gemini · gemini-3.0-flash"). While it runs: "Checking your key and finding a model…". After saving, the info panel shows "Model is chosen automatically: <model>".

## Flow 19 — Link in bio & tracked links (built)

1. Sidebar → **Link in bio**. The page address is pre-filled from the brand name.
2. Add a title, short bio, accent colour and link buttons (**+ Add link**, ↑/↓ to reorder, ✕ to remove). A bare address like `example.com/menu` gets `https://` added. The phone preview updates as you type.
3. **Save page** → the status shows **Live** with the public address, **Copy** and an open link.
4. **Tracked links**: enter a destination plus optional label and UTM source, medium and campaign → **Create link**. The short link is copied to the clipboard and listed with its clicks (total and this week).
5. The **Clicks (30 days)** chart and per-button bars update as people use the page and links.
6. Errors are shown as a toast: address taken or reserved, a button without text, or a destination that isn't a web address.

## Flow 20 — Reuse a post from the library (built)

1. Sidebar → **Library**. Search, choose a category, or tick **Pre-approved only**.
2. **Use** on a card → a draft for the current brand opens in the post editor with the text and media filled in. Schedule it as usual.
3. To add: **Add to library** (page button) or **Save to library** in the post editor → title, category, scope, tags, optional media → save.
4. Approvers see **Approve** / **Unapprove** on each card. Editors see **Edit** and **Delete** (with a confirmation).
5. Empty states: "Your library is empty…" or "Nothing matches these filters." Errors appear in the dialog (missing title or text).

## Flow 21 — Monthly report (built)

1. Sidebar → **Reports**. It opens on this month (marked "so far") for the current brand.
2. Switch **brand / All brands** and move between months with ‹ › or the month picker. Next is disabled on the current month.
3. **Download PDF** → the browser's print dialog with a clean print layout → "Save as PDF".
4. Months with no activity show zeros and "Nothing was published this month."
