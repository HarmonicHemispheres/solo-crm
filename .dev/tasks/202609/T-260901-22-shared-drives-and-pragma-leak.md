---
id: T-260901-22
title: Refuse Google "Shared drives" as a database location, and close the connection a throwing pragma leaves open
status: done
category: data
created: 2026-09-01
closed: 2026-09-01
---

## Why

The sync-folder guard listed `My Drive` but not `Shared drives`, which is
how Google Drive for desktop mounts shared drives on Windows
(`G:\Shared drives\<name>`), so the first-run chooser and Move Data Folder
would put `solocrm.db` inside one without a word — the corruption AGENTS.md's
first gotcha exists to prevent. Separately, `openDatabase` ran
`applyPragmas` on the raw handle before assigning it and outside any `try`:
a pragma that throws (WAL on a mount that cannot create the `-shm`) left an
ownerless open connection, the state `closeDatabase` warns makes the quit
checkpoint fail quietly.

## Story

As the operator, picking a shared drive gets the same refusal dialog as
picking My Drive; and a failed open leaves nothing attached to the file.

## Constraints

- Every path still resolves through `resolveDatabasePath()` and the guard;
  no second way in.
- Markers match whole segments, case-insensitively, as before.

## Acceptance

- [x] `findSyncFolderMatch` refuses a path under a `Shared drives` segment.
- [x] `applyPragmas` throwing closes the raw handle and rethrows, leaving
      `getDatabase()` reporting not-open.
- [x] `connection.test.ts` and `sync-folder-guard.test.ts` pass unchanged.

## Related

`electron/main/db/sync-folder-guard.ts` (+ test),
`electron/main/db/connection.ts`, `move-data-root.ts`'s `reopenIfWasOpen`.

---

## Outcome

**Changed:** one marker and one `it.each` row; a `try`/`catch` around
`applyPragmas` mirroring the migration-failure branch below it.

**Departed from scope:** Nothing.

**Not verified:** The pragma failure has no test — forcing `journal_mode`
to throw needs a volume that refuses the `-shm`, which the suite cannot
stage. The branch is four lines and reads the same as the tested one below.

**Elapsed:** ~10 minutes.
