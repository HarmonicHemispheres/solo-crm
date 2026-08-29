---
id: T-260828-19
title: Move an existing data root to a new folder without losing a write
status: done
category: data
plan_ref: P0-03
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge.

**Changed:** `electron/main/db/move-data-root.{ts,test.ts}` (new),
`electron/main/app-menu.{ts,test.ts}` (new), `electron/main/db/connection.{ts,test.ts}`,
`electron/main/index.ts`.

### The ordering is the whole task

**The pointer is written last.** Copy, verify, then repoint — so a failure at any
earlier step leaves the original root untouched and the app still opening it.
The acceptance criterion about killing the process mid-move is tested by
modelling the on-disk state each kill leaves and then running the *next launch*
for real against it, rather than by timing an actual kill. That includes
asserting the state the ordering makes **impossible** — a pointer committed
before a verified copy — from the other side.

On any failure the module removes the database, `-wal` and `-shm` it (or the
integrity probe) created in the target. That is safe precisely because the target
was proven empty first, so nothing of the user's can be removed, and the original
root is never touched.

### Three deliberate departures from the scope, each reported

1. **The move is not in `data-root.ts`.** That file is imported by
   `connection.ts`, and the move needs `closeDatabase`/`openDatabase`/
   `isDatabaseOpen`/`databasePathIn` from it — so putting it there would have
   created an import cycle. It is a new module layered above both.
2. **The `databasePathIn` importer pin was extended, deliberately and with its
   reason written into the test.** T-260828-57 added that pin an hour earlier to
   stop the unguarded path helper quietly acquiring callers. The move genuinely
   needs it: it must name `solocrm.db` inside a folder the user is merely
   *moving to*, in order to refuse a target that already holds one and to say
   where the copy lands — and it never opens what it names. The dispatch told
   this builder not to add an importer quietly; it didn't.
   **The stronger pin is untouched:** only `connection.ts` and
   `readonly-connection.ts` may construct a `Database`, which is why the
   integrity check lives in `connection.ts` as `checkDatabaseFileIntegrity`
   rather than opening its own handle in the move module. It opens read-write on
   purpose — a copy carrying a hot `-wal` needs recovery, which a read-only
   handle cannot do — and checkpoints `TRUNCATE` on success so the new root is
   self-contained.
3. **No writability probe on the target.** The first-run chooser needs one
   because a bad pointer bricks the app; here the pointer is written last, so a
   copy failure is already fully recoverable. Duplicating `probeWritable` out of
   `data-location-prompt.ts` would have been a second copy of a check, in a file
   this task did not own.

### The entry point

P2-01 Workspace settings does not exist yet, so the move is an application menu
item — **Data → Move Data Folder…** — in a new `app-menu.ts`, installed from
`index.ts` after `openDatabase()`. Setting an application menu replaces
Electron's default, so the standard file/edit/view/window roles are rebuilt in
the template rather than silently lost.

The flow is warn → pick → confirm → move → report, over the same structural
dialog seam `data-location-prompt.ts` already uses, which is what makes it
testable with a plain fake instead of a real dialog.

**Verified at merge:** typecheck clean across all three passes, lint clean,
`node` + `runtime-boot-node` 32 files / 694 tests green on the merged tree.

## Known limit

The copy is synchronous and there is no progress indicator; the confirmation
dialog warns that the window will be unresponsive. A real indicator is noted in
the code as belonging with P2-01, where the settings surface that would host it
lives.

Scope's "refuse a non-empty target" has a consequence worth stating: the default
`userData` folder can never be a target, so the question of whether moving *back*
to the default should delete the pointer — ADR-006 says absence is the default —
never arises.
