---
id: T-260902-08
title: A retainer says what it is worth per month — a flat amount, or hours at a rate
status: done
category: data
created: 2026-09-02
closed: 2026-09-02
---

## Why

Reported: *"in engagements for retainer, we can set the hours but not the
rate. retainers need to be either hourly and rate based or amount based per
month."*

The retainer branch of the engagement form rendered one field, "Hours
included". `hoursIncluded` was the only retainer-specific column, so there
was no way to record what the client is actually invoiced — which is most of
what a retainer is. `agreedRateCents` was not the answer: it is the snapshot
copied from the offering at signature, `updateEngagement` deliberately drops
it, and it means whatever that offering's unit meant.

## Story

As the operator, a retainer records its price the way it was actually
agreed — a monthly fee, or an allowance of hours at a rate — and the app
knows which.

## Constraints

- CONVENTIONS.md: money is integer cents.
- ADR-003: the revenue generator has to branch on a fact the row states.

## Acceptance

- [x] `retainer_basis` and `monthly_amount_cents` exist, by migration.
- [x] The form shows one pair of fields or the other, chosen by a chip group.
- [x] The hourly basis shows the monthly product as it is typed.
- [x] An existing retainer with no basis is not defaulted into one.
- [x] Open the app, edit a seeded retainer of each basis.

## Related

`electron/main/db/migrations/0008_retainer_basis.sql`, `schema.ts`,
`shared/engagements.ts`, `repositories/engagements.ts`,
`components/sheets/EngagementSheet.tsx`, `db/seed/fixture.ts`.

---

## Outcome

**Changed:** migration 0008 adds `retainer_basis` and
`monthly_amount_cents`. The retainer branch of the create and update schemas
gains those two plus `hourlyRateCents`, which is now shared with T&M —
the same fact in both, the rate an hour bills at. `MODEL_SPECIFIC_COLUMNS`
carries the new pair so a model switch still NULLs them. The form gets a
basis chip group and, on the hourly basis, a live `= $1,650.00 / month`.

**Departed from scope:** Three things.

Both bases' fields are sent on every write, not only the selected one's.
Switching a retainer to a flat fee and back should not throw away the hours;
the *basis* is what says which pair is live, which is the whole reason it is
stored rather than inferred from which columns are non-null.

The seed now carries one retainer of each basis — Rinvii on a flat $6,500,
Sand & Sage on 12 hrs x $150, deliberately equal to the $1,800 its offering
quotes so the two shapes can be compared on screen without the numbers being
the difference.

`0006_offerings_rename.test.ts` and `0007_company_images.test.ts` seeded a
deliberately *old* database with the current `seedFixture`, which breaks the
moment any later migration adds a column the seed writes — as this one did,
with a failure ("table engagements has no column named retainer_basis")
saying nothing about either migration. 0007 now writes its own small fixture
using 0001 columns only, as 0006 already did for its own reason; 0006's
dev-seed test applies the whole migration set, which is what it was actually
about.

**Not verified:** Nothing. Screenshotted both bases in the built app; the
hourly one shows `= $1650.00 / month` for 10 x 165 as typed.

**Elapsed:** ~1 hour.
