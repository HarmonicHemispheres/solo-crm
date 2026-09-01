---
id: T-260831-05
title: Drive the portable build by hand — the folder it writes to, and the folders it must refuse
status: open
category: build
plan_ref: X-09
created: 2026-08-31
closed:
---

## Why

The portable build's central risk cannot be caught by a unit test: whether a real
packaged artifact, launched by double-click from a real folder, puts its database
next to itself and still has it on the second launch. Under electron-builder's
single-file target the app runs from a temp directory that NSIS deletes on exit,
so the difference between "correct" and "loses everything, silently" is invisible
until someone closes the app and opens it again.

[T-260829-03](T-260829-03-installer-maintenance-qa.md) set the precedent: the
installer's maintenance page was only trustworthy once it had been driven by
hand. This is the same shape of claim about the same class of artifact.

## Scope

**In:** driving the artifact T-260831-04 produces, on a real Windows machine, and
recording what happened in the outcome:

1. **Plain folder.** Copy the portable artifact alone into an empty folder
   outside `userData`. Launch, create one company, close. Confirm the database
   sits in that folder, not in `%APPDATA%\Solo CRM`.
2. **Second launch.** Launch again from the same folder. The company is still
   there. This is the step that catches a database written into the extraction
   directory.
3. **Moved folder.** Move the whole folder elsewhere and launch. The data moves
   with it.
4. **Removable drive**, if one is available. Same as (1) and (2). Note it as not
   run if no drive is available rather than claiming it passed.
5. **Sync folder.** Put the portable artifact in a OneDrive or Dropbox folder and
   launch. Confirm the behaviour ADR-013 specified — a refusal naming the folder
   and the override, not a silent open.
6. **Coexistence.** With the app also installed via the NSIS installer, confirm
   the two do not share a database and that a portable launch does not alter the
   installed app's data root (the `data-location.json` cross-contamination case).
7. **Cleanup.** After a portable run exits, confirm no leftover extraction
   directory and no `Solo CRM` folder newly created under `%APPDATA%`.

**Out:** fixing whatever this finds. Findings become their own tasks, exactly as
T-260829-03 handled its three.

## Touches

Nothing in the working tree. The record is this file's outcome.

## Acceptance

- [ ] All seven checks above are run, or explicitly recorded as not run with the
      reason.
- [ ] The outcome names the actual absolute paths the database was found at in
      (1) and (4), not "it worked".
- [ ] The second-launch check (2) is recorded with the company name that
      survived, so the claim is falsifiable.
- [ ] The sync-folder check (5) records the exact refusal text shown.
- [ ] Anything found is filed as a new task with an ID, and referenced here.

## Risks

- **Reporting a pass that was not observed.** The whole value of this task is
  that it is done by hand; a plausible-sounding outcome written without running
  the steps is worse than not doing it, because it retires the risk on paper.
  The `verify` skill's rule applies: a failing check is a result.
- Test data written during QA is real data in a real folder — use a throwaway
  portable copy, and do not run step (6) against a database that matters.
- If step (5) shows the app opening a database inside OneDrive, that is a
  release blocker, not a finding to note and move past.

---

## Notes from an attempted automated pass (2026-08-31)

**Status is unchanged — this task is still open, and nothing below counts as a
step passing.** Recorded so the next person does not spend the same hour.

The packaged app cannot be driven from Claude Code's shell session. Observed
against the real `Solo CRM-Portable-0.5.0.exe` and, identically, against
`release/win-unpacked/Solo CRM.exe`:

- exits after 0.24 s (unpacked) / 4.6 s (portable) with **exit code 0**;
- writes no database anywhere — not beside the `.exe`, not in `%APPDATA%`;
- produces no stdout or stderr even with `ELECTRON_ENABLE_LOGGING=1`, and no
  Windows Application error event;
- leaves no extraction directory behind.

Because both the portable `.exe` and the plain unpacked build behave the same,
it is not the NSIS wrapper. Electron itself works fine here — the
`runtime-boot-node` pool spawns real Electron processes and passes — so this is
specific to launching the packaged *GUI* app from a non-interactive session.

One deduction was made and then disproved, which is the useful part. Exit code
0 looked conclusive at first: the only `app.exit(0)` in `index.ts` is the
`firstRun.kind === 'quit'` branch, so the app appeared to be reaching the
first-run chooser and cancelling it — which would have meant the portable
marker was not firing. That would have been a serious finding. It is not
supported: suppressing the chooser entirely (by planting a `solocrm.db` under
the default root so the prompt returns `existing-install` without any dialog)
changed nothing — the app still wrote nothing, and the planted file never
gained a `-wal` sidecar or any migration. So the app is not reaching
`openDatabase()` at all, and no conclusion about the portable marker can be
drawn from any of it, in either direction.

**Nothing here is evidence of a defect in the portable data root**, and it must
not be read as reassurance either. The feature is untested outside its unit
tests until a human runs step 1 and step 2 at a real desktop.

Also settled: **step 4 cannot run on this machine at all** — no removable drive
is attached (`Win32_LogicalDisk` DriveType 2 returns nothing).

The machine was left exactly as found: no `%APPDATA%\Solo CRM`, no QA folders,
no leftover extraction directories, no processes. The sync-folder step was
deliberately *not* run against the real `C:\Users\heavy\OneDrive` — the guard
matches path segments, so a folder merely named `OneDrive` exercises the
identical code path without uploading a 121 MB binary to the operator's cloud
storage.
