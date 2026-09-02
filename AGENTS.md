# Solo CRM

A local-first CRM for a one-person consultancy. Electron shell · React + Vite +
TypeScript renderer · better-sqlite3 + Drizzle in main · TanStack Query over
typed IPC · SQLite FTS5. See [README](README.md) for the why.

**Status: Phase 1 (the spine) is essentially complete.** The app opens a real
database, creates and shows every entity, searches across all five indexed
kinds and installs on Windows. Phase 2 (cadence) is partly in, and Phase 3
(money) has its offerings slice — the repositories, the view and selling an
engagement from an offering (P3-01/03/07) — but no revenue lines. Build
order is [planning/solo-crm-taskplan.md](planning/solo-crm-taskplan.md).

## How work happens

New behaviour starts with `scope-task`, which interviews the user and then
writes short briefs to `.dev/tasks/` for them to approve or cut. `build-task`
builds one approved task in the current session: implement, verify, screenshot
UI work, adherence review, `code-review`, close. A scope is a best-effort
brief, not a contract; departing from it is expected, departing silently is
not. A Stop hook runs typecheck, lint and `check:index` whenever a turn ends
with source dirty, so those cannot be skipped.

A one-line fix skips all of this. The process is for work worth a record.

[.dev/README.md](.dev/README.md) is the full procedure and
[ADR-016](.dev/decisions/ADR-016-factory-slimming.md) is why it is this shape.
Lessons go in `.dev/LESSONS.md`, capped at twenty, or become checks; never a
new paragraph here because of one incident. Development context is written
in `.dev/`, never into the working tree.

## References

- [planning/solo-crm-mockup.html](planning/solo-crm-mockup.html) — **the
  authoritative visual spec.** Open it rather than inferring the look from prose.
  Its CSS variables become `tokens.css` verbatim. One exception: the mockup's
  **Pipeline** nav item is deliberately not ported — dropped by
  [ADR-005](.dev/decisions/ADR-005-pipeline-view.md); its absence is a decision,
  not an omission to fix. A second exception: the mockup's **brand block** wears
  MagicPill Labs' mark and wordmark with the product name as a text row beneath.
  The shipped rail carries Solo CRM's own mark and wordmark instead, drops the
  duplicated name row and reads its version live — T-260829-06, annotated in
  place in the mockup — because that block is the default an operator overrides
  with their own branding, and a default cannot be one particular consultancy's.
  A third exception: the mockup's **settings view** is an auto-fit card grid.
  The shipped view is a section rail showing one section's card at a time —
  [ADR-014](.dev/decisions/ADR-014-settings-layout.md), annotated in place at
  `views.settings` — because the grid reflows by window width and the page
  outgrew the region ceiling; the cards' contents are still the spec, and Data
  stays its own view.
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
  File-sync daemons and SQLite corrupt each other. An installed build keeps it
  in `app.getPath('userData')` by default, and that data root can be moved via
  the `data-location.json` pointer file
  ([ADR-006](.dev/decisions/ADR-006-data-root-pointer-file.md)). **A portable
  build is the exception**: it keeps the database beside the launched `.exe`
  and ignores the pointer file entirely
  ([ADR-013](.dev/decisions/ADR-013-portable-data-root.md)) — which makes an
  operator dropping that `.exe` into a synced folder the easiest route there
  is into this. Either way, every path resolves through
  `resolveDatabasePath()` and runs through this same sync-folder guard — never
  a second, unchecked way to open the database.
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
  [ADR-002](.dev/decisions/ADR-002-settings-key-value-table.md), and
  `search_source`, which is not a table of records at all but FTS5's content
  relation — addressed only by `content_rowid`, holding no fact the five source
  tables do not, and nothing holds a foreign key to it
  ([ADR-009](.dev/decisions/ADR-009-search-content-table.md)). Costs
  nothing now; makes a later Turso/libSQL sync a drop-in rather than a rewrite.
- **Hours are derived from `time_entries`.** Without the timelog import, every
  retainer hours-used and effective-rate figure is fiction within two weeks.
- **The search index's kind codes are append-only.** `search_fts`'s rowid
  encodes a source table as `rowid * 8 + kind code` over the `search_source`
  union view; renumbering an existing code without a full index rebuild does
  not error — it silently repoints every already-indexed row of that kind at
  whatever table now owns the new number, surfacing as search results naming
  the wrong record rather than as a failure anywhere near the change. See
  [ADR-008](.dev/decisions/ADR-008-search-index-shape.md).
- **A list read never carries an image original.** Images reach the renderer
  only as base64 `data:` URLs over IPC (the CSP forbids `blob:` and custom
  protocols), so a channel that puts originals on a list pays a third more
  than the stored size for every row at once — about 84 MB of string to paint
  a 60-company grid, and nothing on the seeded database, which has no images,
  will ever show it. The grid reads the stored 96 × 96 / 480 × 270 derivatives
  through one `companyImages:thumbnails` call; only a detail page reads an
  original, one company at a time. See
  [ADR-015](.dev/decisions/ADR-015-company-images.md).
- No telemetry, no analytics, no network call the user did not configure.
