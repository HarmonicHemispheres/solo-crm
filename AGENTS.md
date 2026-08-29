# Solo CRM

A local-first CRM for a one-person consultancy. Electron shell · React + Vite +
TypeScript renderer · better-sqlite3 + Drizzle in main · TanStack Query over
typed IPC · SQLite FTS5. See [README](README.md) for the why.

**Status: toolchain scaffolded (T-260828-03); no feature code yet.** Build
order is [planning/solo-crm-taskplan.md](planning/solo-crm-taskplan.md).

## How work happens

New behaviour starts with `scope-task`, not with an edit — it writes scopes to
`.dev/tasks/` for the user to approve or cut before any code exists. `run-tasks`
builds the approved ones. **It never starts on its own**; fanning out subagents
and merging into the working branch needs an explicit go. `verify` and the
built-in `code-review` are the gates, and neither is optional.

A one-line fix skips all of this. The process is for work worth a record.

A status change is not done until the month `INDEX.md` says so. `npm run
check:index` is the gate — `verify` runs it last, and `run-tasks` runs it at
every merge. The index is what the user reads to know what is happening, so a
stale one is a false report, not untidiness.

[.dev/README.md](.dev/README.md) is the full procedure — pipeline, status and
category vocabulary, which review each category triggers. Development context is
written there, never into the working tree.

## References

- [planning/solo-crm-mockup.html](planning/solo-crm-mockup.html) — **the
  authoritative visual spec.** Open it rather than inferring the look from prose.
  Its CSS variables become `tokens.css` verbatim. One exception: the mockup's
  **Pipeline** nav item is deliberately not ported — dropped by
  [ADR-005](.dev/decisions/ADR-005-pipeline-view.md); its absence is a decision,
  not an omission to fix.
- [planning/solo-crm-requirements.md](planning/solo-crm-requirements.md) — scope,
  data model, integrations, non-functional requirements.
- [CONVENTIONS.md](CONVENTIONS.md) — date, timestamp and money representations.
  The zod schemas in `electron/shared/` are the enforcement; read this before
  writing anything that stores or crosses IPC with either.
- [.claude/rules/ui-design.md](.claude/rules/ui-design.md) — design principles,
  loaded automatically when working on renderer or CSS files.

## Gotchas

Things that are silently wrong rather than loudly broken:

- **The database file must never live in a Drive, Dropbox or iCloud folder.**
  File-sync daemons and SQLite corrupt each other. By default it belongs in
  `app.getPath('userData')`; the data root can be moved via the
  `data-location.json` pointer file
  ([ADR-006](.dev/decisions/ADR-006-data-root-pointer-file.md)), but every
  path a pointer names still resolves through `resolveDatabasePath()` and
  still runs through this same sync-folder guard — never a second, unchecked
  way to open the database.
- **The renderer never touches SQLite or the filesystem.** `contextIsolation`
  on, `nodeIntegration` off, everything over typed IPC through `window.crm.*`.
- **Never call a third-party favicon service.** It leaks every client URL and
  breaks offline. Main fetches once and caches in the `favicons` table.
- **Integrations are pull-only.** Solo CRM never writes back to Stripe, Notion,
  Drive, Calendar or Gmail. That constraint is what stops it becoming another
  thing to maintain.
- **Revenue reads from `revenue_lines`.** The mockup fakes it with hardcoded
  arrays and per-model branching computed live off engagement columns. Porting
  that would undo the decision that every revenue question is one
  `SUM … GROUP BY` (task plan G5, the highest-risk carry-over in the project).
- **Every table gets a UUID primary key and `created_at` / `updated_at`** —
  except tables keyed by natural identity (`settings` by key, `favicons` by
  host), see
  [ADR-002](.dev/decisions/ADR-002-settings-key-value-table.md). Costs
  nothing now; makes a later Turso/libSQL sync a drop-in rather than a rewrite.
- **Hours are derived from `time_entries`.** Without the timelog import, every
  retainer hours-used and effective-rate figure is fiction within two weeks.
- No telemetry, no analytics, no network call the user did not configure.
