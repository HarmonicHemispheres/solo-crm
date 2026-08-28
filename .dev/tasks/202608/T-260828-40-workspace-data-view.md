---
id: T-260828-40
title: Build the Workspace Data view — live database facts, table counts, query console
status: open
category: ui
plan_ref: X-01
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/workspace/data` is empty, which is the other blank page the user hit. It is
also the page that makes a local-first app trustworthy: the whole promise is that
the data is a file you own, and this is where the file stops being an abstraction
— its size, its path, its journal mode, its schema version, and what is actually
in it.

Covers **X-01 and X-03 together**, because they are one screen: the per-table
row counts and the console are not independently useful, and X-03's own
acceptance ("clicking a table loads `SELECT * FROM <table> LIMIT 20` into the
console") only means anything when both are on the same page.

## Scope

**In:** The Data view body:

- **Database facts** — size, page size, WAL size, path (copyable to clipboard),
  journal mode, schema version and last migration date, last backup, last
  integrity check. Every figure read **live from the file**, not cached at boot.
- **Per-table row counts** with relative size bars, one row per table.
- Clicking a table loads `SELECT * FROM <table> LIMIT 20` into the console.
- **Query console** over T-260828-39's `db:query`: statement input, results as a
  table with row count and execution time, and refusals shown with **their own
  reason**, never a generic failure.
- **Saved snippets** for common questions, stored through the settings
  repository (T-260828-25).
- The `db:schemaVersion` channel already exists from T-260828-09 and was built
  for exactly this panel — reuse it rather than adding a second reader.

**Out:** The read-only query channel itself (T-260828-39) — this task is unbuildable
without it. Maintenance actions — export snapshot, `VACUUM` + `ANALYZE`,
`integrity_check` — are X-05 and are writes; this page may display the *result*
of the last integrity check but does not run one. The nightly backup (X-04);
this page shows when the last one ran.

## Touches

- `electron/renderer/views/WorkspaceData.tsx` — new
- `electron/renderer/routes.tsx` — replace the `/workspace/data` placeholder
- `electron/shared/ipc-types.ts`, `electron/main/ipc/registry.ts` — a
  `db:stats` channel for the live file facts
- `electron/renderer/components/primitives/Stat.tsx`, `Card.tsx` — consumed

## Acceptance

- [ ] Every figure is read live from the file — changing the database and
      revisiting the view shows the new size and counts with no restart
- [ ] Clicking a table loads `SELECT * FROM <table> LIMIT 20` into the console
      and running it returns rows
- [ ] The database path copies to the clipboard, and the copied string opens the
      file on this machine
- [ ] A rejected statement shows **its** reason — the one T-260828-39 produced —
      not a generic failure message
- [ ] Execution time and row count are shown for every successful run
- [ ] A saved snippet survives a restart
- [ ] The path shown is under `app.getPath('userData')`, and the view states
      plainly that a Drive/Dropbox/iCloud location is refused (AGENTS.md, the
      sync-folder guard from T-260828-06)
- [ ] Row-count bars are relative and readable at both extremes — one table with
      20k rows next to one with 3
- [ ] Keyboard operable; the console is reachable and runnable without a mouse

## Risks

- **Caching the stats at boot** because reading them on every render feels
  wasteful. X-01's first acceptance criterion exists because a stale size figure
  is worse than none — it is the number a person checks *because* they suspect
  something changed.
- **Swallowing the refusal reason** behind a generic toast, which undoes the
  explicit-rejection requirement (§6.12) that T-260828-39 went to trouble to
  produce.
- **A raw path or stack trace in an error message.** The boundary rule from
  T-260828-09 still applies here even though the path is legitimately displayed
  in the facts panel — displayed deliberately is not the same as leaked in an
  error.
- **Growing this page into analytics.** Its purpose is to keep that pressure
  off the rest of the UI (§6.12); a chart here defeats it.
