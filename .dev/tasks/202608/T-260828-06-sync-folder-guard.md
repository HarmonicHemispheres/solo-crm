---
id: T-260828-06
title: Refuse to open a database inside a file-sync folder
status: in-progress
category: data
plan_ref: P0-04
created: 2026-08-28
closed:
---

## Why

Requirements §4 and AGENTS.md both carry the same warning: **the database file
must never live in a Drive, Dropbox or iCloud folder — file-sync daemons and
SQLite corrupt each other.** A warning in a document protects nothing. The
failure it prevents is silent, arrives weeks later as a corrupted database, and
looks like a SQLite bug rather than a filesystem one.

This is a small task guarding a large loss, and it is the cheapest possible
insurance in the project.

## Scope

**In:**

- On boot, before opening the database, test the resolved path against known
  sync-daemon roots: `Google Drive`, `My Drive`, `Dropbox`, `iCloud Drive`,
  `Mobile Documents` (iCloud's on-disk name), `OneDrive`.
- On a match: an explanatory dialog naming the path and why it is refused, then a
  clean exit. **No database file is created.**
- Case-insensitive and separator-insensitive matching, tested on both path
  separators. Resolve symlinks first — a symlinked `userData` pointing into
  Dropbox is the case that gets missed.
- A documented override for the deliberate case, if one is wanted — an env var or
  CLI flag, off by default, mentioned in the dialog. Decide and say which.

**Out:** Letting the user pick a different location (there is no settings UI
yet). Backup location checks — X-04 chooses a backup folder and *should* be
allowed to write into Drive, since a JSON export is not a live SQLite file.

## Touches

- `electron/main/db/sync-folder-guard.ts` — new
- `electron/main/db/connection.ts` — call the guard before opening
- Test fixtures covering matching and non-matching paths

## Acceptance

- [ ] A `userData` path under each of Drive, Dropbox, iCloud and OneDrive is
      refused with a dialog naming the path
- [ ] No `solocrm.db`, `-wal` or `-shm` file exists after a refusal
- [ ] A symlinked `userData` resolving into a sync folder is caught
- [ ] Matching is case-insensitive and works with both `/` and `\`
- [ ] A path merely *containing* the word `dropbox` as part of a longer segment —
      `~/projects/dropbox-clone/` — is **not** refused
- [ ] Unit tests cover the match logic without needing those folders present

## Risks

- **False positives are worse than they look.** Refusing to start is a hard
  failure; a developer whose home directory happens to contain a matching word
  cannot run the app at all. Match path *segments*, not substrings.
- **iCloud's on-disk directory is `Mobile Documents`, not `iCloud Drive`.**
  Matching only the display name misses every real iCloud case, and this task
  would then look done while protecting nothing.
- The check runs before the database opens, so it must not depend on anything the
  database provides — including settings. Keep it a pure function of the path.
- OneDrive on Windows relocates `Documents` transparently. The resolved path is
  what matters, not the one that was requested.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*
