---
id: T-260828-05
title: Open the SQLite database in main with WAL, foreign keys and a busy timeout
status: in-progress
category: data
plan_ref: P0-03
created: 2026-08-28
closed:
---

## Why

Every repository task depends on a connection that exists, lives in the right
place, and has its pragmas set. The pragmas are the part worth doing carefully:
`foreign_keys` is **off by default in SQLite and is per-connection**, so a schema
full of references enforces nothing until it is turned on, and turning it on in
one place is not enough.

## Scope

**In:**

- better-sqlite3 opened in the main process against
  `app.getPath('userData')/solocrm.db`, rebuilt against the Electron ABI
  (`electron-rebuild` or the equivalent, wired into `postinstall` so a fresh
  clone works).
- `journal_mode = WAL`, `foreign_keys = ON`, `busy_timeout` set, `synchronous`
  chosen deliberately and the choice noted.
- A single connection module that owns the handle, so no other module opens the
  file. The read-only console connection in X-02 is the one exception and is not
  built here.
- Graceful close on `before-quit` so WAL is checkpointed rather than left for the
  next launch.

**Out:** Schema and migrations (T-260828-07). The sync-folder guard
(T-260828-06) — it lands next and depends on this resolving the path. Any
repository. The read-only query connection (X-02).

## Touches

- `electron/main/db/connection.ts` — new
- `electron/main/index.ts` — open on ready, close on quit
- `package.json` — `postinstall` rebuild step

## Acceptance

- [ ] First launch creates `solocrm.db` under `app.getPath('userData')`
- [ ] `PRAGMA journal_mode` returns `wal`
- [ ] `PRAGMA foreign_keys` returns `1` — asserted on a **second** connection, not
      only the first, so the per-connection default cannot pass by accident
- [ ] Killing the process mid-write leaves a database that opens cleanly and
      passes `PRAGMA integrity_check`
- [ ] A fresh `npm install` on a clean clone produces a working native module
      with no manual rebuild step
- [ ] No module outside `db/connection.ts` calls `new Database(...)`

## Risks

- **Native module ABI.** better-sqlite3 built for Node will load in tests and
  fail in Electron, or the reverse. The failure message points at the module,
  not at the cause. Decide which runtime the test suite uses and make it explicit.
- **WAL leaves `-wal` and `-shm` files beside the database.** The backup in X-04
  and any manual copy must account for them; a copied `.db` without its WAL can
  be missing recent writes. Worth noting in the outcome for X-04 to pick up.
- Near the AGENTS.md gotcha: **the database must never live in a sync folder.**
  This task chooses the path; T-260828-06 enforces it. Do not weaken the path
  choice here to make a test fixture convenient — tests get an explicit
  temp-directory override, not a relaxed default.
- `synchronous = NORMAL` is the usual WAL pairing and is a durability tradeoff,
  not a free speedup. Whichever is chosen, say why in the outcome.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
