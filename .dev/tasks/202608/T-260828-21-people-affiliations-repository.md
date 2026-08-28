---
id: T-260828-21
title: Build the people and affiliations repository — history-preserving company moves
status: done
category: data
plan_ref: P1-02
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

There is no way to record a person. `people` and `affiliations` exist in
migration 0001 and are populated by the seed fixture, and nothing else reads
them. The shape here is the one modelling decision §5 calls out by name — *"a
`company_id` on `people` would erase a contact's history the day they move"* —
so the repository that gets written first is the one that decides whether that
holds. Written naively (a helper that overwrites the affiliation row on a move)
the schema stays correct and the behaviour is already wrong.

## Scope

**In:** `electron/main/db/repositories/people.ts` covering both tables:

- `listPeople`, `getPerson(id)`, `createPerson`, `updatePerson`, `deletePerson`
  over `name`, `email`, `phone`, `notes`.
- Affiliations as their own functions: `listAffiliationsForPerson(personId)`,
  `listAffiliationsForCompany(companyId)`, `addAffiliation`, `updateAffiliation`,
  `endAffiliation(id, endedOn)` — carrying `title`, `is_primary`, `started`,
  `ended`.
- `movePerson(personId, toCompanyId, { on })` — **one transaction** that stamps
  `ended` on the current open affiliation and inserts the new one. Either both
  land or neither does.
- `getPerson` returns current and historical affiliations together, each marked,
  so a caller never has to infer "historical" from a null check it might get
  backwards.
- UUID ids and `created_at` / `updated_at` on both tables — `affiliations` is a
  join table and ADR-002 explicitly does **not** exempt it.
- Deletion refusals in the same shape T-260828-20 establishes: a person with
  activity rows is refused with a reason, sharing that task's `errors.ts`.

**Out:** IPC channels (T-260828-26). The people view and person detail
(T-260828-31). Any unique constraint on `(person_id, company_id)` — ADR-002
settles that the pair legitimately repeats when someone leaves and returns.

## Touches

- `electron/main/db/repositories/people.ts` — new
- `electron/main/db/repositories/people.test.ts` — new
- `electron/main/db/repositories/errors.ts` — shared with T-260828-20

## Acceptance

- [ ] `people` gains no `company_id` column — asserted by a test reading the
      schema, so a later "convenience" migration fails the suite
- [ ] After `movePerson`, the old affiliation has a non-null `ended` and the new
      one is open, and `getPerson` returns both with the closed one marked
- [ ] Forcing a failure on the insert half of `movePerson` leaves the old
      affiliation still open — no half-applied move
- [ ] The same person affiliated to the same company twice (left, returned) is
      accepted, and both rows come back in `started` order
- [ ] `is_primary` set on one affiliation does not silently leave two primaries;
      the repository clears the other in the same transaction and a test proves
      the other row moved
- [ ] `deletePerson` on a person with activity rows is refused with a reason
      naming the count, and the person is still present afterwards
- [ ] `started` and `ended` reject `'2026-8-1'` — `dateOnlySchema`, not a
      hand-rolled check (CONVENTIONS.md)

## Risks

- **The move-as-update shortcut.** Overwriting the affiliation's `company_id`
  rather than closing one row and opening another is the exact failure §5
  forbids, and it passes a shallow "person is at the right company" test.
- **`endAffiliation` with a date before `started`.** Nothing in the DDL stops
  it; validate, or a person's history reads as negative-length.
- **AGENTS.md: every table gets a UUID key and both timestamps.**
  `affiliations` is the table most likely to be mistaken for an exempt join
  table. ADR-002 says it is not.


---

## Outcome

Merged as `69c422c`. Verify on the merged tree: typecheck clean,
477/477 tests.

**Changed:** `electron/shared/people.ts`, `electron/main/db/repositories/people.ts`,
`people.test.ts` — 1278 insertions.

**Review:** blocking, on two counts, both fixed before merge.

1. *(blocking)* A **flaky test**. `expect(reloadedA?.updatedAt).not.toBe(...)`
   raced on millisecond resolution — both `addAffiliation` calls landed in the
   same millisecond, so `nowTimestamp()` returned an identical string.
   Reproduced as 1 failure in 5 runs. Merging it would have put a ~20%-red suite
   on main and poisoned the verify gate for every task after it. Made
   deterministic with fake timers, the way the ADR-002 test in the same file
   already did.
2. `clearOtherPrimaries` **rewrote closed history** — scoped without
   `ended IS NULL`, so naming a new primary contact silently flipped
   `is_primary` to false on affiliations that ended years ago. Verified against a
   real database. Who the primary contact was during a past stint is history,
   exactly like which company someone used to be at, and this is the one
   repository whose whole purpose is not losing that.
3. The ordering half of acceptance criterion 4 could not fail — mutation-proven:
   removing the `ORDER BY` left the test green, because the fixture inserted the
   2020 stint before the 2024 one so rowid order already matched. Fixture
   reordered.
4. `createAffiliationInputSchema` forked the derive-from-one-base pattern;
   now derived.

Confirmed clean: `people` has no `company_id` column, `movePerson` is genuinely
one transaction, and there is no unique constraint on `(person_id, company_id)`.

**Deferred:**

- `deletePerson` refuses with "Remove those affiliations before deleting this
  person", but **no `deleteAffiliation` exists anywhere** — so any person who has
  ever been at a company is permanently undeletable. `deleteCompany` carries the
  identical dead end from T-260828-20 → **T-260828-46**.
- `endAffiliation` on an already-ended affiliation silently overwrites `ended`,
  and `updateAffiliation({ended: null})` reopens a closed stint. Both plausibly
  intentional as typo corrections; neither stated nor tested → **T-260828-46**.
- `is_primary`'s scope (per-company, not per-person) is a real modelling decision
  currently made only in a code comment. T-260828-31 and T-260828-26 both need to
  know which it is.
- `movePerson` closing *every* open affiliation is documented and works (probed)
  but only the single-open-row case is tested.
- ~50 lines copied verbatim from `companies.ts` → **T-260828-43**.
