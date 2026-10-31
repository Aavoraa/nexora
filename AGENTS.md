# AGENTS — Nexora

Instructions for AI coding agents working in this repository. This file is at the root so coding tools find it. The full documentation is in `docs/`.

## 1. Project Context

| Field | Value |
|---|---|
| Project | Nexora (formerly Cadence) |
| Purpose | A social media workspace for loan officers: upload media, write captions with AI, get compliance approval, and publish on schedule. |
| Primary Users | Loan officers, branch managers, compliance reviewers (see docs/PRD.md §4) |

**Reference product:** feature parity with "SoLo by Fairway" is tracked in [docs/FEATURE_PARITY.md](docs/FEATURE_PARITY.md). Match capabilities only. Never copy its design, text, branding, assets or code.

## 2. Source of Truth

Before significant changes, read the relevant documentation in `/docs`:
- [PRD.md](docs/PRD.md): what we are building and what counts as done
- [DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md): visual rules and tokens
- [UX_FLOWS.md](docs/UX_FLOWS.md): journeys and their loading, empty and error states
- [ARCHITECTURE.md](docs/ARCHITECTURE.md): modules and dependency rules
- [DATABASE.md](docs/DATABASE.md): schema and conventions
- [API.md](docs/API.md): endpoint contracts
- [SECURITY.md](docs/SECURITY.md): auth, roles, tenancy, secrets
- [CODE_STYLE.md](docs/CODE_STYLE.md): conventions
- [TESTING.md](docs/TESTING.md): how to prove it works
- [DELIVERY.md](docs/DELIVERY.md): current SOP phase, gates and checklist

Do not contradict these documents without first identifying the conflict.

## 3. General Rules

- Understand existing code before modifying it.
- Reuse existing components and utilities.
- Follow the design system.
- Follow the architecture.
- Follow database conventions.
- Follow security requirements: every query must be scoped to the caller's workspace, and permissions are checked on the server.
- Follow coding conventions.
- Do not invent business requirements. Anything not in the PRD is an open question.
- Do not expose secrets. Never paste credentials or customer personal data into prompts, code, logs or screenshots.
- Avoid unnecessary dependencies.
- Avoid unrelated changes.

## 4. Planning

Before implementing a non-trivial task:
1. Inspect the relevant documentation.
2. Inspect the relevant code.
3. Identify affected files.
4. Identify dependencies.
5. Identify database and API changes.
6. Identify the tests required.
7. Create a concise implementation plan.

## 5. Implementation

- Make focused changes.
- Reuse established patterns.
- Preserve existing behaviour.
- Avoid unnecessary rewrites.
- Keep code maintainable.

## 6. Validation

After implementation:
1. Run tests: `npm test` (set `TEST_DATABASE_URL` to a **disposable** database so the integration tests run).
2. Run linting: `npm run lint`.
3. Run type checking: n/a (plain JavaScript).
4. Run the build: `npm run check`.
5. Review changed files.
6. Check for unintended changes.

## 7. Documentation

Update the documentation when the implementation changes:
- Product behaviour (PRD.md feature **Status** lines, UX_FLOWS.md)
- Architecture
- Database schema
- API contracts
- Security rules
- Coding conventions

## 8. Conflict Handling

If requirements conflict, do not guess. Identify the conflict and ask for clarification.

## 9. Completion Criteria

A task is complete only when:
- Requirements are satisfied.
- Tests pass.
- The build succeeds.
- No unintended files changed.
- Security rules are respected.
- Documentation is updated when necessary.

Report any checks that were not run, and why.
