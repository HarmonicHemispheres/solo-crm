---
id: T-260828-56
title: Test the chain walk directly, and stop reporting a cycle as depth exceeded
status: done
category: data
plan_ref: 
created: 2026-08-28
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Deferred from T-260828-42's review. Two findings that compound.

**The discriminator is wrong.** `assertNoChainCycle` catches `ChainCycleError`
and `ChainDepthExceededError` in one branch and always emits
`billed-via-chain-depth-exceeded`, with text claiming the chain "already exceeds
50 steps without resolving". In the acceptance scenario the walk detects a
3-cycle at step 3 — nothing exceeded 50. So the operator is told something
untrue about their own data, and T-260828-26 cannot distinguish "this database
contains a cycle" from "this chain is absurdly long". T-260828-42's own
acceptance test bakes the conflation in by asserting the depth-exceeded reason
for a cycle. The same conflation exists in `seed/index.ts`.

**The traversal is unpinned.** `chain-walk.ts` is the only module in
`electron/main/db/` with no sibling test file, and its cycle branch is dead
code as far as the suite can tell: replacing the `seen.has(parentKey)` throw
with nothing leaves all 58 companies+seed tests green, because the repository's
own `chain.includes(selfId)` and the depth bound between them cover every case
the suite exercises. The depth cap is equally unpinned — `MAX_CHAIN_DEPTH`
50 → 4 also leaves the suite green, which is precisely the "a cap becomes a
policy" risk T-260828-42's own Risks section names.

## Scope

**In:**

- Two catch branches and two discriminators — a cycle and a depth overrun are
  different facts and each gets its own reason and its own sentence. Correct
  `seed/index.ts`'s message the same way.
- `electron/main/db/chain-walk.test.ts`, testing the primitive directly: a
  2-cycle and a 3-cycle each throwing `ChainCycleError` (**not**
  `ChainDepthExceededError`) well before `maxDepth`; a long non-cyclic chain
  throwing `ChainDepthExceededError`; `ChainCycleError.node` naming the repeated
  node.
- A test that accepts a chain deeper than any current test builds, so tightening
  the cap into a policy fails.
- Fix T-260828-42's acceptance test, which currently asserts the wrong reason.
- Give `INTRODUCED_BY_CHAIN_GUARD` distinct self-reference and transitive-cycle
  reasons, as `BILLED_VIA_CHAIN_GUARD` already has.
- Cover `createCompany`'s `introduced_by` guard, which can currently be deleted
  outright with the suite still green.
- Hoist the prepared statement out of `getParentId`'s closure — it currently
  compiles the same one-column SELECT once per step of the walk.

**Out:** Any change to what the billing pointer means (§5: a billing pointer,
never a hierarchy). The database `CHECK`, which cannot express reachability.

## Touches

- `electron/main/db/chain-walk.ts`
- `electron/main/db/chain-walk.test.ts` — new
- `electron/main/db/repositories/companies.ts` and its test
- `electron/main/db/seed/index.ts`

## Acceptance

- [ ] A pre-existing 3-cycle is refused with a **cycle** discriminator and a
      message that does not mention 50 steps
- [ ] A chain longer than `MAX_CHAIN_DEPTH` is refused with a **depth**
      discriminator, asserted separately
- [ ] Replacing the `seen.has(...)` throw with dead code makes at least one test
      fail — verified by performing the mutation
- [ ] `MAX_CHAIN_DEPTH` 50 → 4 makes at least one test fail
- [ ] Deleting `createCompany`'s `introduced_by` guard call makes a test fail
- [ ] A guarded write prepares its statement once, not once per step

## Risks

- **Changing a discriminator T-260828-26 may already switch on.** Grep the IPC
  layer before renaming; if a channel maps the old reason, that mapping moves in
  the same commit.
- **Testing the walk through the repository again.** The whole point is a direct
  test of the primitive — going through `createCompany` reproduces the coverage
  that already exists and misses the branch again.


---

## Outcome

Merged as `20ab952`. Built by a subagent under the build-only process
(T-260828-54's wave H); reviewed and gated by the orchestrator at merge.

**Changed:** `electron/main/db/chain-walk.ts`, `chain-walk.test.ts` (new),
`electron/main/db/repositories/companies.ts`, `companies.test.ts`,
`electron/main/db/seed/index.ts`.

**A cycle and a depth overrun are now different facts.** Both call sites caught
`ChainCycleError` and `ChainDepthExceededError` in one branch and reported the
depth message, so three rows pointing in a triangle produced a refusal telling
the operator their data "already exceeds 50 steps without resolving" — sending
whoever reads it to look for a chain that is not there. Each error now has its
own branch, its own sentence and its own discriminator, at both the repository
guard and the seed loader's fixture check.

**The chain walk is tested directly.** `chain-walk.test.ts` is new: the walk was
previously exercised only through the repositories that call it, which is what
let the conflated catch survive.

**Reason strings changed meaning**, which is the part worth a reader's attention:

| Fact | Before | After |
|---|---|---|
| `introduced_by` points at itself | `introduced-by-cycle` | `introduced-by-self-reference` |
| `introduced_by` would close a loop | `introduced-by-cycle` | `introduced-by-cycle` |
| The existing chain already loops | `*-chain-depth-exceeded` | `*-chain-cycle` |

`billed_via`'s `self-reference` is untouched — T-260828-20 established it
against a database `CHECK` constraint name, and a caller may already switch on
it. **Verified at merge:** the changed strings have no consumer outside the
repository and its own test, grepped across `electron/` and `planning/` on the
branch. No IPC channel maps any of them yet.

**Also, off the scope's path but in its files:** `assertNoChainCycle` compiled
its one-column `SELECT` once per step, so a 50-deep chain prepared the identical
statement 50 times. Hoisted to once per guarded write. `spec.column` is a fixed
literal from the two guard specs, never caller input, so the interpolation is as
safe hoisted as it was inline.

**Verified at merge:** `npm run typecheck` clean; the whole `node` project
528/528 in 8.45s on the merged tree.

## What the scope did not anticipate

`createCompany`'s `introduced_by` guard **cannot be covered by an ordinary
create**: a brand-new row's id cannot appear in any existing chain, so
`chain.includes(selfId)` can never fire on the create path. The test therefore
wires a two-row loop with raw inserts and asserts the create refuses with
`introduced-by-chain-cycle`. The `billed_via` twin of that case had the same
gap and got the same test.

A correction made while writing the depth tests: `maxDepth` bounds `getParent`
calls, not edges, so the longest chain that terminates is exactly `maxDepth`
nodes, not `maxDepth + 1`. The existing repository depth test was already on the
correct side of that line and needed no change.

**A hazard worth carrying forward.** The builder reverted an acceptance mutation
with `git checkout <file>` and silently lost the doc-comment edits it had made
to the same file earlier. It caught this by grepping for a marker and re-applied
them, and reverted the remaining mutations by targeted edit instead. Mutation
testing and `git checkout` are a bad pair on a file you are also authoring; this
is now in the subagent preamble.
