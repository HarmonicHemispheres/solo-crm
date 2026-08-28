---
id: T-260828-42
title: Refuse a billed-via cycle in the repository, as the seed loader already does
status: open
category: data
plan_ref:
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Found by review on T-260828-20 and deferred as out of that task's scope.

The database `CHECK` blocks only self-reference — `billed_via_company_id != id`.
A two-step cycle passes: create B billed via A, then update A to be billed via B,
and the pointer chain is A → B → A. Nothing refuses it.

The codebase already treats this as invalid data. `orderCompaniesForInsert` in
`electron/main/db/seed/index.ts` refuses exactly this case and says so in its own
comment — *"a genuine cycle (two companies billed via each other) fails loudly
here"*. So the seed loader is stricter than the repository that is the app's only
write path, which re-opens the hole the seed loader closed.

It matters because the pointer is meant to answer one question — *who do I
actually invoice* — and answering it means walking the chain. A cycle makes that
walk loop forever, in code that has not been written yet and will not obviously
be at fault when it hangs.

## Scope

**In:**

- A cycle check in `createCompany` and `updateCompany`: before writing
  `billed_via_company_id`, walk the existing chain from the proposed target and
  refuse if it reaches the row being written. Same `RefusalError` shape and
  `blocker` discriminator as the other refusals, so T-260828-26 does not have to
  string-match.
- A bounded walk — refuse on depth exceeded as well as on a detected cycle, so a
  pre-existing bad chain in an old database cannot hang the check itself.
- The equivalent guard on `introduced_by_company_id`, which is the same
  self-referencing shape and has the same problem.
- Reuse the traversal `seed/index.ts` already implements rather than writing a
  second one, or extract it so both call the same function.

**Out:** A database-level constraint — SQLite cannot express reachability in a
`CHECK`, which is why this lives at the repository boundary. Any change to what
the pointer means (§5: a billing pointer, never a company hierarchy). The
`billing_company_id` / `client_company_id` pair on engagements, which are
independent columns and cannot cycle.

## Touches

- `electron/main/db/repositories/companies.ts`
- `electron/main/db/seed/index.ts` — extract the shared traversal
- `electron/main/db/repositories/companies.test.ts`

## Acceptance

- [ ] Creating B billed via A, then updating A billed via B, is refused with a
      reason naming both companies — the exact sequence review reproduced
- [ ] A three-company cycle A → B → C → A is refused at the closing edge
- [ ] A legitimate chain A → B → C with no cycle is accepted
- [ ] The refusal carries a `blocker` discriminator, not just a message
- [ ] A database that already contains a cycle does not hang the check — the
      walk is bounded and refuses on depth exceeded
- [ ] `introduced_by_company_id` is guarded by the same code path, asserted
      separately
- [ ] The seed loader and the repository call one traversal, not two

## Risks

- **The walk running on every write.** It only needs to run when the pointer
  column is actually part of the patch; running it unconditionally puts a
  recursive query behind every company rename.
- **Refusing legitimate deep chains.** A depth cap set too low turns a valid
  four-deep billing arrangement into a refusal. Set it high enough to be a
  runaway guard rather than a policy.
- **§5's modelling note.** Adding a cycle guard makes the pointer feel more like
  a hierarchy; it is not one, and no helper here should start walking it as if
  companies had parents.
