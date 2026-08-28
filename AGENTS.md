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

[.dev/README.md](.dev/README.md) is the full procedure — pipeline, status and
category vocabulary, which review each category triggers. Development context is
written there, never into the working tree.

## References

- [planning/solo-crm-mockup.html](planning/solo-crm-mockup.html) — **the
  authoritative visual spec.** Open it rather than inferring the look from prose.
  Its CSS variables become `tokens.css` verbatim.
- [planning/solo-crm-requirements.md](planning/solo-crm-requirements.md) — scope,
  data model, integrations, non-functional requirements.
- [.claude/rules/ui-design.md](.claude/rules/ui-design.md) — design principles,
  loaded automatically when working on renderer or CSS files.

## Gotchas

Things that are silently wrong rather than loudly broken:

- **The database file must never live in a Drive, Dropbox or iCloud folder.**
  File-sync daemons and SQLite corrupt each other. It belongs in
  `app.getPath('userData')`.
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
- **Every table gets a UUID primary key and `created_at` / `updated_at`.** Costs
  nothing now; makes a later Turso/libSQL sync a drop-in rather than a rewrite.
- **Hours are derived from `time_entries`.** Without the timelog import, every
  retainer hours-used and effective-rate figure is fiction within two weeks.
- No telemetry, no analytics, no network call the user did not configure.
