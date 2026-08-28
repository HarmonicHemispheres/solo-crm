---
id: T-260828-52
title: Record the search index's shape as an ADR — the union view and the rowid encoding
status: open
category: docs
plan_ref: P1-06
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

G6 settled that search would be "an external-content FTS5 table plus triggers on
all five source tables". It did not settle the two designs T-260828-36 had to
invent to make that work across five tables:

- the **`search_source` union view** that presents five tables as one content
  source, and
- the **`rowid * 8 + kind code`** synthetic rowid encoding that packs a source
  table and a source row into the single integer rowid FTS5 allows.

The second is a cross-cutting contract, not an implementation detail. Any future
migration that adds a sixth searchable table must extend the view and the kind
codes **in lockstep**, and must never renumber an existing code without a full
index rebuild — renumbering silently repoints every existing indexed row at the
wrong source table, and the failure surfaces as search results that name the
wrong records rather than as an error.

The migration header documents it thoroughly and well. But AGENTS.md puts durable
decisions in `.dev/decisions/` precisely so the next person finds them without
reading a migration they have no reason to open, and `architecture-review` reads
that directory. A rule that only exists inside the file it constrains is a rule
that gets broken by the next file.

There is also a live reason to write it now rather than later: **T-260828-51 may
replace the union view entirely.** An ADR that records why this shape was chosen,
what it costs, and what it forecloses is exactly the input that decision needs,
and writing it afterwards means reconstructing the reasoning from a diff.

## Scope

**In:** `.dev/decisions/ADR-008-search-index-shape.md`, following the format of
the existing ADRs — ADR-006 is taken by the data-root pointer (T-260828-17) and
ADR-007 by entity schemas in shared:

- The decision: external-content FTS5 over a union view, with a synthetic rowid.
- Why a union view at all — one FTS table has one content source, and G6 asked
  for one index across five tables.
- The rowid encoding, stated as a contract: how a source table maps to a kind
  code, that codes are append-only, and that renumbering requires a full rebuild.
- What it forecloses, since this is the part a header comment tends to omit: the
  content view must never be named `search_fts_content` (the shadow-table name
  FTS5 reserves — T-260828-36's review found this and it is why the view is
  called `search_source`), and `content_rowid` being a computed expression is
  what makes the index unservable, which is T-260828-51's whole subject.
- The measured cost, carried from T-260828-36's review: 95 / 488 / 581 ms at 10×
  volume against a 100 ms budget, versus 13.8 / 124 / 41 ms self-contained.
- A pointer to T-260828-51 as the open question, so the ADR reads as a decision
  under review rather than a settled one.

**Out:** Making the decision — T-260828-51 owns whether the shape changes. This
task records what was built and why, including the parts that are now known to be
wrong. Any code change at all.

## Touches

- `.dev/decisions/ADR-008-search-index-shape.md` — new
- `electron/main/db/migrations/0002_search_fts.sql` — a header pointer to the ADR
- Possibly `AGENTS.md`, if the append-only kind-code rule belongs in the gotchas

## Acceptance

- [ ] The ADR states the kind-code contract explicitly enough that someone adding
      a sixth searchable table would know what they must not do
- [ ] It records the reserved `search_fts_content` name and why the view is
      called `search_source` — a future rename would otherwise reintroduce it
- [ ] It carries the measured latency numbers, not a description of them
- [ ] It names T-260828-51 as the open question rather than presenting the shape
      as settled
- [ ] Migration 0002's header points at the ADR
- [ ] `architecture-review` reading `.dev/decisions/` would now find this before
      approving a sixth searchable table

## Risks

- **Writing it as documentation rather than as a decision.** An ADR that restates
  what the SQL does adds nothing; the value is the reasoning, the alternatives,
  and what the choice costs. `.dev/README.md` is explicit that decisions are not
  month-scoped precisely because they keep binding.
- **Recording it as settled** when T-260828-51 may overturn it within the week.
  It should read as "this is what we built, here is the measurement that puts it
  in question".
