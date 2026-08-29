---
id: ADR-008
title: The search index is one external-content FTS5 table over a five-table union view, addressed by a synthetic rowid
status: accepted
date: 2026-08-28
---

## Context

G6 settled the mechanism for §6.9's command palette: "an external-content FTS5
table plus triggers on all five source tables" — `companies`, `people`,
`engagements`, `tasks` and `activity`. T-260828-36 had to turn that sentence
into a schema, and two problems in it had no answer in G6 itself.

**A `content=` table names exactly one physical relation.** FTS5's
external-content option (`content=`, `content_rowid=`) is built for the
one-table case: an index that shadows a single source table and never stores
a second copy of its text. G6 asks for one index spanning five tables with no
table of tables to point `content=` at. `search_source`
([0002_search_fts.sql](../../electron/main/db/migrations/0002_search_fts.sql))
is a `UNION ALL` view over all five, each branch projecting the same three
columns (`kind`, `source_id`, `text`) so the view reads, to FTS5, as the
single relation `content=` requires.

**One content relation needs one rowid space, and five source tables each
already have their own.** Every one of the five tables is a plain rowid
table (none declared `WITHOUT ROWID`), so each carries its own 64-bit SQLite
rowid, and those five ranges collide — company rowid 1, person rowid 1 and
task rowid 1 are three different rows. `content_rowid` has to name a single
column that is unique across the whole view. The migration's header states
the fix as a formula: `<source table's own rowid> * 8 + <kind code, 0–4>`,
computed identically in the view and in every trigger. Reserving the low 3
bits for a kind code (5 codes fit in 3 bits, with room to spare) keeps each
table's encoded range disjoint from every other's, leaving 61 bits of
headroom per table — far beyond anything this app's data volumes approach.

**The obvious content-view name is the wrong one.** FTS5 reserves
`<table>_content` as the shadow-table name it creates for a *self-contained*
`search_fts` (no `content=` at all). T-260828-36's review named the view
`search_fts_content` first, on the natural instinct that it should read as
"the content behind `search_fts`". Verified by hand during that review:
`DROP TABLE search_fts; CREATE VIRTUAL TABLE search_fts USING fts5(...)`
with no `content=` option fails with `error creating shadow table
search_fts_content: view 'search_fts_content' already exists` when the view
already holds that name, and succeeds once it is renamed. Nothing broke in
the shipped migration — the review caught it before the name shipped — but
had it gone out under that name, undoing it would have meant a migration
against every existing database rather than a one-line rename before the
first release.

## Decision

`search_fts` is a genuine external-content FTS5 table
(`content='search_source', content_rowid='content_rowid'`) — its own shadow
tables hold the inverted index only, never a second stored copy of `name` /
`title` / `body`. It is fed by `search_source`, a view unioning all five
source tables, addressed by a synthetic rowid:

```
content_rowid = <source table's own SQLite rowid> * 8 + <kind code>
```

The view is named `search_source`, never `search_fts_content` or any other
name of the shape `<virtual-table-name>_content` — that shape is reserved by
FTS5 for a self-contained table's own shadow table, and a view already
occupying it forecloses ever dropping and recreating `search_fts` as
self-contained (see Context).

**The kind-code table is a contract, not an implementation detail. It binds
every future migration that touches search:**

| Code | Table | Column |
|---|---|---|
| 0 | `companies` | `name` |
| 1 | `people` | `name` |
| 2 | `engagements` | `name` |
| 3 | `tasks` | `title` |
| 4 | `activity` | `body` |

- **Codes are append-only.** A sixth searchable table takes the next unused
  code (5) and extends both `search_source`'s `UNION ALL` and the trigger set
  in lockstep — the view and the triggers must agree on every table's code or
  the rebuild-vs-incremental equivalence test (`search.test.ts`) catches the
  divergence the moment it is introduced.
- **A code is never renumbered, reused, or reassigned to a different table.**
  Renumbering does not fail loudly. It silently repoints every already-indexed
  row of that kind at whatever table now owns the new number — the read path
  (`searchAll`, `electron/main/db/repositories/search.ts`) trusts the `kind`
  column FTS5 hands back and never re-derives it from the encoded rowid, so a
  renumbered code surfaces as search results naming the wrong kind of record
  for rows that were never touched, not as an error anywhere near the change.
  The only correct way to change a code's meaning is a full index rebuild
  (`rebuildSearchIndex`) run as part of the same migration that changes the
  mapping.
- **3 bits are reserved for the code (8 slots, 5 used).** A seventh or eighth
  table fits in the existing encoding with no format change; a ninth does not
  and would need the shift width itself revisited, which is also a
  full-rebuild change for the same reason as renumbering.

## Consequences

**Easier — no second copy of the text to keep in sync.** Because `search_fts`
is genuinely external-content, `companies.name` (or `people.name`,
`tasks.title`, …) is the only stored copy of that string. A rename is one
write to the source table; the `AFTER UPDATE` trigger's delete-then-insert
re-derives the indexed terms from the row FTS5 is pointed at, not from a
duplicate the trigger would otherwise have to keep byte-for-byte identical.

**Easier — one index, one query, across five tables.** `searchAll` issues one
`MATCH` against one virtual table and gets back a single relevance-ranked
list spanning companies, people, engagements, tasks and activity, with no
fan-out query per table and no merge-and-re-rank step in the repository.

**Cost — measured, not assumed.** T-260828-36's review benchmarked the union
view at 10× the requirements' own reference volume (≈31,000 indexed rows)
against §8's 100 ms budget:

| Query | Union view | Self-contained FTS5 |
|---|---|---|
| `"acme"*` | 95 ms | 13.8 ms |
| `"engage"*` | 488 ms | 124 ms |
| `"a"*` | 581 ms | 41 ms |

`"a"*` is the query the palette issues after the very first keystroke of
every search anyone ever types — not a pathological input chosen to make the
shape look bad. Two of the three queries miss the budget by 5–6×.

**Forecloses an indexable `content_rowid` — the cause of the cost above, and
the whole reason it forecloses it.** `content_rowid` is a computed
expression (`rowid * 8 + kind code`) over a view, not a stored column, and
SQLite cannot build an index over a computed expression in a view the way it
can over a real column. `EXPLAIN QUERY PLAN` shows a full scan of all five
source tables for every row FTS5 returns, which is exactly what the latency
table above is measuring. This is the shape's central forecloser, and it is
T-260828-51's whole subject: whether to keep external-content and make
`content_rowid` reference a real materialised column or table instead of a
computed view expression, or move to a self-contained table and accept a
second stored copy of the text. **That decision is not made here** — this
ADR records what was built, why, and what it costs; T-260828-51 owns whether
the shape changes, using the numbers above as its input.

**Forecloses ever naming the content view `search_fts_content`,
permanently.** Not a preference — verified by hand (Context). Any future
rework of `search_source` (T-260828-51 included) must keep clear of that
exact name, view or table, for as long as `search_fts` (or any FTS5 table
with that name) might ever be dropped and recreated self-contained.

## Alternatives

**A contentless FTS5 table (`content=''`).** Rejected: a contentless table
stores no queryable copy of `kind` / `source_id` / `text` at all — `rank`
and the matched rowid come back, but the columns a result needs to point at
its source record do not. `searchAll` would need a second lookup per result
row against whichever table the encoded rowid names, adding a query the
external-content design exists to avoid, for no offsetting benefit — the
storage this would save is exactly the storage external-content already
avoids duplicating.

**Five separate FTS5 tables, one per source table, unioned in the query
instead of the schema.** Rejected: this makes every `searchAll` call five
prepared statements merged and re-ranked in application code, since FTS5's
`rank` is only comparable within one virtual table, not across five separate
ones — the ranked, single-list result G6 and §6.9 ask for would have to be
reconstructed by hand on every read instead of coming from one `ORDER BY
rank`. It also does not remove the fan-out cost the union view's own
Consequences describe; it just moves the fan-out from the storage layer
(`search_source`'s scan) to the query layer (five statements per call),
without the property of the single view — one `MATCH`, one rank order — that
made the chosen shape worth its cost in the first place.

**A self-contained `search_fts` table, decided now rather than deferred to
T-260828-51.** Rejected for *this* task on timing, not on the merits: G6
specified external-content, and the cost was not a known quantity until
T-260828-36's review measured it. Building self-contained from the start
would have traded a real correctness guarantee — SQLite detects content drift
against an external-content table's source and raises `SQLITE_CORRUPT_VTAB`
if it disagrees with what the triggers indexed — for a speed nobody had
confirmed was needed yet, without a number to weigh the trade against. That
number exists now; T-260828-51 is where the trade gets decided.

**Reusing a source table's own `id` (UUID text) as `content_rowid`.**
Rejected: FTS5's `content_rowid` must be an integer usable as the shadow
tables' own rowid; every source table's `id` is a `TEXT` UUID primary key
(AGENTS.md's own convention for every table in this schema), not an integer,
so it cannot serve as `content_rowid` directly. The `rowid * 8 + kind code`
encoding exists because the tables' implicit integer rowids were the only
integer available to build a cross-table-unique key from.
