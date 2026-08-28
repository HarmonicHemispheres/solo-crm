# Tasks — August 2026

Status: ○ open · ◐ in-progress · ● done · ⛔ blocked · ✕ dropped
Category: 🗄 data · 🔌 ipc · 🎨 ui · 🔗 integration · 📦 build · 📄 docs

## Open

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ○ open | [T-260828-05](T-260828-05-database-boot.md) | Open the SQLite database in main with WAL, foreign keys and a busy timeout | 🗄 data | P0-03 |
| ○ open | [T-260828-06](T-260828-06-sync-folder-guard.md) | Refuse to open a database inside a file-sync folder | 🗄 data | P0-04 |
| ◐ in-progress | [T-260828-07](T-260828-07-schema-migrations.md) | Write the Drizzle schema and the migration runner | 🗄 data | P0-05 |
| ○ open | [T-260828-09](T-260828-09-typed-ipc-bridge.md) | Build the typed IPC bridge — channel registry, validation, error envelope | 🔌 ipc | P0-07 |
| ○ open | [T-260828-10](T-260828-10-tanstack-query-ipc.md) | Wire TanStack Query over IPC as the renderer's data layer | 🎨 ui | P0-08 |
| ○ open | [T-260828-12](T-260828-12-app-shell.md) | Build the app shell — rail, topbar, router, layer dismissal | 🎨 ui | P0-10 |
| ○ open | [T-260828-13](T-260828-13-dev-seed.md) | Port the mockup's seed data into a loadable dev fixture | 🗄 data | P0-11 |

## Closed this month

| | ID | Title | Cat | Run |
|---|---|---|---|---|
| ● done | [T-260828-01](T-260828-01-schema-gap-adrs.md) | Settle the schema gaps G1–G8 and record the binding ones as ADRs | 📄 docs | R-260828-01 |
| ● done | [T-260828-02](T-260828-02-pipeline-view-decision.md) | Decide whether the Pipeline view ships, and record it | 📄 docs | R-260828-01 |
| ● done | [T-260828-03](T-260828-03-toolchain.md) | Stand up the electron-vite + React + TypeScript toolchain | 📦 build | R-260828-01 |
| ● done | [T-260828-04](T-260828-04-renderer-security-baseline.md) | Seal the renderer — contextIsolation, sandbox, CSP, navigation guards | 🔌 ipc | R-260828-01 |
| ● done | [T-260828-05](T-260828-05-database-boot.md) | Open the SQLite database in main with WAL, foreign keys and a busy timeout | 🗄 data | R-260828-01 |
| ● done | [T-260828-06](T-260828-06-sync-folder-guard.md) | Refuse to open a database inside a file-sync folder | 🗄 data | R-260828-01 |
| ● done | [T-260828-08](T-260828-08-date-money-conventions.md) | Fix the date and money representations and enforce them at the boundary | 📄 docs | R-260828-01 |
| ● done | [T-260828-11](T-260828-11-design-tokens-primitives.md) | Lift `tokens.css` from the mockup and build the shared primitives | 🎨 ui | R-260828-01 |
