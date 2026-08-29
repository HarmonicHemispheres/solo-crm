---
id: T-260828-51
title: Make search meet its latency budget — the union view cannot be indexed
status: in-progress
category: data
plan_ref: P1-06
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

T-260828-36's review **measured** this rather than suspecting it, which is why it
is a task and not a note.

`search_fts` is external-content over a union view, and its `content_rowid` is a
computed expression over that view. No index can serve a computed expression, so
`EXPLAIN QUERY PLAN` shows a full SCAN of all five source tables **per returned
row**. At the requirements' own 10× volume (31,000 indexed rows):

| Query | Union view | Self-contained FTS5 |
|---|---|---|
| `"acme"*` | 95 ms | 13.8 ms |
| `"engage"*` | 488 ms | 124 ms |
| `"a"*` | 581 ms | 41 ms |

§8 asks for under 100 ms at 10× current data, and T-260828-37 asks for palette
results "within one frame of a keystroke". Two of those three queries miss the
budget by 5–6×, and `"a"*` is not a pathological input — it is what the palette
sees after the first keystroke of every search anyone ever types.

This was not a mistake in T-260828-36. G6 specified "external-content FTS5 table
plus triggers" and that is what was built; the union view is the only way to make
one FTS table span five source tables, and the cost only shows up under
measurement at volume. The decision needs revisiting now that there is a number.

## Scope

**In:**

- Decide between the two shapes, with the measurement above as the input:
  **(a)** keep external-content and make `content_rowid` indexable — a real
  materialised column or table rather than a computed expression over a view; or
  **(b)** move to a self-contained FTS5 table, accepting that the index holds its
  own copy of the text and that the triggers become the only thing keeping it
  honest.
- Whichever is chosen, keep every guarantee T-260828-36 established: the
  `INSERT … DELETE … INSERT` orphan test, the rebuild-equals-incremental test,
  the delete-all guard, and `ORDER BY rank` — all four already have tests that
  fail without them, and those tests must survive the change unmodified.
- Re-measure at 10× volume and record the numbers in the outcome, so the next
  person inherits a measurement rather than a claim.
- A benchmark that fails the build when the budget is missed, or an explicit
  statement of why it is checked by hand instead. X-07 owns the general
  performance harness; this is the one query that already has a number.

**Out:** Changing what is searched — the five tables G6 names, no more. Fuzzy or
typo-tolerant matching. The palette UI (T-260828-37), which consumes this.

## Touches

- `electron/main/db/migrations/` — a new migration; 0002 has shipped
- `electron/main/db/repositories/search.ts` and its test
- Possibly `electron/main/db/schema.ts`

## Acceptance

- [ ] `"a"*` at 10× volume (≈31,000 indexed rows) returns in under 100 ms,
      measured and recorded — the query the palette issues after one keystroke
- [ ] `"acme"*` and `"engage"*` likewise, with before/after numbers in the outcome
- [ ] `EXPLAIN QUERY PLAN` no longer shows a full scan of the source tables per
      returned row
- [ ] All four of T-260828-36's guards still pass **without their tests being
      modified** — if a test needs changing, a guarantee was dropped
- [ ] The new migration applies cleanly on a database already at version 2,
      including one carrying the seed fixture
- [ ] Renaming a company still changes its search result with no rebuild step

## Risks

- **Trading a correctness guarantee for speed.** A self-contained table stops
  SQLite from detecting content drift at all — the `SQLITE_CORRUPT_VTAB` that
  currently surfaces an orphan row would simply not fire, and a stale index would
  return confidently wrong results instead of failing. If (b) is chosen, that
  detection has to be replaced, not lost.
- **Measuring on a warm cache.** The numbers above came from a specific harness;
  reproduce the same conditions or the comparison is meaningless.
- **Doing this while T-260828-37 is in flight.** The palette consumes `searchAll`;
  either land this first or keep the signature stable.
