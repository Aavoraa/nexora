# CODE_STYLE — Cadence

## 1. General Principles

- Prefer readable code.
- Keep functions focused.
- Avoid unnecessary abstractions.
- Reuse existing components and utilities (`api()`, `act()`, `esc()`, `shell()` on the client; `one`/`many`/`tx`, `fail`, `ah`, `brandFor`/`postFor` on the server).
- Prefer consistency over novelty.

## 2. Naming

| Field | Convention |
|---|---|
| Views (client) | `views.<route>` async functions that render one screen |
| Functions | `camelCase` verbs (`schedulePost`, `loadBrands`) |
| Variables | `camelCase`. DOM element refs start with `$` (`$content`). |
| Constants | `UPPER_SNAKE` for fixed tables and regexes (`ROLES`, `TIME_RE`, `PLATFORMS`) |
| Files | lowercase, one word where possible (`publisher.js`, `ratelimit.js`) |
| Database fields | `snake_case` (see DATABASE.md) |
| API routes | lowercase plural nouns, with verb sub-paths for state changes (`/posts/:id/approve`) |
| JSON fields | `snake_case`, matching the database columns |

## 3. Folder Structure

- `server/`: one module per responsibility (see ARCHITECTURE.md §4). No subfolders until a module grows past about 600 lines.
- `public/`: static files served as they are. `js/app.js` is the only script.
- `tests/unit`, `tests/integration`: mirror the module under test (`time.test.js` ↔ `server/time.js`).
- `docs/`: SOP documents only.

## 4. Imports

- ES modules everywhere (`"type": "module"`). Use `node:` prefixes for built-ins (`node:crypto`).
- Order: built-ins, then packages, then local modules. Always include the `.js` extension in local imports.
- No new runtime dependency without a note in ARCHITECTURE.md §9 explaining why.

## 5. Components

Client views should:
- Have a single responsibility (one route).
- Build HTML with template strings, passing **every** user-supplied value through `esc()`.
- Bind events after `shell()` renders. Use `act(button, fn)` for any async action.

## 6. Functions

Functions should:
- Do one logical thing.
- Have clear names.
- Avoid unnecessary complexity.

Server route handlers: validate → load the scoped record → check the rule → write → log activity → respond.

## 7. Error Handling

| Field | Pattern |
|---|---|
| Use | `fail(status, message)` / `HttpError` for expected errors. Wrap async routes in `ah()`. Map third-party errors to plain messages (`AiError`). On the client, `act()` shows toasts. |
| Do not | Return raw exception text for 5xx responses, swallow errors silently (except clearly non-critical UI refreshes, with a comment), or string-match SDK error messages (use typed classes). |

## 8. Comments

Comments should explain:
- Why something exists.
- Important tradeoffs.
- Non-obvious behaviour (e.g. why `replaceState` is used after sign-in).

Avoid comments that simply repeat the code. Use JSDoc one-liners on exported helpers.

## 9. Logging

| Field | Value |
|---|---|
| Use | `console.log` / `console.error` (stdout and stderr, collected by the host). User-visible audit events go to the `activity` table. |

Rules:
- Prefix background logs with the module (`[publisher]`).
- Never log secrets, tokens, passwords or request bodies (SECURITY.md §7).

## 10. Formatting

| Field | Tool |
|---|---|
| Formatter | Hand-formatted to match the existing style: 2-space indent, single quotes, semicolons, trailing commas in multi-line literals |
| Linter | ESLint 9 (flat config, `eslint.config.js`): `npm run lint` |
| Type Checking | None. This is plain JavaScript by decision (ARCHITECTURE §9). JSDoc where it helps. |

## 11. Do

- Reuse existing patterns.
- Keep changes focused.
- Follow project conventions.
- Remove dead code.
- Update docs in the same change as the behaviour.

## 12. Don't

- Create duplicate utilities.
- Introduce unnecessary dependencies.
- Ignore existing architecture.
- Change unrelated files.
- Put business rules only in the client.
