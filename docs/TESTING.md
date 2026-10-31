# TESTING — Cadence

## 1. Testing Goals

Critical functionality:
- Sign-up, sign-in and session handling.
- Role and tenant isolation (nobody sees or changes another workspace's data; roles enforced).
- Post lifecycle: draft → schedule / queue → (pending → approve / send back) → published / failed.
- Queue slot calculation across time zones and DST.
- The publisher publishes due posts exactly once.

## 2. Test Types

### Unit Testing
Pure logic: `time.js` (slot maths, DST, time zone validation) and `auth.js` (password hashing).

### Integration Testing
The real Express app against a real PostgreSQL database, over HTTP: every endpoint group for success, invalid input, unauthenticated, forbidden and cross-workspace access, plus the publisher.

### End-to-End Testing
Critical browser journeys, currently **manual** (run in the browser before each gate; see §5). Automating them with Playwright is planned for Phase 4.

## 3. Testing Tools

| Field | Tool |
|---|---|
| Unit | `node:test` + `node:assert` (built in, no dependency) |
| Integration | `node:test` + `fetch` against the app on a random port + a throwaway PostgreSQL database |
| E2E | Manual script (§5). Playwright planned. |

## 4. Test File Structure

```
tests/
  unit/          time.test.js, auth.test.js, media.test.js (file inspection, readiness)
  integration/   api.test.js (incl. the media upload flow over real signed URLs)
  helpers.js     test database + temp MEDIA_DIR setup, HTTP client with cookies
  fixtures.js    minimal valid MP4/MOV (incl. rotated portrait), PNG, JPEG, WebP built in memory
```

Integration tests need `TEST_DATABASE_URL`, pointing at a database **that may be dropped**. The suite creates it if it is missing and drops every table before it runs. **Never point it at a real database.** Without the variable, the integration tests are skipped with a message.

## 5. Critical User Flows

| Flow | Steps | Expected result |
|---|---|---|
| Create workspace | 1. Open the app 2. Create workspace 3. Fill in the form 4. Submit | Calendar shown, default brand, signed in |
| Schedule a post | 1. Add an X channel 2. New post 3. Type text 4. Schedule for tomorrow 10:00 | Toast "Scheduled for …". Post on the calendar. Status Scheduled. |
| Queue a post | 1. New post 2. Type text 3. Add to queue | Gets the next free slot in the workspace time zone |
| Approval | 1. Owner turns on approval 2. Editor queues a post 3. Owner approves | Editor sees Awaiting approval. After approval it is Scheduled, with the approver shown. |
| Send back | 1. Editor submits 2. Approver sends it back with a note | The post is Draft and the note is shown to the author |
| Publish | 1. Schedule a post 1–2 minutes ahead 2. Wait | Within about 15s of the time it becomes Published and appears in Analytics |
| AI drafts | 1. Set the key 2. Brief → Write drafts 3. Use this | 3 distinct drafts within the limit. The editor is filled. |
| Video upload | 1. Media → drop a phone MP4/MOV 2. Composer → Add media → pick it 3. Save | Progress → Ready. The correct orientation, duration and readiness tags are shown. The preview plays. The post keeps the video after reload. |
| Mobile | 375px width on each screen | No horizontal scroll. The drawer nav works. |

## 6. Coverage

| Field | Value |
|---|---|
| Target | Every API route has at least one success test and one denial test. 100% of `time.js`. No coverage percentage gate. |

Prioritise:
- Critical business logic (post lifecycle, queue).
- Authentication and authorization (roles, tenancy).
- Data mutations.
- Important user journeys.
- (Payments: not in scope.)

## 7. Commands

| Field | Command |
|---|---|
| Test | `npm test` (unit always; integration when `TEST_DATABASE_URL` is set) |
| Lint | `npm run lint` |
| Build | `npm run check`: syntax-checks every server and client file (there is no compile step) |
| Type Check | n/a (plain JavaScript; see CODE_STYLE §10) |

## 8. Definition of Done

- [ ] Tests pass (with `TEST_DATABASE_URL` set, so the integration tests run)
- [ ] Build passes (`npm run check`)
- [ ] Lint passes
- [ ] Type checking passes: n/a
- [ ] Critical flow verified (the §5 rows touched by the change)
- [ ] No blocking errors (server log and browser console clean)
