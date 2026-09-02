---
id: T-260901-27
title: Compute a company's cadence state in one place, so the grid, the detail page and Today agree
status: open
category: ui
created: 2026-09-01
closed:
---

## Why

Three views compute "late" three ways: `Companies.tsx` rounds days and
uses the company's own `cadenceDays` only (`NaN` when null);
`CompanyDetail.tsx` floors and does the same; `Today.tsx` uses
`lib/decay.ts`'s `decayForCompany`, which floors and falls back to the
kind's default cadence from settings (P2-03). Pick the "Not set" cadence
chip in the company sheet — a path it deliberately offers — and the grid and
detail show a full red bar while Today lists the company as current. A touch
twelve hours old reads "1d" in the grid and "today" elsewhere.

## Story

As the operator, a company's cadence state is one answer wherever I see it.

## Constraints

- `lib/decay.ts` is the implementation; the two views point at it rather
  than a fourth copy. Its behaviour (floor, kind default) is the decision.
- `Companies.tsx`'s comment says "decay bands are P2-03, not this task";
  P2-03 has landed, so that deferral is what this closes.

## Acceptance

- [ ] `Companies.tsx` and `CompanyDetail.tsx` carry no day arithmetic of
      their own.
- [ ] A company with `cadenceDays: null` shows the same state in all three
      views.
- [ ] Open the app with the seeded database: the late set on Today matches
      the red bars in the grid.

## Related

`electron/renderer/lib/decay.ts`, `views/Companies.tsx` (~line 136),
`views/CompanyDetail.tsx` (~line 271), `views/Today.tsx` (~line 297),
`components/sheets/CompanySheet.tsx`'s cadence chips.
