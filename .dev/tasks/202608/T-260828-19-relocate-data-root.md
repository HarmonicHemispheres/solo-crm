---
id: T-260828-19
title: Move an existing data root to a new folder without losing a write
status: open
category: data
plan_ref: P0-03
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

T-260828-18 asks once, on first run. Someone who answers it and later buys a
bigger drive, or who accepted the default before thinking about it, has no way
back — and hand-editing `data-location.json` moves the pointer without moving the
database, which presents as an empty CRM.

**Recommended for deferral.** The natural home for this is Workspace settings
(§6.11, P2-01/P2-03), which does not exist yet; building it now means building a
surface for it too. Scoped here so the gap is on record rather than rediscovered.

## Scope

**In:**

- A main-process `moveDataRoot(target)`: refuse if `target` matches the
  sync-folder guard or is non-empty; `wal_checkpoint(TRUNCATE)` and
  `closeDatabase()`; copy `solocrm.db` (and any surviving `-wal` / `-shm`); run
  `PRAGMA integrity_check` on the **copy** before anything else happens; rewrite
  the pointer atomically; reopen from the new root.
- Copy-then-verify-then-repoint-then-leave-the-original. The old files stay on
  disk and the user is told where they are. Nothing is deleted by this app.
- Failure at any step leaves the pointer untouched and the app running on the
  original root — a half-moved state must be impossible, not merely unlikely.
- An entry point to invoke it. If P2-01 has not landed, a menu item is acceptable;
  say which was used.

**Out:**

- Deleting the old data. Ever, automatically.
- Merging two databases, or moving into a folder that already has a `solocrm.db`.
- Moving `safeStorage` credentials (ADR-004) — they stay in `userData`.
- The backup folder (X-04), which is chosen separately and may be a sync folder.

## Touches

- `electron/main/db/data-root.ts` — the move operation
- `electron/main/db/connection.ts` — close/reopen sequencing
- New tests covering interruption at each step

## Acceptance

- [ ] After a move, the new root holds a `solocrm.db` whose per-table row counts
      match the original exactly, and `PRAGMA integrity_check` returns `ok`
- [ ] The original files still exist afterwards and the user is told the path
- [ ] Killing the process at each step — after copy, after verify, before the
      pointer write, after it — leaves the app opening a valid database on the
      next launch, on one root or the other, never neither
- [ ] A target inside a sync folder is refused before anything is copied
- [ ] A target already containing `solocrm.db` is refused
- [ ] A write committed immediately before the move is present in the new database
- [ ] `npm run lint`, `npm run typecheck` and `npm test` green

## Risks

- **WAL sidecars are the trap.** Copying `solocrm.db` alone while `-wal` holds
  committed frames silently drops recent writes — the checkpoint must happen and
  must be verified, not assumed. T-260828-05's outcome records that a clean quit
  truncates the WAL; a mid-session move has no such guarantee.
- The window between "pointer rewritten" and "new database opened" is where data
  loss lives. Order the steps so the pointer is the *last* thing to change.
- Near the AGENTS.md gotcha for the third time: the target is user-supplied and
  must go through the same guard as T-260828-17 and T-260828-18. Three call sites
  checking one invariant is a sign it belongs in one function — reuse, do not
  reimplement.
- Sizeable databases make the copy slow enough to need feedback; a frozen window
  during a data move reads as a crash and invites a force-quit mid-copy.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
