# Cadence

Plan, write, approve and schedule social posts as a team.

**This project follows the Product Build & Delivery SOP.** The documents in [docs/](docs/) are the source of truth. Start with [PRD.md](docs/PRD.md), and see [DELIVERY.md](docs/DELIVERY.md) for the current phase and gates. Agents: read [AGENTS.md](AGENTS.md).

| Command | Purpose |
|---|---|
| `npm start` / `npm run dev` | Run the app (dev restarts on changes) |
| `npm test` | Unit tests, plus integration tests when `TEST_DATABASE_URL` is set |
| `npm run lint` | ESLint |
| `npm run check` | Syntax-check every file (the "build") |
| `npm run seed` | Create or reset the "Demo Agency" demo workspace (needs `SEED_PASSWORD` in `.env`) |

- **Calendar & posts:** a month view of everything planned and published, plus filtered lists (drafts, awaiting approval, scheduled, published, failed).
- **Composer:** pick channels, see per-network character limits and a live preview, then save, schedule for a time, or add to the queue.
- **AI drafts:** Claude writes several distinct drafts from a short brief, using the brand's voice and the target network's conventions.
- **Queue:** a weekly posting schedule per brand. "Add to queue" takes the next free slot.
- **Approvals:** you can switch on a rule that sends posts from non-approvers to an approver before they're scheduled.
- **Brands & channels:** several brands per workspace, each with its own colour, voice, channels and queue.
- **Team:** owner, admin, editor and viewer roles, plus a per-person "can approve" flag.
- **Analytics & activity:** post counts by status, network, week and author, and an audit log.

The publisher runs inside the server every 15 seconds and publishes due posts. Network integrations are adapters in [server/publisher.js](server/publisher.js). Until one is written for a platform, publishing is **simulated**: the post is marked published and logged, but nothing reaches the network.

## Stack

Node.js 22+ and Express, PostgreSQL through `pg`, a dependency-free vanilla-JS SPA in `public/`, and Claude (through `@anthropic-ai/sdk`) for drafting.

## Setup

1. Copy the example env file and fill in your Postgres password (and an Anthropic API key, if you want AI drafts):

   ```bash
   cp .env.example .env
   ```

2. Install dependencies and start:

   ```bash
   npm install
   npm start
   ```

   On first run the server creates the database named in `DATABASE_URL` if it doesn't exist, and then creates the tables.

3. Open http://localhost:3000 and choose **Create workspace**.

Use `npm run dev` to restart automatically when files change.

## Layout

```
server/
  index.js      startup: migrate, listen, publisher
  app.js        Express app (headers, /api, static files)
  ratelimit.js  sign-in / sign-up / AI rate limits
  db.js         Postgres pool, schema/migration, helpers
  auth.js       scrypt password hashing, cookie sessions, role guards
  api.js        all /api routes
  ai.js         Claude draft generation (structured JSON output)
  publisher.js  due-post publisher + per-platform adapter hook
  time.js       time-zone-aware queue slot calculation
  platforms.js  networks, character limits, media format guidance
  media.js      media library (uploads, checks, attach, cleanup)
  storage.js    signed-URL storage driver (local disk for now)
  mediainfo.js  reads video/image type, size, duration, rotation
public/
  index.html, css/app.css, js/app.js
```

## Security notes

- Sessions are random 256-bit tokens in an `HttpOnly`, `SameSite=Lax` cookie, stored server-side and expiring after 14 days.
- Every API mutation must be `application/json`, which blocks cross-site form posts.
- The server checks every permission. The UI only hides controls that a person can't use.
- Set `NODE_ENV=production` behind HTTPS so the session cookie is marked `Secure`.
