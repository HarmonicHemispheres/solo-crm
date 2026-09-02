---
id: T-260902-10
title: An engagement card states what it is worth, instead of hours nobody can book
status: done
category: ui
created: 2026-09-02
closed: 2026-09-02
---

## Why

Reported: *"i have an engagement with T&M but it continues to say 0 to X
hours this month... theres no way to book hours. thats also not the job of
this app, we are supposed to be able to track our engagements and forecast
what revenue that will bring in."*

Right on both counts. Every retainer card read "0 of N hrs this month" and
every T&M card "0 of ~N hrs", with the 0 hardcoded and a "Provisional" tag
explaining that real hours arrive with a timelog import (P4-05). That is not
a fact about the engagement — it is the app describing a feature it does not
have, on every card, permanently.

## Story

As the operator, an engagement card tells me what that engagement is worth.

## Constraints

- ADR-003. Its two stated exceptions matter here: "a single engagement's own
  headline price ... states the engagement's terms; it does not aggregate."
  Anything summed, or attributed to a month or a payer, stays with
  `revenue_lines`.

## Acceptance

- [x] No card shows a consumed-hours figure or a "Provisional" tag.
- [x] Each priced model states its own price, in its own shape.
- [x] An unpriced engagement says so rather than showing $0.00.
- [x] No annualised figure and no total across cards.
- [x] Open the app: every seeded engagement shows a real number.

## Related

`views/Engagements.tsx` (`EngagementProgress` and the three shapes it
dispatches), `Engagements.css`, ADR-003.

---

## Outcome

**Changed:** the three progress shapes become three terms lines. Retainer
states its monthly price (flat, or hours x rate with the basis beneath);
fixed states its contract value, with the milestone pips kept but drawn only
when milestones exist; T&M states the estimate at the agreed rate, capped by
its own not-to-exceed. `HoursProgress`, `ProvisionalMark` and the empty
`.bar` are gone.

**Departed from scope: one thing, and it is the interesting one.** The
agreed shape included an annualised figure — "$3,500 / mo · $42,000 / yr".
That is not built and should not be. An annualisation is a projection across
months, which is an aggregation *and* an attribution to periods, and ADR-003
puts both through `revenue_lines`. AGENTS.md calls porting exactly this class
of computation "the highest-risk carry-over in the project". The monthly and
per-engagement figures that *are* here are the ADR's own named exception,
read from one engagement's own columns.

The multi-month forecast is real work and it is already scoped: T-260902-03
(the generator that writes `revenue_lines` from an engagement's terms), then
-04 to -06 for the rollups, the Revenue view and the chart. That is where an
annual figure and a portfolio total belong, and building them there also
fills the Revenue page, which is the same feature.

**Not verified:** Nothing. Screenshotted the built app: all four active
engagements show a price — $4,950 for the T&M at ~30 hrs x $165, $6,500/mo
flat, $18,000 fixed, $1,800/mo at 12 hrs x $150.

**Elapsed:** ~40 minutes.
