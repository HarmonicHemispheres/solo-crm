---
id: T-260901-05
title: Build the offerings repositories — categories, offerings, versions
status: open
category: data
plan_ref: P3-01
created: 2026-09-01
closed:
---

## Why

`/offerings` is a placeholder. It renders `ViewPlaceholder`'s bare
`<h1>Offerings</h1>` ([routes.tsx:20](../../../electron/renderer/routes.tsx#L20))
and nothing else, so nothing can be created there and nothing can be attached
to an engagement. The reported symptom is a missing feature, not a defect: the
task plan puts this in Phase 3 and the plan's own status line says Phase 2
onward is not started.

The tables are already there and already carry data. `offering_categories`,
`offerings` and `offering_versions` were created in the initial schema and
renamed by
[`0006_offerings_rename.sql`](../../../electron/main/db/migrations/0006_offerings_rename.sql),
whose header records the state precisely: "No repository reads these three
tables yet — P3-01 (offerings repositories) and P3-07 (the offerings view) are
unbuilt". The dev seed writes five categories, nine offerings and their
versions, and six of the seeded engagements already point at an
`offering_version_id`. So the data model is settled and populated, and the
only thing between it and the operator is a repository, a channel and a view.

This is that repository. It is the first of three tasks and the other two
cannot start without it.

## Scope

**In:** `electron/main/db/repositories/offerings.ts` and its zod vocabulary in
`electron/shared/offerings.ts`, following the shape every existing repository
here uses — read `companies.ts` and `engagements.ts` first, and the machinery
T-260828-43 extracted, rather than inventing a fourth idiom.

Reads:

- List categories, ordered by `sort` then name.
- List offerings, with their current version's rate joined on, filterable by
  `type` (`service` | `product`), by category, and by `active`.
- Get one offering with its full version history.

Writes:

- Create, rename and archive a category. **Deleting a category that holds
  offerings is refused with a reason** — P3-01's acceptance and §6.5's rule.
- Create an offering. **An offering always has at least one version —
  creating one with no rate is refused**, in the same transaction, so a
  version-less offering is not representable rather than merely discouraged.
- Update an offering's non-price fields: name, type, category, billing model,
  unit, blurb.
- Archive an offering: sets `active = 0`. **Nothing is deleted, ever.**
- Duplicate an offering (§6.5's "duplicate"), copying its current version as
  the new record's first version.

Constraints this task owns:

- **Version effective ranges cannot overlap for the same offering.** Enforce
  it and test it with an actual overlapping insert, not by reasoning about
  the insert path.
- `type`, `billing_model` and `unit` are currently nullable free text with
  their accepted values written in a schema comment (`service | product`,
  `retainer | fixed | tm`, `fixed | from | mo | hr`). Declare them as closed
  `as const` tuples in `electron/shared/offerings.ts` and validate against
  them at the repository edge, the way `ENGAGEMENT_STATUSES` and
  `COMPANY_KINDS` already are. Do not add a `CHECK` constraint or change
  nullability — that is a migration and this task has none.

**Out:**

- **Price versioning** — closing the current version and appending the next
  with an effective date. That is P3-02, it carries an `architecture-review`
  gate of its own, and §6.5 makes changing a price a distinct action rather
  than a field edit. This task creates an offering's *first* version and
  reads the history; it does not append a second.
- Anything touching `revenue_lines`. Reading an offering's price for display
  is a legal read of an offering column
  ([ADR-003](../../decisions/ADR-003-materialised-revenue.md) says so
  explicitly); computing revenue from one is not, and nothing here should.
- Quick-add parsing (`Name, 4500/mo`) — that is the view's job, P3-07.
- The IPC channels ([T-260901-07](T-260901-07-offerings-ipc.md)) and the view
  ([T-260901-11](T-260901-11-offerings-view.md)).

## Touches

- `electron/shared/offerings.ts` (new) — zod schemas and the three closed
  vocabularies
- `electron/main/db/repositories/offerings.ts` (new)
- `electron/main/db/repositories/offerings.test.ts` (new)
- `electron/main/db/repositories/referential-guard.ts` — if the category
  delete refusal belongs with the existing guards rather than inline

## Acceptance

- [ ] Creating an offering with no rate is refused, and the refusal names the
      missing rate. No row is left behind — asserted by counting `offerings`
      after the failed call.
- [ ] Two versions of one offering with overlapping `effective_from` /
      `effective_to` ranges are refused; the same two ranges on two
      *different* offerings are accepted.
- [ ] Archiving sets `active = 0` and the row is still readable by id, and
      still resolvable from an engagement's `offering_version_id`.
- [ ] Deleting a category holding one offering is refused with a message
      naming the offering count; deleting an empty category succeeds.
- [ ] Duplicating an offering produces a new id, a new first version at the
      same rate, and leaves the original untouched — verified by reading both
      rows back.
- [ ] A `type` of `"widget"` is refused at the repository edge, from the
      shared tuple, not by a hand-written `if`.
- [ ] Against the dev seed, listing offerings returns nine, and listing
      categories returns five.
- [ ] `npm run verify` passes.

## Risks

- **Reordering the plan.** This is Phase 3 work landing before Phase 2 is
  built. Nothing here depends on Phase 2, but the plan's dependency arrows now
  point backwards, and P3-05's "every provisional revenue computation added in
  Phase 2 is removed in this change" still stands and is not this task's to
  discharge.
- These three tables were renamed one wave ago (T-260829-10) and their column
  comments carry the accepted values. A repository that spells a value
  differently than the seed does will read empty and look like no data —
  cross-check against `electron/main/db/seed/fixture.ts`, which is the only
  writer today.
- `offerings.category_id` deliberately kept its name through the rename. Do
  not "finish" the rename.
- `offering_versions.version` is a plain integer with no uniqueness
  constraint per offering. Two version 1s are currently representable; decide
  whether this task guards it and say which in the outcome.
