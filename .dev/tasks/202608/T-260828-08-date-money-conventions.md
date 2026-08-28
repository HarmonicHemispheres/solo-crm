---
id: T-260828-08
title: Fix the date and money representations and enforce them at the boundary
status: done
category: docs
plan_ref: P0-06
created: 2026-08-28
closed: 2026-08-28
---

## Why

Dates and money are the two things every layer of this app touches and every
layer represents differently if nobody decides. SQLite has no date type and no
decimal type; JavaScript has `Date`, which serialises across IPC into a string
nobody chose, in a timezone nobody chose. Floating-point money is wrong by
cents, and cents are the unit every figure in §6.7 is reported in.

Deciding this after three repositories exist means changing three repositories.

## Scope

**In:**

- `CONVENTIONS.md` at the repo root stating the rules:
  - Dates: ISO `TEXT`, `YYYY-MM-DD`. No time component, no timezone.
  - Timestamps: ISO-8601 UTC `TEXT`.
  - Money: integer cents, always. Column names end `_cents` so a bare number is
    visibly suspect.
  - `period_month`: the first day of the month, as a date.
  - Durations and hours: `numeric`, per §5's `time_entries.hours`.
  - **No `Date` object crosses the IPC boundary.** Serialise at the edge.
- Shared zod schemas for each type, exported for T-260828-09's channel registry
  to compose — so the rule is enforced by validation rather than by review.
- Formatting and parsing helpers in one module, used by both processes.

**Out:** Currency selection and display (§6.11 identity settings — P2-01 and its
UI). Locale-aware formatting beyond the single configured currency. Timezone
handling for calendar events (P4-06's problem, and it should read this file).

## Touches

- `CONVENTIONS.md` — new
- `electron/shared/types.ts` or equivalent — zod primitives, shared by main and
  renderer
- `electron/shared/format.ts` — parse and format helpers

## Acceptance

- [ ] `CONVENTIONS.md` exists and states each rule in one line
- [ ] A zod schema rejects a `Date` instance where a date string is expected, with
      a test proving it
- [ ] A money value expressed as a float fails validation
- [ ] The shared module is importable from both main and renderer without
      dragging Node types into the renderer's tsconfig
- [ ] `period_month` validation rejects any date that is not the first of a month
- [ ] Round-tripping a date through IPC returns the identical string — no
      timezone shift

## Risks

- **This looks like a documentation task and is not.** If the zod primitives are
  not written and used, `CONVENTIONS.md` is a file nobody reads and the rules are
  broken within two repositories. The enforcement is the deliverable; the
  document explains it.
- The shared module is imported by both processes, so it must stay free of Node
  and DOM APIs. It is the easiest place to accidentally breach the boundary
  T-260828-04 establishes.
- `numeric` hours in SQLite are REAL, so hours are floating point where money is
  not. That asymmetry is deliberate but surprising — say so in the document,
  because someone will otherwise "fix" it.
- Near the AGENTS.md revenue gotcha: cents everywhere is what makes
  `SUM … GROUP BY` exact. A single float column in `revenue_lines` reintroduces
  rounding into totals that §6.7 requires to agree to the cent.

---

## Outcome

Merged to main in run R-260828-01. `CONVENTIONS.md` plus the enforcement:
`dateOnlySchema`, `timestampSchema`, `periodMonthSchema`, `centsSchema`,
`hoursSchema` in `electron/shared/types.ts` (zod ^4.4.3, runtime dependency —
main resolves it from node_modules at runtime), format helpers in
`electron/shared/format.ts`. `electron/shared/` is typechecked under BOTH
tsconfigs, which is the real boundary gate — a `process` reference in a shared
file fails the renderer typecheck. Timezone-immunity proven by a TZ-mutating
test under `electron/main/`; the reviewer independently re-ran it under
`TZ=Pacific/Kiritimati` (UTC+14) to confirm the proof is real.

Review: no blocking; applied at merge — SQL-side timestamp rule added to
CONVENTIONS.md (`CURRENT_TIMESTAMP` produces a format `timestampSchema`
rejects; T-260828-07 must write timestamps from JS or use
`strftime('%Y-%m-%dT%H:%M:%fZ','now')`), TZ-restore bug in the test's
`afterEach` (undefined → literal `"undefined"`), `formatTimestamp` doc-comment
mechanism, AGENTS.md now references CONVENTIONS.md. Verify after fixes:
typecheck, lint, 44/44 tests, build — all green.

Handoffs recorded:
- **T-260828-07:** never use SQLite timestamp defaults — see the new
  CONVENTIONS.md rule.
- **T-260828-09:** the preload builds with `externalizeDeps: true`; a sandboxed
  preload cannot resolve `node_modules`, so if it imports these schemas, zod
  must be bundled into the preload (noExternal), not left external.
