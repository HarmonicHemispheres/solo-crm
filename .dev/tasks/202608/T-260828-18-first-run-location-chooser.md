---
id: T-260828-18
title: Ask where the data goes on first run, and never ask again
status: done
category: data
plan_ref: P0-03
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

T-260828-17 makes the data root a value that can be chosen; nothing yet does the
choosing. Without this, the only way to move the data is to hand-author a JSON
file, which is not an option a user has.

It has to run in the main process before `openDatabase()` — the renderer does not
exist yet at that point, and could not be trusted with the filesystem if it did.
That constraint is what keeps this one task rather than an IPC channel plus a view.

## Scope

**In:**

- A first-run flow in `electron/main/first-run/` invoked from
  `app.whenReady()` in [index.ts](../../../electron/main/index.ts), **after**
  `installContentSecurityPolicy` and **before** `openDatabase()`.
- It runs only when the pointer file is absent **and** no `solocrm.db` exists
  under the default root. An existing install is never prompted — see Risks.
- Native `dialog.showMessageBox`: states the default path in full, with buttons
  *Use the default* (the default button), *Choose a folder…*, *Quit*. Escape maps
  to *Quit*, not to a silent default.
- *Choose a folder…* opens `dialog.showOpenDialog` with `openDirectory` and
  `createDirectory`. Cancelling returns to the choice — it does not fall through
  to the default.
- The chosen path is checked with the **existing** `findSyncFolderMatch` at pick
  time. A match re-prompts with the reason and the offending path, and writes no
  pointer file. The user is not allowed to commit a choice that will refuse to
  boot later.
- On a valid choice, write the pointer through T-260828-17's atomic writer, then
  continue into `openDatabase()` in the same launch. No restart.
- Wording distinguishes this folder from the install directory the NSIS wizard
  asks about (T-260828-16) — "where Solo CRM keeps your data", naming
  `solocrm.db`.
- An explicit opt-out parameter so tests, `npm run seed` and any headless boot
  skip the flow. An explicit argument, not an environment-variable default —
  same discipline as `OpenDatabaseOptions`.

**Out:**

- A styled renderer screen. The window does not exist this early, and building one
  would mean opening the database before knowing where it is.
- Changing the location after first run — that is Workspace settings (P2-01/P2-03)
  and needs T-260828-19's move logic behind it.
- Migrating or copying any existing data (T-260828-19).
- Remembering a rejected sync-folder choice, offering a "don't ask again", or any
  onboarding beyond this single question.

## Touches

- `electron/main/first-run/data-location-prompt.ts` — new
- `electron/main/index.ts` — call site inside `whenReady`, before `openDatabase()`
- `electron/main/db/seed/cli.ts` — pass the opt-out
- A new test file; `connection.test.ts`'s Electron boot test may need the opt-out

## Acceptance

- [ ] A clean profile shows the prompt, and the message names the exact default
      path
- [ ] *Use the default* writes `data-location.json` pointing at the default root
      and boots with `solocrm.db` there
- [ ] *Choose a folder…* → picking an empty directory creates `solocrm.db` in it,
      records it in the pointer, and the **second** launch shows no prompt
- [ ] Choosing a folder with a `Dropbox` / `Google Drive` / `OneDrive` /
      `Mobile Documents` segment re-prompts naming that path, and leaves no
      pointer file behind
- [ ] Cancelling the folder picker returns to the choice rather than defaulting
- [ ] *Quit* exits cleanly with no pointer file and no database file anywhere
- [ ] A profile that already has `solocrm.db` under the default root and no
      pointer file boots straight through with **no prompt** and opens that
      existing database
- [ ] `npm test` and `npm run seed` complete without ever blocking on a dialog
- [ ] `npm run lint`, `npm run typecheck` and `npm test` green

## Risks

- **Prompting an existing install is the dangerous failure.** A user who upgrades,
  gets asked, and picks a new folder sees an empty CRM and concludes the app ate
  their data — while `solocrm.db` sits untouched in the old root. The
  "database already exists → never prompt" rule is the whole safety property here,
  not a convenience.
- **A dialog before any window exists blocks the process.** If the opt-out is
  missed anywhere, the test suite and the seed CLI hang with no output rather than
  failing — the worst kind of failure to diagnose. Wire the opt-out first, prove
  it, then build the dialog.
- Modal dialogs with no parent window behave differently across platforms; on
  Windows they can open behind other windows. Verify it is actually visible on a
  real desktop, not only that the promise resolves.
- Directly on the AGENTS.md gotcha: **the database must never live in a Drive,
  Dropbox or iCloud folder.** This task is the one place a human hands the app such
  a path on purpose. Check at pick time *and* leave the boot-time guard in place —
  the folder can become a sync root after the choice is made.
- `app.getPath('userData')` is only valid after `whenReady`. Reading the default
  path earlier returns something plausible and wrong.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).


---

## Outcome

Merged as `655ecb1`. Review non-blocking (4 should-fix, 1 nit).

**Changed:** `electron/main/first-run/data-location-prompt.ts` and its test
(new), `electron/main/index.ts`, `electron/main/db/connection.ts`.

First run now asks where the data goes, between
`installContentSecurityPolicy` and `openDatabase()`, and never asks again. Esc
maps to Quit rather than to a silent default; cancelling the folder picker
returns to the choice instead of falling through; a sync-folder match re-prompts
and writes no pointer, so it is not possible to commit a choice that refuses to
boot on the next launch. The opt-out is an explicit argument, so tests,
`npm run seed` and headless boots skip it rather than hanging on a dialog.

**Deferred (follow-ups, not blockers) — the first two are worth doing soon:**

- The existing-install check recomputes the database path itself, with its own
  `DB_FILENAME` constant, rather than asking `resolveDatabasePath()`. The whole
  safety property ("a database already exists, so never prompt") now rests on
  two copies of one path staying equal.
- The pick-time sync-folder check ignores `isSyncFolderGuardOverridden()` while
  the boot-time guard honours it — one guard, two behaviours. A user who set the
  documented `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` escape hatch cannot pick that
  folder at all.
- A chosen folder is never probed for writability before the pointer commits, so
  a read-only pick fails *after* the pointer is on disk, and every later launch
  reports `existing-install` and never re-prompts.
- "Use the default" writes a pointer naming the default root, which changes
  ADR-006's stated semantics — no pointer meant "resolve `app.getPath` fresh".
  Baking an absolute path into new profiles is a real behaviour change and
  deserves either a decision or a revert.
