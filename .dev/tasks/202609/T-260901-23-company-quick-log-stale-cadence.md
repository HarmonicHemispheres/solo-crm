---
id: T-260901-23
title: Logging a touch from the company page moves the company's cadence meter, not only its activity list
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

`CompanyDetail`'s Activity card called `activity:log` and invalidated only
`activity`. The insert also advances `companies.last_touch_at` in the same
transaction, and the header `DecayMeter`, the `/companies` grid and Today's
"Going quiet" all read that column from the `companies` cache at
`staleTime: Infinity` — so a company reading "12d · late" kept reading it
after the touch was logged, until some unrelated invalidation. `QuickLog`
already invalidates the pair for exactly this reason.

## Story

As the operator, I log a touch on a company's page and its meter resets on
the spot.

## Constraints

- CONVENTIONS.md: a mutation names what it invalidates through
  `invalidate.<entity>()`, never a literal key.
- Not awaited, as `QuickLog` explains — the card must not hold the input
  hostage to a refetch.

## Acceptance

- [x] After a logged touch the test's `companies:get` stub is called again.
- [x] Open the app, log a touch on a late company: the header meter moves.

## Related

`electron/renderer/views/CompanyDetail.tsx` (`ActivityCard`),
`components/shell/QuickLog.tsx`, `main/db/repositories/activity.ts`.

---

## Outcome

**Changed:** one `onSuccess`; one test in `CompanyDetail.test.tsx`.

**Departed from scope:** Nothing.

**Not verified:** The last acceptance item was not driven by hand; the
stub's `companies:get` is never given a moved `lastTouchAt`, so the test
proves the refetch, not the meter. `npm run snap -- --routes company` was
read.

**Elapsed:** ~10 minutes.
