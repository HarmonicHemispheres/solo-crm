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
