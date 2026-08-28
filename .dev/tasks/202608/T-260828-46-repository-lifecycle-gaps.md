---
id: T-260828-46
title: Close the repository lifecycle gaps review found but left out of scope
status: open
category: data
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Four findings from R-260828-02's reviews that are real, are not defects in the
code that shipped, and were deliberately not fixed inside the tasks that found
them because each would have widened a diff already carrying seven fixes.

The first is the one that matters. **A person or company that has ever been
referenced is permanently undeletable, and the error message promises a way out
that does not exist.** `deletePerson` refuses with *"Remove those affiliations
before deleting this person"* — but no `deleteAffiliation` exists anywhere in the
repository layer, and the scope that built it lists only list / add / update /
end. `deleteCompany` carries the identical dead end from T-260828-20. So the
refusal is honest about *why* and dishonest about *what to do next*, which is
worse than a bare error: it sends someone looking for a control that was never
built.

## Scope

**In:**

1. **Make the refusals satisfiable.** Either add `deleteAffiliation` to the
   people repository and let the message stand, or change both messages —
   people and companies — to stop promising a route that does not exist. Adding
   the delete is probably right: an affiliation created by a typo has no other
   way out, and unlike `activity` it is not append-only by decision. If it is
   added, it needs the same refusal treatment as everything else, and the
   question of what happens to an affiliation on a real delete must be answered
   rather than left to the foreign key.
2. **Settle and record `is_primary`'s scope.** The people repository reads it as
   "the main point of contact *at this company*" and clears siblings per-company.
   The acceptance criterion it was built against reads equally well as
   per-person, and §5 only says `is_primary boolean`. The choice is defensible
   and currently lives in a code comment. T-260828-31 (person detail) and
   T-260828-26 (the IPC contract) both need to know which it is — record it in
   the task outcome or as an ADR, and add a test that pins it.
3. **Document or refuse the affiliation lifecycle edges.** Probing a real
   database found that `endAffiliation` on an already-ended affiliation silently
   overwrites `ended` (2021 becomes 2023, no refusal), and
   `updateAffiliation({ended: null})` reopens a closed stint. Both are plausible
   as typo corrections and both are currently unstated and untested, so the next
   caller cannot tell intent from accident. Decide, then test.
4. **Widen the ADR-003 guard.** `engagements.test.ts` greps only
   `/\bSUM\s*\(/i`, which catches an aggregate but not the thing the task's Risks
   section actually names — a `monthlyValue(engagement)` helper branching on
   `billingModel` to multiply hours by a rate contains no `SUM` and would pass.
   Review read the file and confirmed no such helper exists today; the guard just
   would not catch one arriving later.
5. **Restore the compile-time link in `ALL_WRITABLE_COLUMNS`.** It types `key` as
   bare `string`, so renaming a field in `electron/shared/engagements.ts`
   typechecks and fails only at runtime. The existing docstring correctly
   explains why `keyof` on a discriminated union collapses to the shared keys; a
   per-branch map would restore the link.

**Out:** The duplicated repository machinery (**T-260828-43**). The settings
credential-guard tests (**T-260828-44**). FK indexes and polymorphic orphans
(**T-260828-41**). Any change to what `is_primary` *means* beyond writing down
the meaning already implemented.

## Touches

- `electron/main/db/repositories/people.ts` and its test
- `electron/main/db/repositories/companies.ts` — the matching refusal message
- `electron/main/db/repositories/engagements.ts` and its test
- Possibly `.dev/decisions/` for the `is_primary` scope

## Acceptance

- [ ] A person with only affiliations can be deleted, or the refusal names a
      route that exists — asserted by a test that follows the message's own
      instruction and succeeds
- [ ] `deleteCompany`'s equivalent message is consistent with whatever
      `deletePerson` does
- [ ] `is_primary`'s scope is written down outside a code comment, and a test
      fails if the other interpretation is implemented
- [ ] `endAffiliation` on an ended affiliation and `updateAffiliation({ended:
      null})` each have a stated, tested behaviour — refusal or overwrite, but
      chosen
- [ ] The ADR-003 guard fails against a synthetic `monthlyValue` helper that
      branches on `billingModel` and contains no `SUM` — verified by adding one,
      watching it go red, and removing it
- [ ] Renaming a field in `electron/shared/engagements.ts` fails `npm run
      typecheck` rather than at runtime

## Risks

- **Adding `deleteAffiliation` without deciding what it means.** Deleting an
  affiliation deletes the record that someone worked somewhere — close to the
  history-erasure §5 built this table to prevent. A typo needs removing; a
  finished stint does not. If the distinction cannot be drawn cleanly, changing
  the message is the honest option.
- **An ADR-003 guard that greps for names.** Matching on `monthlyValue` catches
  one spelling. The guard is a backstop for review, not a replacement — say so
  where it lives.
