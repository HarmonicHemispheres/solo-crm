---
id: T-260828-40
title: Build the Workspace Data view — live database facts, table counts, query console
status: done
category: ui
plan_ref: X-01
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge.

**Changed:** `electron/main/db/stats.{ts,test.ts}` (new), `ipc/registry.{ts,test.ts}`,
`shared/{ipc-types,settings}.ts`, `renderer/routes.tsx`,
`views/WorkspaceData.{tsx,css,test.tsx}` (new),
`views/workspace-data-facts.ts` (new), `WorkspaceSettings.test.tsx`,
`components/shell/Shell.test.tsx`, `lib/test-support/stub-crm.ts`.

### It uses the query channel as designed

All three of the `db:query` contract's sharp edges were handled rather than
assumed. Rows are rendered from the **positional arrays** keyed by the separate
`columns` array, so a four-table join naming `id` four times keeps all four. The
timeout and row limit stay **main-side constants** — the console cannot raise its
own ceiling, and nothing was added to the request schema. Refusals surface their
**own** message and code from `QUERY_REFUSAL_CODES`, rather than being replaced
with a generic error, which is the whole point of `readonly-connection.ts`
returning refusals as data instead of throwing.

### Three things the scope did not name

1. **Saved snippets needed a settings key.** `view.data.snippets` was added to
   `SETTINGS_REGISTRY` (an array of `{ name, statement }`, default `[]`), which
   forced three mechanical follow-ons in `SettingsSnapshot` literals and
   `WorkspaceSettings.test.tsx`'s key-exhaustiveness list — whose own comment
   already sanctions a key belonging to a view rather than to the settings page.
2. **`db:stats` reads through a new `electron/main/db/stats.ts`,** not logic
   inside `registry.ts`. The Touches list named only `registry.ts`, but that file
   holds handlers, not queries — and the new module is where the "never cache
   this" argument and the FTS shadow-table exclusion belong.
3. **`Stat.tsx` needed no change at all** — it already carried hero/good/bad
   tones and a meta slot. Reported rather than edited for the sake of matching
   the Touches list.

It stayed out of `lib/query-keys.ts` because T-260828-50 owned it concurrently,
building the stats key inline as `[...queryKeys.db.all(), 'stats']` — still under
`invalidate.db`'s `['db']` prefix, so a factory entry can move there later
without changing invalidation behaviour.

An `react-refresh/only-export-components` lint failure was fixed by splitting the
pure helpers into `views/workspace-data-facts.ts`, following the `nav.ts`
precedent — **not** by disabling the rule.

**Verified at merge:** typecheck clean across all three passes, `node` +
`renderer` projects green on the merged tree.

## One thing left deliberately null

Last backup and last integrity check cross the wire as `null` — nothing writes
either until X-04/X-05 land. The view renders "never" and "unchecked" rather
than inventing a figure, which is the right call: a Data view whose job is to
state database facts must not be the first place in the app to make one up.
