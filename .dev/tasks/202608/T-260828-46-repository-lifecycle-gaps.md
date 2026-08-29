---
id: T-260828-46
title: Close the repository lifecycle gaps review found but left out of scope
status: done
category: data
plan_ref:
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge, with an ADR number collision resolved on top.

**Changed:** `electron/main/db/repositories/{people,companies,engagements}.ts`
and their tests, plus `.dev/decisions/ADR-010-is-primary-scope.md` (new).

### Decisions the scope left open, each settled in the code

- **`deleteAffiliation` deletes any affiliation, open or closed.** The
  acceptance criterion requires `deletePerson`'s refusal message to be
  *satisfiable*, and under a closed-stints-are-undeletable rule a person whose
  affiliations had all ended would be permanently undeletable. The history risk
  is handled instead by keeping the delete explicit and cascade-free —
  `deletePerson` and `deleteCompany` still refuse, and nothing holds a foreign
  key to `affiliations.id`, so there is no blocker list to maintain.
- **`endAffiliation` now refuses an already-ended affiliation.**
  `updateAffiliation` is the deliberate correction verb; both overwriting an end
  date and reopening a stint (`{ ended: null }`) go through it, and both are
  tested.
- **A refusal message stopped naming a route that does not exist.**
  `companies.ts`'s affiliation refusal said "Reassign or…", but
  `updateAffiliation` rejects `personId` and `companyId`, so reassigning was a
  second nonexistent escape in the same sentence. The two messages are now
  word-for-word parallel, pinned by an assertion.

### ADR-010: `is_primary` is scoped to the company, not the person

§5 of the requirements says only `is_primary boolean`, and T-260828-21's
acceptance — "setting one primary clears the others" — reads equally well as
*which company is this person's main affiliation* or *which of the people we
know at this client is the main contact.* T-260828-21 implemented the
per-company reading and recorded why in a code comment; this promotes it to a
decision, and pins it with a test asserting one person can be primary at two
companies at once.

### The ADR-003 guard now catches the shape it was written for

The original rule grepped `/\bSUM\s*\(/i` — which catches an aggregate but
**not** the `monthlyValue(engagement)` helper that branches on `billingModel`
and multiplies hours by a rate, named in the task plan as the highest-risk
carry-over in this project and containing no `SUM` at all.

It now checks three shapes against source with comments and string literals
stripped: an aggregate, arithmetic in executable code, and a comparison or
`case` against a billing-model literal. `+` is deliberately exempt because every
refusal message concatenates with it.

**Proven, not asserted.** A synthetic `monthlyValue` fixture lives in the test
and is required to trip exactly two rules while matching no `SUM` — so the guard
stays measured after the next edit to either file, rather than being pasted into
`engagements.ts` and deleted again. Its header says plainly that it is a backstop
for review and not a replacement: a determined author can still evade it with a
lookup table keyed by model, or a helper in another file.

**Verified at merge:** typecheck clean across all three passes;
`node` + `runtime-boot-node`, 29 files / 627 tests green on the merged tree.

## The ADR number collision, and the gate now standing where it happened

This branch created `ADR-009-is-primary-scope.md`. T-260828-51, built in the
same wave, created `ADR-009-search-content-table.md` and merged first. **Both
were right when they chose** — each cut from a main where 009 was free — and
because the filenames differ, git merged both without a conflict and nothing
downstream complained.

The result is the harder kind of wrong: not a broken link, but two decisions
sharing one number, so every code comment citing ADR-009 becomes *ambiguous*
rather than incorrect. This one is renumbered **ADR-010**, with its frontmatter
and all four citations in `people.ts` and `people.test.ts` moved with it.

`npm run check:index` now refuses a duplicate ADR number, and also refuses a file
whose frontmatter `id` disagrees with its own filename — the filename is what a
reader greps and what a link resolves to, so a mismatch is its own defect. It
lives in that script rather than a new one because that script already runs at
every merge (the `index-gate` hook), in `verify`, and in `run-tasks`.

**Verified by probe:** a duplicate ADR-009 dropped into `.dev/decisions/` trips
both new rules; removed, the check is clean.
