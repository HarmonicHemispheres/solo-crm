# Tasks — August 2026

Status: ○ open · ◐ in-progress · ● done · ⛔ blocked · ✕ dropped
Category: 🗄 data · 🔌 ipc · 🎨 ui · 🔗 integration · 📦 build · 📄 docs

## Open

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ○ open | [T-260828-15](T-260828-15-real-window-qa-pass.md) | Real-window QA pass — focus rings, rail `inert`, breakpoints, route-meta guard | 🎨 ui | P0-10 |
| ○ open | [T-260828-19](T-260828-19-relocate-data-root.md) | Move an existing data root to a new folder without losing a write | 🗄 data | P0-03 |

### Phase 1 — the spine

Nothing below exists yet, and together they are why every page in the installed
app is empty: there are no repositories, and `window.crm` exposes two proof
channels. **P1-CUT** marks the subset the task plan says makes the app start.

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ◐ in-progress | [T-260828-35](T-260828-35-quick-log.md) | Build the quick log (⌘L) — who, kind, one line, from anywhere | 🎨 ui | P1-09 · P1-CUT |
| ○ open | [T-260828-37](T-260828-37-command-palette.md) | Build the command palette (⌘K) — search everything, lead with create commands | 🎨 ui | P1-10 · P1-CUT |
| ○ open | [T-260828-49](T-260828-49-favicon-fetch-cache.md) | Fetch and cache favicons in main, once per host, never through a third party | 🔗 integration | P1-19 |
| ○ open | [T-260828-50](T-260828-50-links-ui.md) | Build the link rows — paste to add, inline title editing, no layout shift | 🎨 ui | P1-20 |
| ○ open | [T-260828-51](T-260828-51-search-latency-nfr.md) | Make search meet its latency budget — the union view cannot be indexed | 🗄 data | P1-06 |
| ○ open | [T-260828-53](T-260828-53-wave-d-ui-followups.md) | Restore the focus ring in the sheets, and close wave D UI review findings | 🎨 ui | *(review)* |

### Follow-ups from review

Real findings from T-260828-20's review, deferred rather than widening its diff.

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ○ open | [T-260828-41](T-260828-41-fk-indexes-polymorphic-orphans.md) | Index the foreign-key columns and settle what happens to polymorphic rows on delete | 🗄 data | *(review)* |
| ○ open | [T-260828-43](T-260828-43-extract-repository-machinery.md) | Extract the repository machinery every repository is currently copying | 🗄 data | *(review)* |
| ○ open | [T-260828-46](T-260828-46-repository-lifecycle-gaps.md) | Close the repository lifecycle gaps review found but left out of scope | 🗄 data | *(review)* |

### Workspace — the two blank pages

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ○ open | [T-260828-39](T-260828-39-readonly-query-channel.md) | Open a genuinely read-only query channel — second connection plus statement refusal | 🔌 ipc | X-02 |
| ○ open | [T-260828-40](T-260828-40-workspace-data-view.md) | Build the Workspace Data view — live database facts, table counts, query console | 🎨 ui | X-01 · X-03 |

## Closed this month

| | ID | Title | Cat | Run |
|---|---|---|---|---|
| ● done | [T-260828-21](T-260828-21-people-affiliations-repository.md) | Build the people and affiliations repository — history-preserving company moves | 🗄 data | R-260828-02 |
| ● done | [T-260828-22](T-260828-22-engagements-repository.md) | Build the engagements repository — split billing, model-specific fields, six statuses | 🗄 data | R-260828-02 |
| ● done | [T-260828-23](T-260828-23-tasks-repository.md) | Build the tasks repository — next-step exclusivity, waiting transitions, open counts | 🗄 data | R-260828-02 |
| ● done | [T-260828-14](T-260828-14-button-primitive.md) | Fold the shell's raw `.btn` classes into a Button primitive | 🎨 ui | R-260828-02 |
| ● done | [T-260828-17](T-260828-17-data-root-pointer.md) | Resolve the data root from a pointer file so its location can be a choice | 🗄 data | R-260828-02 |
| ● done | [T-260828-26](T-260828-26-entity-ipc-channels.md) | Expose the repositories over IPC — entity channels for every record type | 🔌 ipc | R-260828-02 |
| ● done | [T-260828-36](T-260828-36-fts5-index-triggers.md) | Create the FTS5 search index and its triggers in their own migration | 🗄 data | R-260828-02 |
| ● done | [T-260828-44](T-260828-44-settings-guard-tests.md) | Make the settings credential guard test actually guard it | 🗄 data | R-260828-02 |
| ● done | [T-260828-47](T-260828-47-stabilise-real-electron-tests.md) | Stop the real-Electron tests timing out under parallel load | 📦 build | R-260828-02 |
| ● done | [T-260828-27](T-260828-27-create-sheets.md) | Build the create sheets — company, person, engagement, todo | 🎨 ui | R-260828-02 |
| ● done | [T-260828-28](T-260828-28-companies-view.md) | Build the Companies view — card and list presentations with a real record set | 🎨 ui | R-260828-02 |
| ● done | [T-260828-29](T-260828-29-company-detail-engagements.md) | Build company detail — engagements billed here, delivered here, end clients | 🎨 ui | R-260828-02 |
| ● done | [T-260828-30](T-260828-30-company-detail-todos-activity.md) | Build company detail — todos with the next step, activity timeline, contacts | 🎨 ui | R-260828-02 |
| ● done | [T-260828-31](T-260828-31-people-view-person-detail.md) | Build the People view and person detail — affiliation history made visible | 🎨 ui | R-260828-02 |
| ● done | [T-260828-32](T-260828-32-engagements-view.md) | Build the Engagements view — cards grouped by status, progress per billing model | 🎨 ui | R-260828-02 |
| ● done | [T-260828-33](T-260828-33-todos-view.md) | Build the Todos view — grouped by date or client, inline completion and quick-add | 🎨 ui | R-260828-02 |
| ● done | [T-260828-34](T-260828-34-activity-view.md) | Build the Activity view — the append-only log across every entity | 🎨 ui | R-260828-02 |
| ● done | [T-260828-38](T-260828-38-workspace-settings-view.md) | Build the Workspace Settings view — identity, cadence, integrations, appearance | 🎨 ui | R-260828-02 |
| ● done | [T-260828-16](T-260828-16-installer-branding.md) | Brand the Windows installer — app icon, assisted flow, welcome banner | 📦 build | R-260828-02 |
| ● done | [T-260828-24](T-260828-24-activity-repository-last-touch.md) | Build the append-only activity repository and maintain the last-touch timestamps | 🗄 data | R-260828-02 |
| ● done | [T-260828-25](T-260828-25-settings-repository.md) | Build the settings repository — typed accessors, declared defaults, no credentials | 🗄 data | R-260828-02 |
| ● done | [T-260828-20](T-260828-20-companies-repository.md) | Build the companies repository — CRUD, billing links, referential refusals | 🗄 data | R-260828-02 |
| ● done | [T-260828-01](T-260828-01-schema-gap-adrs.md) | Settle the schema gaps G1–G8 and record the binding ones as ADRs | 📄 docs | R-260828-01 |
| ● done | [T-260828-02](T-260828-02-pipeline-view-decision.md) | Decide whether the Pipeline view ships, and record it | 📄 docs | R-260828-01 |
| ● done | [T-260828-03](T-260828-03-toolchain.md) | Stand up the electron-vite + React + TypeScript toolchain | 📦 build | R-260828-01 |
| ● done | [T-260828-04](T-260828-04-renderer-security-baseline.md) | Seal the renderer — contextIsolation, sandbox, CSP, navigation guards | 🔌 ipc | R-260828-01 |
| ● done | [T-260828-05](T-260828-05-database-boot.md) | Open the SQLite database in main with WAL, foreign keys and a busy timeout | 🗄 data | R-260828-01 |
| ● done | [T-260828-06](T-260828-06-sync-folder-guard.md) | Refuse to open a database inside a file-sync folder | 🗄 data | R-260828-01 |
| ● done | [T-260828-07](T-260828-07-schema-migrations.md) | Write the Drizzle schema and the migration runner | 🗄 data | R-260828-01 |
| ● done | [T-260828-09](T-260828-09-typed-ipc-bridge.md) | Build the typed IPC bridge — channel registry, validation, error envelope | 🔌 ipc | R-260828-01 |
| ● done | [T-260828-10](T-260828-10-tanstack-query-ipc.md) | Wire TanStack Query over IPC as the renderer's data layer | 🎨 ui | R-260828-01 |
| ● done | [T-260828-13](T-260828-13-dev-seed.md) | Port the mockup's seed data into a loadable dev fixture | 🗄 data | R-260828-01 |
| ● done | [T-260828-08](T-260828-08-date-money-conventions.md) | Fix the date and money representations and enforce them at the boundary | 📄 docs | R-260828-01 |
| ● done | [T-260828-11](T-260828-11-design-tokens-primitives.md) | Lift `tokens.css` from the mockup and build the shared primitives | 🎨 ui | R-260828-01 |
| ● done | [T-260828-12](T-260828-12-app-shell.md) | Build the app shell — rail, topbar, router, layer dismissal | 🎨 ui | R-260828-01 |
| ● done | [T-260828-52](T-260828-52-adr-search-index-shape.md) | Record the search index shape as an ADR — union view and rowid encoding | 📄 docs | R-260828-02 |
| ● done | [T-260828-45](T-260828-45-brand-asset-generator-hardening.md) | Pin the brand generator scale factor and put its test under a tsconfig | 📦 build | R-260828-02 |
| ● done | [T-260828-18](T-260828-18-first-run-location-chooser.md) | Ask where the data goes on first run, and never ask again | 🗄 data | R-260828-02 |
| ● done | [T-260828-42](T-260828-42-billed-via-cycle-guard.md) | Refuse a billed-via cycle in the repository, as the seed loader already does | 🗄 data | R-260828-02 |
| ● done | [T-260828-48](T-260828-48-links-repository.md) | Build the links repository — paste a URL on any entity, host decides the kind | 🗄 data | R-260828-02 |
