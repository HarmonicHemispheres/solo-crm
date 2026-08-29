---
id: T-260828-51
title: Make search meet its latency budget — the union view cannot be indexed
status: done
category: data
plan_ref: P1-06
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge, with one documentation gap closed on top.

**Changed:** `electron/main/db/migrations/0003_search_content_table.sql` (new),
`migrations/index.ts`, `repositories/search.ts`, `search.latency.test.ts` (new),
`schema.ts`, `migrate.test.ts`, `connection.test.ts`,
`.dev/decisions/ADR-009-search-content-table.md` (new), and a *superseded in
part* pointer on ADR-008.

### What was wrong

`search_fts` is external-content and 0002 pointed `content='search_source'` at a
**view** whose `content_rowid` was the computed expression
`rowid * 8 + <kind code>`. FTS5 resolves that rowid back to a row for **every
result it returns**, and SQLite cannot index a computed expression inside a view
— so every lookup was a full scan of all five source tables, once per returned
row.

`search_source` is now a real table whose `content_rowid` is an
`INTEGER PRIMARY KEY`, which in SQLite makes it an alias for the table's own
rowid: the one key resolved in O(log n) with no index to build. The query plan
goes from five SCANs to
`SEARCH search_source USING INTEGER PRIMARY KEY (rowid=?)`.

The union view survives, renamed `search_source_live`, as the single written-down
definition of the five-table union and the rowid encoding. The migration's
backfill and `rebuildSearchIndex` both re-derive from it rather than each
restating the union, so a sixth searchable table still extends one view and one
trigger set.

### Why not a self-contained FTS5 table

Rejected **on correctness, not speed**, and recorded as ADR-009. SQLite detects
that an index has drifted from its source only by reading the content relation.
A self-contained table has no content relation to read, so it would have answered
a query over a stale index confidently and wrongly instead of raising
`SQLITE_CORRUPT_VTAB` — and T-260828-36's orphan-row guard, which this task's
scope required to survive unmodified, asserts exactly that error. Under the
rejected option that test could not have been kept.

### The measurement, and why it is not the whole test

The builder could not reproduce ADR-008's absolute numbers — same shapes, same
31,000 rows, same queries, different machine and fixture. Warm medians here:
union view 7.7–8.1 / 18.7–20.2 / 33.8–37.3 ms for `"acme"*` / `"engage"*` /
`"a"*`; materialised table 2.9 / 9.3–9.8 / 12.4–14.1 ms. A 2.6–3.0× ratio,
consistent with ADR-008's, on a machine where **the old shape would also have
passed the 100 ms budget**.

That is the finding worth keeping: *a latency-only benchmark would have been a
green light with nothing behind it.* `search.latency.test.ts` therefore asserts
the query plan as well as the budget, and its header says so. The builder said
plainly that it could not reproduce the original conditions rather than
presenting its own numbers as a match.

### Reviewed at merge

Three things checked directly rather than taken from the report:

- **ADR-008's append-only rule holds.** Nothing renumbers a kind code; the
  `rowid * 8 + <code>` encoding is byte-for-byte 0002's, so every rowid already
  in the index still means what it meant. The migration rebuilds anyway, because
  ADR-008 makes *any* change to what `content=` resolves to a full-rebuild
  change.
- **The name `search_source` is preserved.** `content='search_source'` is baked
  into the virtual table's `CREATE` statement in `sqlite_master`, so keeping the
  name means the virtual table and its inverted index need no drop and recreate.
- **Atomicity.** `migrate.ts` applies each migration in its own
  `db.transaction`, so the drop-view / create-table / backfill / retrigger /
  rebuild sequence is all-or-nothing.

`rebuildSearchIndex` had to grow rather than merely keep working: there are now
two trigger-maintained derived relations, and rebuilding only the index would
have faithfully reproduced a drifted content table. It now empties `search_fts`,
empties `search_source`, re-derives it from `search_source_live` and refills the
index — one transaction, that order.

**Verified at merge:** `node` + `runtime-boot-node` projects, 28 files / 587
tests green on the merged tree.

### Closed on top of the merge: a rule that had grown a third exception

AGENTS.md says every table gets a UUID primary key and
`created_at`/`updated_at`, excepting tables keyed by natural identity —
`settings` by key, `favicons` by host. `search_source` has none of them, and the
migration argues correctly that it is not a table of records at all but FTS5's
content relation, addressed only by `content_rowid` and holding no fact the five
source tables do not.

That argument lived only in the migration header, where **a future reader
checking the schema against AGENTS.md would have found an apparent violation and
"fixed" it.** AGENTS.md now names the exception and points at ADR-009.
