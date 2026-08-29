---
id: T-260828-57
title: One database path, one sync-folder guard, and a folder proven writable
status: open
category: data
plan_ref: P0-03
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Deferred from T-260828-18's review. Four findings, of which the first two are
the kind AGENTS.md warns about — silently wrong rather than loudly broken.

**Two copies of the database path.** The existing-install check recomputes it,
with its own `DB_FILENAME = 'solocrm.db'` and its own `join(userDataDir, ...)`,
rather than asking `resolveDatabasePath({ userDataDir })`. The whole safety
property of this feature — *a database already exists, so never prompt* — now
depends on two independently maintained copies of one path staying equal. If
they drift, an existing user is asked again where their data goes.

**One guard, two behaviours.** The pick-time check calls `findSyncFolderMatch`
but ignores `isSyncFolderGuardOverridden()`, while `connection.ts`'s boot-time
guard honours it. A user who deliberately set the documented
`SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` escape hatch cannot pick that folder at all,
and the refusal tells them nothing about the override they already set.

**No writability probe.** A read-only or disconnected pick fails inside
`openDatabase()` *after* `writeDataRootPointer` has committed. Every later
launch then sees the pointer, reports `existing-install`, never re-prompts, and
shows a raw better-sqlite3 "unable to open database file". That is an
unbootable install with no path back through the interface.

**"Use the default" changes ADR-006's semantics.** It writes a pointer naming
the default root. ADR-006 states that with no pointer present the resolver
"returns userDataDir unchanged, byte-for-byte today's behaviour". From now on
every new install has an absolute path baked into its profile rather than one
resolved from `app.getPath` at boot — which breaks if the profile ever moves.

## Scope

**In:**

- Route the existing-install check through `resolveDatabasePath()`; delete the
  duplicate constant.
- Honour `isSyncFolderGuardOverridden()` at pick time, and say so in the refusal
  when the override is what would allow it.
- Probe the chosen folder for writability before writing the pointer, and return
  to the choice on failure.
- Decide "use the default": either write no pointer (restoring ADR-006's stated
  behaviour) or amend ADR-006 to say the default is now pinned. **One of the
  two** — the current state is code and ADR disagreeing.
- Give `showOpenDialog` a `title`, `defaultPath` and `buttonLabel`, so the
  picker does not open with a generic OS title immediately after a message box
  that carefully explained which folder is being asked for.

**Out:** Relocating an existing data root (T-260828-19). Any renderer UI.

## Touches

- `electron/main/first-run/data-location-prompt.ts` and its test
- `electron/main/db/connection.ts`
- `.dev/decisions/ADR-006-data-root-pointer-file.md` — only if the default is
  pinned deliberately

## Acceptance

- [ ] There is exactly one expression producing the database path in the main
      process — asserted by grep for `solocrm.db` returning one definition
- [ ] With `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` set, a sync folder can be picked and
      boots; without it, the same pick is refused
- [ ] A read-only chosen folder returns to the choice and leaves **no** pointer
      file on disk, asserted by checking the filesystem after the refusal
- [ ] The "use the default" behaviour matches ADR-006, whichever way it is
      settled, and the ADR and the code are checked against each other in a test
- [ ] An existing install is never prompted — the case that must not regress

## Risks

- **Probing writability by writing the database.** The probe must be cheap and
  must clean up after itself; leaving a stray file in a folder the user is only
  considering is worse than no probe.
- **Changing the default-pointer behaviour for profiles that already have one.**
  Whatever is decided applies to new installs; an existing pointer is a choice
  the user made and is not this task's to rewrite.
