---
id: ADR-009
title: search_fts stays external-content, and its content relation becomes a materialised table rather than a union view
status: accepted
date: 2026-08-29
---

## Context

[ADR-008](ADR-008-search-index-shape.md) recorded what T-260828-36 built and
what it cost, and named its own successor: the cost was measured, the trade
was not made there, and T-260828-51 owned the decision.

The cost has one cause. `search_fts` is external-content over the view
`search_source`, and its `content_rowid` is the computed expression
`rowid * 8 + <kind code>` over that view. FTS5 resolves that rowid back to a
row once for every result it returns — `kind` and `source_id` are `UNINDEXED`
and `text` is not stored in the index either, so *every* column of *every*
returned row comes from the content relation. SQLite cannot index a computed
expression inside a view, so each of those lookups planned as five full
scans:

```
EXPLAIN QUERY PLAN SELECT content_rowid, kind, source_id, text
                   FROM search_source WHERE content_rowid = ?
  → COMPOUND QUERY / LEFT-MOST SUBQUERY
    SCAN companies … SCAN people … SCAN engagements … SCAN tasks … SCAN activity
```

At 25 results a query, that is 25 five-table scans per keystroke. §8 asks for
under 100 ms at 10× the reference volume; T-260828-36's review measured 95 /
488 / 581 ms for `"acme"*` / `"engage"*` / `"a"*`, and `"a"*` is what the
command palette (T-260828-37) issues after the first keystroke of every
search anyone ever types.

The choice T-260828-51 was scoped to make: **(a)** keep external-content and
give `content_rowid` something indexable to be, or **(b)** move to a
self-contained FTS5 table, which stores its own copy of the text and needs no
content relation at all.

## Decision

**(a).** `search_fts`'s declaration does not change at all. `search_source`
stops being a view and becomes a real table
([0003_search_content_table.sql](../../electron/main/db/migrations/0003_search_content_table.sql)):

```sql
CREATE TABLE search_source (
  content_rowid INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  text TEXT
);
```

`INTEGER PRIMARY KEY` makes `content_rowid` an alias for the table's own
rowid, so FTS5's per-result lookup becomes
`SEARCH search_source USING INTEGER PRIMARY KEY (rowid=?)` — a seek, with no
index to build and none to keep in sync.

The union of the five source tables survives, renamed `search_source_live`,
as the written-down *definition* of what the materialised table should hold.
Nothing on the query path touches it; the migration's backfill and
`rebuildSearchIndex` both re-derive from it, so the five-table union and the
rowid encoding are still stated exactly once. The fifteen triggers now
maintain the content table and the index together.

Three things deliberately do not change:

- **The kind codes and the `rowid * 8 + <code>` encoding.** ADR-008 makes the
  codes append-only and any change to one a full-rebuild change. Nothing here
  renumbers anything, so every rowid already in `search_fts` still means what
  it meant. The migration rebuilds the index anyway, because ADR-008's rule
  is about what `content=` resolves to and this changes that.
- **The name `search_source`.** `content='search_source'` is baked into
  `search_fts`'s `CREATE VIRTUAL TABLE` statement in `sqlite_master`; keeping
  the name means the virtual table and its shadow tables need no drop and
  recreate.
- **The prohibition on `search_fts_content`** (ADR-008, verified by hand
  there). Still reserved by FTS5, still unused.

### Why not (b), self-contained

Because SQLite can only detect that an index has drifted from its source by
*reading the source*. An external-content table that holds a row whose
content row is missing raises `SQLITE_CORRUPT_VTAB` on the next query that
touches it — loudly, at the point of the read. A self-contained table has
nothing to disagree with: a stale or orphaned row is simply a row, and the
query returns it, confidently and wrongly, naming a record that no longer
exists or no longer says what the index says it says. In an app whose triggers
are the only thing keeping the index honest, that detection is not a
nice-to-have; it is the failure mode that would otherwise be silent.

T-260828-51's acceptance criteria made this concrete: T-260828-36's four
guards had to survive **unmodified**, and one of them plants an orphan row and
asserts `SQLITE_CORRUPT_VTAB`. Under (b) that test could not have been kept —
which is the criterion doing exactly what it was written to do, since ADR-008
and the task's Risks both said in advance that losing drift detection was the
price of (b) and that it would have to be replaced rather than dropped.

Self-contained was also the *faster* of the two in T-260828-36's numbers, and
it is still not obviously cheaper on storage: (a) stores the text twice (source
table plus content table), (b) stores it twice as well (source table plus the
index's own `%_content` shadow table). The trade was never storage. It was a
correctness guarantee against a difference that measurement says is not needed
— both shapes clear the budget with room.

## Consequences

**Measured, on one harness, median of 7 warm runs at 31,000 indexed rows,
`LIMIT 25`, idle 8-core Windows machine:**

| Query | view (0002) | table (0003) |
|---|---|---|
| `"acme"*` | 7.7–8.1 ms | 2.9 ms |
| `"engage"*` | 18.7–20.2 ms | 9.3–9.8 ms |
| `"a"*` | 33.8–37.3 ms | 12.4–14.1 ms |

Cold (a fresh read-only connection per timing, median of 5): 10.3 / 20.8 /
38.5 ms before, 3.9 / 9.9 / 12.4 ms after.

**These absolutes are much lower than ADR-008's 95 / 488 / 581 ms, and the
difference is the harness, not the fix.** Same shapes, same volume, same
queries, a different machine and a different fixture — the ratio (2.6–3.0×)
and the query plan are what carry across; the absolute baseline does not.
Stated plainly because it decides what the check in `search.latency.test.ts`
can rest on: **on this harness the old shape would also have passed the 100 ms
budget.** So that file asserts two things — the budget, which is the
requirement, and the query plan, which is what actually catches a return to
the shape this ADR replaces. A latency threshold alone would have been a
green light with nothing behind it.

**`rebuildSearchIndex` now repairs two relations, not one.** The content
table is trigger-maintained and can therefore drift, and rebuilding only the
index would have faithfully reproduced a drifted content table. It empties
`search_fts`, empties `search_source`, re-derives it from
`search_source_live`, and refills the index — one transaction, in that order.

**A sixth searchable table is now a three-place change, not two.** The
`search_source_live` view, the trigger set, and (unchanged) the kind-code
contract in ADR-008. The rebuild-vs-incremental equivalence test still catches
a divergence between view and triggers the moment it is introduced.

**`search_source` is a table that breaks AGENTS.md's UUID-key and
`created_at`/`updated_at` rule, on purpose.** It is not a table of records: it
is FTS5's content relation, addressed only by `content_rowid`, holding no fact
that is not already in one of the five source tables, and nothing holds a
foreign key to it. This is narrower than ADR-002's `settings`/`favicons`
exemption class — those are keyed by an externally-unique natural key; this is
keyed by a derived integer and is fully reconstructible from other tables at
any time.

## Alternatives

**A `STORED` generated column on each source table, indexed, keeping the
view.** Rejected: it needs a schema change to all five source tables plus five
new indexes to speed up a lookup that the materialised table answers with no
index at all, and the view would still be a five-branch compound query that
SQLite plans as a scan per branch even with each branch's constraint pushed
down. More moving parts, more storage, and a worse plan.

**Keeping the view and having `searchAll` do its own per-result lookup by
decoding the rowid.** Rejected: this is the second-lookup-per-row cost ADR-008
rejected contentless FTS5 for, moved into application code — and it would put
the kind-code decoding on the read path, which ADR-008 specifically records as
something `searchAll` must *not* do (it trusts the `kind` column FTS5 returns
and never re-derives it, which is what keeps a renumbered code from being a
read-path bug as well as an index bug).

**Deciding by benchmark alone and taking (b) for being fastest.** Rejected on
the record above: both shapes clear §8's budget on the measured harness, so
speed had stopped being the discriminator by the time the decision was made.
The remaining difference was whether SQLite would still tell us when the index
had gone wrong.
