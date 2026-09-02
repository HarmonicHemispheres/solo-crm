---
id: T-260901-27
title: Compute a company's cadence state in one place, so the grid, the detail page and Today agree
status: done
category: ui
created: 2026-09-01
closed: 2026-09-02
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

- [x] `Companies.tsx` and `CompanyDetail.tsx` carry no day arithmetic of
      their own.
- [x] A company with `cadenceDays: null` shows the same state in all three
      views.
- [x] Open the app with the seeded database: the late set on Today matches
      the red bars in the grid.

## Related

`electron/renderer/lib/decay.ts`, `views/Companies.tsx` (~line 136),
`views/CompanyDetail.tsx` (~line 271), `views/Today.tsx` (~line 297),
`components/sheets/CompanySheet.tsx`'s cadence chips.

---

## Outcome

**Changed:** `views/Companies.tsx` and `views/CompanyDetail.tsx` both call
`lib/decay.ts`'s `decayForCompany` and carry no day arithmetic of their own.
Each gained a `settings:getAll` read (the same key Shell, Rail and Today
already hold - no extra IPC) and a clock fixed at mount, and each now blocks
on that query the way it already blocked on its others. New check:
`views/cadence-single-source.test.ts`.

**Departed from scope:** Three things.

`Companies.tsx`'s `decayColor` returned `var(--verdigris)` - *green* - for a
non-finite pct, so a company that is never-touched-and-no-cadence drew a
green ring beside the red bar `DecayMeter` draws for the same company, on
exactly ADR-001 rule 5's case. Routing through `decay.band` removes it
rather than fixing it. The old comment claimed the primitives already
handled this; `Ring` does (an empty track), its *colour* did not.

The cadence column and the "every Nd" line now read `decay.cadenceDays` -
the cadence actually used - so a company inheriting its kind's default shows
that number instead of "no cadence set" beside a bar measured against it.
The table's cadence sort moved with them, since sorting on the raw nullable
column would have ordered the table by a number it was no longer displaying.

`CompanyDetail`'s never-touched label changes from "no contact logged" to
`decay.ts`'s "never". Both are honest; two of them for one state was the
task. `CompanyDetail.test.tsx`'s assertion on that string is updated - its
three `className` assertions (`late`, not `ok`, not `warn`) are unchanged
and still pass, which is the evidence ADR-001's guard survived the move
rather than the claim that it did.

**Not verified:** Nothing. The drift was visible on the seeded database
before the change and is gone after it: `npm run snap` had "Ben Thompson -
LEGO resale" reading **50d** on the companies grid and **49d** on Today and
on its own detail page, in the same run - the round-versus-floor split. The
grid now reads 49d, and the rest of that screenshot is pixel-identical.

**On the check.** A rendering test proves the three views agree on the
fixture it is given, and these views disagreed for months on values no
fixture happened to hit: the round/floor split only shows for a fractional
day over .5, and the kind-default split only for a null `cadenceDays`, which
no fixture had. So the check is structural - no view divides by
`cadenceDays`, no view ages `lastTouchAt` by hand, and the three that show
cadence all import `decayForCompany`. All three assertions were confirmed
red against the pre-change views.

**Elapsed:** ~45 minutes.
