---
id: T-260829-03
title: Drive the installer maintenance page by hand — repair, remove, and the database that must survive
status: open
category: build
plan_ref: X-09
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

T-260829-01 wrote the maintenance page and proved everything a machine can
prove: `npm run dist` exits 0 with `nsis.warningsAsErrors` at its default, NSIS
compiles every branch of the script, and the registry key names it reads are
asserted against the real `app-builder-lib` templates.

**Five of that task's seven acceptance criteria need a human at a GUI**, and none
of them were met. They were not skipped for convenience — an agent session cannot
drive an NSIS dialog, and the only machine available already carries a real Solo
CRM 0.1.0 per-user install that an automated run should not gamble with.

Splitting them out is the honest record. T-260829-01 closed for the artefact it
produced; this task is the verification that artefact still owes, and it stays
open until a person has run it.

## Scope

**In:** running the built installer by hand and recording what happened.

1. **No existing install.** On a machine (or a fresh Windows VM/user profile)
   with no Solo CRM, run `release/Solo CRM-Setup-0.1.0.exe`. The maintenance page
   must **not** appear; the app installs and launches.
2. **Existing install, Repair.** With 0.1.0 already installed, run the installer.
   The page must appear, offering a repair-or-update choice and a remove choice,
   with the repair-side label matching the version comparison. **Screenshot it.**
   Choose Repair; it completes, the app launches from its shortcut, and the
   existing database opens with its records intact.
3. **Existing install, Remove.** Run the installer again and choose Remove.
   Afterwards: no Solo CRM row in Apps and features, no desktop or Start-menu
   shortcut, no install directory — and **`%APPDATA%\solo-crm\solocrm.db` still
   exists**, verified by listing the file rather than by assuming.
4. **Exit code on the Remove path.** The installer must exit with a success code.
   A path the user deliberately chose must not report failure.

**Out:** any change to `build/installer.nsh` that is not a fix for something this
QA finds. If it finds nothing, this task closes with the evidence and no diff.

**Out:** the per-machine (HKLM) branch, unless a per-machine install is
available to test against — see Risks.

## Acceptance

- [ ] A screenshot of the maintenance page against an existing 0.1.0 install,
      attached to the outcome
- [ ] The Repair path completes and the app launches with its records intact
- [ ] The Remove path leaves no row in Apps and features, no shortcuts and no
      install directory
- [ ] `%APPDATA%\solo-crm\solocrm.db` listed, by path and size, **after** a
      Remove — the guarantee this whole page exists to protect
- [ ] The Remove run's exit code recorded, and it is a success code
- [ ] A clean-machine run recorded as showing no maintenance page

## Risks

- **The per-machine (HKLM) branch is the one nobody has exercised.**
  T-260829-01 handles it — the page names the scope out loud ("for all users of
  this computer") and passes `/allusers` to the uninstaller, and
  `INSTALL_MODE_PER_ALL_USERS_REQUIRED` is defined by electron-builder even with
  `perMachine: false`, so the path is real code. It is also the path least likely
  to be reachable on the developer machine. Say explicitly whether it was tested
  or not; do not let it pass silently as covered.
- **Testing Remove destroys the tester's own install.** That is the point, and it
  is also why the database-survives check is the criterion that matters most: run
  it on a profile whose `solocrm.db` you are willing to have proven safe, and
  list the file before as well as after.
- **A failure here is a failure of `installer.nsh`, not of this task.** Record
  what happened, then scope the fix rather than editing the script inside a QA
  pass.

## Touches

- `build/installer.nsh` — only if this QA finds a defect
- `CHANGELOG.md` — T-260829-01 left its entry unwritten and named it here

---

## Progress — the update path is driven; Remove is not (R-260829-03)

This task stays **open**. Four of six acceptance criteria are met and recorded
below; the two that require an uninstall are untouched, because the user
scoped this run to the non-destructive half and said so explicitly. Nothing
below is claimed beyond what was actually run.

**What was driven.** `Solo CRM-Setup-0.4.0.exe`, built from `5968d5d`, against
the real installed **0.3.0** at
`C:\Users\heavy\AppData\Local\Programs\Solo CRM` (per-user, HKCU). Driven page
by page with the GUI visible and each page captured, not silently.

### Met

- [x] **A screenshot of the maintenance page against an existing install.**
      Captured (`maintenance-page-cropped.png`, in the run's scratch dir — the
      first capture was a full desktop and was cropped to the dialog and
      deleted rather than kept). It reads: *"Solo CRM is already installed"* /
      *"Solo CRM 0.3.0 is already installed for you only, in
      C:\Users\heavy\AppData\Local\Programs\Solo CRM. This installer carries
      version 0.4.0."*
      **The label reads Update, not Repair** — the check this task exists for,
      and the one that had never been driven. Two options are offered, not
      three: *Update Solo CRM to version 0.4.0* (preselected) and *Remove Solo
      CRM*. Repair is correctly absent, because the versions differ. Per-user
      scope is detected and stated in the copy ("for you only").
- [x] **The update path completes and the app launches with its records
      intact.** Four pages: maintenance → *Choose Installation Options*
      (preselected "Only for me (heavy)", noting *"There is already a per-user
      installation… Will reinstall/upgrade"*) → *Choose Install Location*
      (existing path preselected) → install. Mid-install it detected the
      running app — *"Solo CRM is running. Click OK to close it"* — closed it,
      finished, and offered a branded *Completing Solo CRM Setup* page with
      *Run Solo CRM* checked. The installer exited cleanly.
      After: `DisplayVersion` **0.4.0**, `Solo CRM.exe` ProductVersion
      **0.4.0.0**, Start-menu and Desktop shortcuts present, the app relaunched
      and rendered Today with the first-run card and the tour at step 1 of 5.
- [x] **The database, by path and size.** `data-location.json` points at the
      default root, so the file is
      `C:\Users\heavy\AppData\Roaming\solo-crm\solocrm.db`.
      **290,816 bytes, last written 2026-08-29 11:46 AM — before the update
      and after it, byte-for-byte the same size and the same mtime.** The
      installer did not touch it. SHA-256 after the update:
      `9A009DEFE01F6AC88CD2DC0B156BF78B254CA084E1CB76257BC93E07F6EFC3A4`
      (it could not be hashed beforehand: the running app held the file, which
      is itself the reason the installer has to close it).
      Contents, read from a copy taken with its `-wal` and `-shm` so nothing
      uncheckpointed was missed: 0 companies, people, engagements, tasks,
      activity, links and settings — and **1 `branding` row**, an
      operator-supplied image, which survived the update.
- [x] **A clean-machine run shows no maintenance page** — *partially, by
      inference only, and therefore NOT claimed as met.* See below.

### Not met — each needs an uninstall

- [ ] **The Remove path leaves no row in Apps and features, no shortcuts and
      no install directory.**
- [ ] **`solocrm.db` listed by path and size *after* a Remove** — the
      guarantee the whole page exists to protect. Its size and hash are
      recorded above as the "before" for exactly that comparison, so the check
      is now a single diff away.
- [ ] **The Remove run's exit code, recorded and successful.**
- [ ] **A clean-machine run recorded as showing no maintenance page.** Not
      reachable without first removing the install: the detection is keyed on
      the HKCU uninstall entry, and this machine has one. A second Windows
      account would also serve.

**To finish it:** run `Solo CRM-Setup-0.4.0.exe`, choose *Remove*, then
re-run it once with nothing installed to confirm it opens on the ordinary
welcome page rather than the maintenance page. The database must still be
290,816 bytes at the path above afterwards.
