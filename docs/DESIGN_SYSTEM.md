# DESIGN_SYSTEM — Cadence

Source of truth for the visual language. The tokens live in [public/css/app.css](../public/css/app.css) `:root`. Change them there and here together.

**Version 3 (31-10-2026):** a three-colour palette (indigo · violet · amber), a top bar plus a dark sidebar, and a Home dashboard. Light theme only.

> **Originality rule:** Cadence's look is its own. Don't copy the reference product's logo, brand colours, wording or assets (see FEATURE_PARITY.md). Generic layout patterns (top bar, sidebar, stat cards, boards) are fine.

## 1. Design Direction

| Field | Value |
|---|---|
| Style | Calm, confident, editorial. Bold headings, generous white space, a deep-indigo frame. |
| Mood | Trustworthy enough for compliance teams, lively enough to make posting feel like progress |

**Design Principles:**
- **Three colours, used with intent:** indigo frames and anchors, violet is for action, amber is for attention. Everything else is neutral.
- **Red means a problem**, and only that: errors and failed posts.
- **Colour is never the only signal:** every status has a text label.
- **Every interactive element responds** (hover lift or tint, press scale). All motion stops under `prefers-reduced-motion`.

## 2. Brand

| Field | Value |
|---|---|
| Brand Name | Cadence |
| Logo | Rounded square with a violet → indigo gradient and an **amber** wave stroke (`logo()` in app.js, favicon). Each instance gets its own gradient id. Minimum 20 px. |
| Brand Voice | Plain, short, encouraging. Sentence case. Errors say what happened and what to do next. |

## 3. Color Palette — "Clean & calm" (Nexora, 31-10-2026)

Chosen by the user from the Nexora redesign canvas. It replaces the earlier indigo / violet / amber palette. Token **names** are unchanged so existing rules keep working: `--violet` now holds teal and `--amber` holds coral.

| Role | Token | Hex | Used for |
|---|---|---|---|
| **Navy** (text, frame) | `--ink` | #13213C | Headings, body text, avatar, published status |
| Navy 2 | `--ink-2` | #1E2F52 | Hover on dark surfaces |
| **Teal** (action) | `--violet` | #0B7A75 | Primary buttons (hover #075C58), links, active nav item, scheduled status, focus ring |
| Teal light | `--violet-2` | #14958E | Secondary chart series |
| **Coral** (attention) | `--amber` | #E8664F | Awaiting approval, alert dots and counts, eyebrow markers, logo dot. Large or decorative use only: it is not dark enough for small text on white |
| Coral ink | `--coral-ink` | #B2412D | Coral-coloured small text (counts on soft coral) |
| Text on coral | `--amber-ink` | #2B0F08 | Text placed on solid coral |
| Error | `--danger` | #DC2626 | Errors and failed posts only |

**Neutrals:** background #F6F8FB · surface #FFFFFF · surface 2 #EEF1F5 · border #E3E7EE · muted text #5B6478 · soft teal #E6F4F3 · soft coral #FDEDEA.

**No gradients:** `--grad` and `--grad-cool` are now flat teal, kept only as names for older rules.

**Status colours:** draft grey #8A93A6 · pending coral · scheduled teal · published navy · failed red.

**Legacy tokens:** `--pink`, `--orange`, `--teal`, `--sky`, `--green`, `--rose` stay aliases onto the palette. Don't introduce new hues.

**Fonts:** Manrope (600–800) for headings, the logo and page titles. Inter (400–700) for everything else. Both load from Google Fonts in `index.html`, with system fonts as the fallback. The public link-in-bio page still uses system fonts only, so it loads nothing from outside.

**Sidebar:** light (white, with a border on the right). The active item is soft teal with teal text. Counts are grey chips, or soft coral for items that need attention.

**Logo:** a teal rounded tile with a white "N" and a coral dot (`logo()` in `app.js`, and the favicon).

**Reference designs:** the canvas "Nexora website redesign" (home, sign-in, phone home, calendar, library).

**Theme:** light only (`color-scheme: light`). No dark theme and no theme switch. Don't add `prefers-color-scheme: dark` styles.

## 4. Typography

| Field | Value |
|---|---|
| Font Family | System UI stack (no web fonts) |
| H1 (page title) | 34px / 900 / −0.035em, indigo (26px on mobile) |
| Eyebrow | 12px / 800, uppercase, +0.22em, violet, with an amber square marker |
| H2 / column titles | 13–15px / 700–800, uppercase for board and stat labels |
| Stat number | 40px / 900, indigo |
| Body | 14px / 1.5 · Small 12px |

## 5. Spacing

Base unit 4px. Scale 4 / 8 / 12 / 16 / 20 / 24 / 32. Cards use 20–22px padding. Main area 30×36px (18×16px on mobile).

## 6. Border Radius

Small 8px · Medium 10–12px (buttons, inputs, nav items) · Large 16px (cards) and 20px (stat cards, board columns) · Pill 99px.

## 7. Shadows

`--shadow` (indigo-tinted, soft) on cards. `--shadow-lift` on hover, dropdowns, the search palette and toasts. The active sidebar item gets a dark drop shadow.

## 8. Buttons

| Field | Rule |
|---|---|
| Primary | Violet gradient, white text, violet glow. One per area. |
| Secondary | White with a border. Hover tints the border violet. |
| Approve (board) | Indigo fill. Hover turns violet. |
| Danger | Red text, always confirmed |
| Icon button | 42×42 square (bell, menu, search on mobile) |
| Press / Disabled / Loading | Scale 0.96 · opacity 0.55 · disabled while working |

## 9. Inputs

White fill, 1.5px border, 10px radius. Focus: violet border with a 4px soft violet ring. The search bar in the top bar is a button that opens the palette.

## 10. Cards

`.card`: white, 1px border, 16px radius, `--shadow`; lifts on hover when clickable. **Stat card:** an icon circle tinted with its colour, a comparison with the previous period on the top right, a big number, an uppercase label and a sparkline. **Board card:** a 4px left edge in its status colour, an optional media thumbnail, two lines of text, status and author, the due date, an overdue alert (red) and actions.

## 11. Navigation

| Field | Rule |
|---|---|
| Top bar | 64px, white, sticky. Logo · search (Ctrl K) · New post · bell with an amber count · user menu (initials avatar, name, role, dropdown with Settings / Team / Sign out) · Log out. |
| Sidebar | Indigo, 252px, sticky under the top bar. A brand switcher, then the **Workspace** section (Home, Calendar, Posts, Queue, Media, Analytics) and the **Account** section (Brands & channels, Team, Settings). Section labels have amber markers. Active item: white pill, indigo text, violet icon. Counts: Calendar = upcoming scheduled, Posts = awaiting approval (amber). Footer: keyboard hints. |
| Mobile (≤ 860px) | The sidebar becomes a drawer (☰) under the top bar. The top bar collapses to icons. |

## 12. States

| Field | Rule |
|---|---|
| Loading | "Loading…" at boot. Buttons disable while working. Upload rows show progress. |
| Empty | Dashed placeholder (board) or an `.empty` card naming the next step |
| Error | Red toast with ⚠️. Form errors inline. Overdue and failed posts get a red alert on the board. |
| Success | Indigo toast with an amber ✓. Schedule, queue and approve fire confetti (violet, amber, indigo). |

## 13. Icons

Line icons drawn inline (24px grid, 1.8px stroke, round caps, `currentColor`) in the shell, dashboard and top bar. Emoji appear only as decorative accents inside content (sign-in feature tiles, empty states). Icons are `aria-hidden`; the label carries the meaning.

## 14. Interaction & Motion

| Interaction | Behaviour |
|---|---|
| Search | **Ctrl/⌘ K** or **/** opens the palette: pages, a New post action, and post text matches. ↑↓ moves, Enter opens, Esc closes. |
| Notifications | Bell dropdown: failed posts and posts awaiting approval (workspace-wide), with links to each |
| Home | Range switch (7 / 30 / 90 days), CSV export, Approve straight from the board, hero illustration gently floating, stat numbers counting up |
| Calendar | Click a day to draft. Drag a scheduled or failed post to another day. Approvers can't drag pending posts. |
| Keyboard | **N** new post. All controls are native and focusable. |
| Reduced motion | All animation off. Numbers and charts show their final values. |

## 15. Responsive Design

Desktop > 1280px: four stat cards and four board columns. 861–1280px: two of each, hero art hidden, user menu shows only the avatar. ≤ 860px: single column, drawer nav, icon-only top bar. No horizontal page scroll at 375px.

## 16. Accessibility

Semantic HTML. Text meets WCAG AA (amber always carries dark amber-ink text). Visible focus rings. Labelled icon buttons. Dropdowns close on Esc and outside click. `role="status"` toasts. Reduced motion respected.

## 17. Sign-in page

Three columns (≥ 1280px): a hero with six feature tiles, a six-step animated walkthrough (pause/play, clickable steps), and the sign-in card (icon fields, show/hide password, Keep me logged in, Forgot password note, Log in →). It uses the same three-colour palette. The walkthrough is hidden below 1280px; below 820px it is a single column with the card first. Feature copy describes only features that exist.

## 18. Home dashboard

The default page after sign-in (`#/home`).
- **Header:** the eyebrow "Dashboard", the title "Home", a subtitle naming the brand, an original floating illustration (calendar card, play tile, amber check) and the actions: date range, Export (CSV), Upload media.
- **Stat cards:** Created (vs previous period) · Awaiting approval (current) · Scheduled ahead (current) · Published (vs previous period). Each has a daily sparkline over the range.
- **Pipeline board:** Drafts & failed · Awaiting approval · Scheduled · Published (in range). Up to 6 cards per column, with "View all". Overdue = a pending or scheduled post more than 2 minutes past its time.

## 19. Page layout: two-column ("dual box") view

Content pages show their panels side by side in **two equal columns** (`.two-col`), not one long stack. Each column holds a card or a stack of cards.

| Page | Left | Right |
|---|---|---|
| Home | Stat cards (4 across) and the pipeline board (4 columns), its own grid | |
| Queue | Weekly posting schedule (one row per day, slot chips, add-slot controls) | "Coming up" list (scrolls within the panel) |
| Posts | Post cards in a two-column grid (`.list.two`) under the filters | |
| Analytics | Published per week · Published by network | Posts by status · Most active writers (status tiles span the full width above) |
| Brands & channels | Brand cards, two per row | |
| Team | Members table | Add a team member form · Roles explainer |
| Composer, Settings | Already two columns (`.grid-2`) | |
| Calendar, Media | Full width (month grid, media grid) | |

At ≤ 1100px every two-column layout stacks into one column. Queue slots are all violet: per-weekday colours were removed under the three-colour rule.

## 20. Calendar page

- **Header:** the eyebrow "Planning", the title "Content calendar", a subtitle naming the month and brand, an original floating illustration (violet calendar card, image tile, bar chart, amber toggle) and the actions: New post, Upload media.
- **Stat chips:** Past due (red; pending or scheduled posts more than 2 minutes past their time, all dates) · Awaiting approval (amber) · Scheduled (violet) · Published (indigo). The last three count the month on screen. The numbers count up.
- **Toolbar:** ‹ month › · Today · **Grid / List** switch (remembered per browser in `cadence.calView`).
- **Grid:** the month grid (weeks start Monday) with drag-to-reschedule and click-a-day-to-draft. **List:** the month's posts grouped by day, each row showing time, text, networks and status.
- **Publishing status** panel (right, sticky; it moves below the calendar at ≤ 1200px), in four sections: Needs attention (failed and past due) · Next up (with "In 2d 1h") · Awaiting approval · Recently published. When there's nothing to show: "Nothing publishing right now."
- Bulk upload isn't offered until CSV import is built (FEATURE_PARITY item 8).


## 21. Loan reminders and Content writing pages

- **Loan reminders:** eyebrow "Customers". Header actions: + Customer, Send message (primary). A tab bar (`.seg-toggle.ln-tabs`): Overview · Customers · Groups · Send message · Reminder rules · Message log. The Overview uses stat chips (overdue in red), a status banner (left edge amber when off, violet when on) with "not set up" pills, then two columns: due list (left edge violet, amber today, red overdue) | recent messages. Customer page: two columns, profile and messages | loans with a progress bar and instalment rows. Forms open in a native `<dialog>` (`openDialog`). The Send preview is an indigo chat bubble.
- **Content writing:** eyebrow "Create". Two columns: brief (starter chips, networks as pill toggles, tone and length switch, emoji and hashtag checkboxes) | results (one card per network, AI drafts with per-network limit chips, Copy / Use in a post) plus "Write your own".
- Both pages use only the three-colour palette. Red appears only for overdue, opted out and errors.


## 22. Setup page

Eyebrow "Account". A violet-edged info banner, then **Social networks** and **Messaging channels** sections with three-column card grids (two at ≤ 1280px, one at ≤ 860px). Each card:
- A 52px icon tile: white, or indigo with an amber glyph once details are saved.
- Name, and what it supports.
- Status pills: "Not connected" or "Details saved" (violet), plus "Not available yet" (amber).
- An info line.
- Three equal buttons: Add/Edit details, Connect (primary), Guide.

Networks and WhatsApp show their **official logos** (see §23). SMS and Email use line icons.


## 23. Network logos

- **Where:** the Setup cards, the sign-in walkthrough hub, channel chips (Posts, Brands), composer channel options and Content writing network toggles all show each network's **official logo** in its brand colour (`netLogo()` in app.js).
- **Source:** the marks come from **simple-icons** (CC0-1.0), generated into `public/js/brand-icons.js` by `npm run icons` (`scripts/build-brand-icons.js`). Regenerate after upgrading the package; don't edit the output by hand.
- **Rules:** they're the networks' trademarks, used only to identify the network. Show them unaltered: no recolouring, no stretching, no effects. They're the one exception to the three-colour rule.
- **LinkedIn** isn't in simple-icons (removed at LinkedIn's request), so it shows an "in" text badge in LinkedIn blue (#0A66C2). For production, download the official asset from LinkedIn's brand site and follow its guidelines.
- **Selected state:** a violet selected channel pill puts a small white backing behind the logo so dark marks (X, Threads, TikTok) stay visible.
- **Cadence's own logo is unchanged.** Never use another company's product logo (e.g. the reference product's) as Cadence's.


## 24. AI provider section (Setup)

A card at the top of Setup:
- Sparkle line-icon title and an explanation.
- A **status strip**: indigo with an amber provider name when a workspace provider is active, violet-soft for the platform AI, amber-soft when AI is off.
- Four **radio cards** (role="radio"): name, badge (Paid neutral, Free tier / Free models violet), description, key status. The selected card has a violet border, a soft violet fill and a ring.
- Then two columns: API key (password field, prefix placeholder, Get a key ↗) | Model (text with datalist, Load models), with Test connection plus an inline result (violet ✓ or red ✕), and Save AI settings (primary).

**Update (31-10-2026):** the Model field and Load models were removed. In their place is an info panel ("Model is chosen automatically…", sparkle icon, surface 2), and the primary button reads **Save & connect**.

## 25. Link in bio page

- Two columns: the page form on the left; the clicks chart and a phone preview on the right. The tracked-links card spans the full width below. At 860px and under, everything stacks in one column.
- The clicks chart uses violet bars only (amber on hover), following the three-colour rule. The phone preview uses the brand's chosen accent, because it previews the public page, not the app.
- The public page (`/b/…`) is a single centred column: initial avatar, title, bio, full-width buttons, and an optional posts grid. It has no scripts and no outside fonts.

## 26. Library and Reports pages

- **Library:** a filter panel on the left (sticky on desktop) and a card grid on the right (auto-fill, min 280px). Cards show a category pill, a violet "✓ Pre-approved" badge, optional media, the title, a 5-line text clamp, tags and a footer of actions with **Use** as the primary button. The selected category is solid violet.
- **Reports:** a row of KPI tiles with month-over-month change (▲ violet for up, ▼ amber ink for down, grey for no change). Two-column cards follow, then a full-width posts table. Controls sit in the page head: a brand/all segmented toggle, a month stepper and **Download PDF**.
- **Print:** `@media print` hides the top bar, sidebar, controls and hero art. It shows a one-line report header, flattens card shadows to borders, keeps cards from splitting across pages, and keeps chart colours.
