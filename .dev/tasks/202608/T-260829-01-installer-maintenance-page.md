---
id: T-260829-01
title: Offer repair or remove when the installer finds an existing installation
status: open
category: build
plan_ref: X-09
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Running `Solo CRM-Setup-0.1.0.exe` on a machine that already has Solo CRM
installed gives the user no choice and no information. `installSection.nsh`
calls `uninstallOldVersion` unconditionally, so the existing copy is silently
removed and replaced — a repair does happen, but nothing says so, nothing offers
the alternative, and there is no route to uninstall from the installer at all.
Uninstalling requires knowing to go to Apps and features.

The assisted flow T-260828-16 turned on has an empty slot for exactly this:
`assistedInstaller.nsh:9-11` inserts a `customWelcomePage` macro if one is
defined and otherwise inserts **no installer welcome page whatsoever**. The
sidebar branding from T-260828-16 renders on the finish page and on the
uninstaller's welcome page; the installer's first page does not exist yet.

Section 12's abandonment risk applies to the second encounter as much as the
first. A tool that appears to reinstall itself without asking is one the user
stops trusting with their client data.

## Scope

**In:**

- `build/installer.nsh` — new. It is picked up automatically as `nsis.include`
  (`NsisTarget.js:600` resolves `installer.nsh` out of `buildResources`, which
  already defaults to `build/`), so **no `package.json` change is required to
  wire it**. Add an explicit `nsis.include` entry only if the implementer
  prefers it named rather than conventional; record which was chosen and why.
- Detection in a `customInit` macro: read the uninstall registry key
  (`${INSTALL_REGISTRY_KEY}`) for `InstallLocation`, `UninstallString` and
  `DisplayVersion` into globals the page reads. `perMachine` is `false`, so
  `HKCU` is the case that matters; a per-machine key found anyway must not be
  acted on silently.
- A `customWelcomePage` macro that branches:
  - **No existing installation** — the flow stays as it is today. Either no page
    or a plain welcome page; do not force a first-time user through a page that
    tells them nothing. Record which was done.
  - **Existing installation found** — a page offering two choices, defaulting to
    the first:
    - **Repair / Update / Downgrade**, worded from comparing `DisplayVersion`
      against `${VERSION}`: equal reads *Repair*, higher reads *Update*, lower
      reads *Downgrade*. Continues into the existing install flow, which already
      removes the old copy first.
    - **Remove** — runs the recorded `UninstallString` and exits without
      installing.
- The Remove choice must state, on the page itself, that **the CRM database is
  left on disk and is not deleted**. That is the current uninstaller's behaviour,
  confirmed by the full install/uninstall cycle in T-260828-16's outcome, and the
  user must be able to read it before choosing rather than discover it after.
- The page must not offer to change the install directory for an existing
  install — `skipPageIfUpdated` already governs that and must not be fought.
- A test that reads `build/installer.nsh` and asserts the macros the build
  depends on are present and correctly named (`customInit`, `customWelcomePage`),
  so deleting or renaming one fails a gate instead of silently reverting the
  installer to today's behaviour. Follow the precedent of
  `scripts/brand-assets.test.ts` — and put it under a tsconfig `include`, the
  omission T-260828-45 had to go back and fix.

**Out:**

- **Deleting user data from the installer or the uninstaller.** No "also remove
  my data" checkbox. The data root is relocatable through `data-location.json`
  ([ADR-006](../../decisions/ADR-006-data-root-pointer-file.md)), so the database
  is not reliably under `userData`, and an NSIS script that resolves a pointer
  file to a path and then deletes that directory is the most destructive thing
  anyone could add to this repository. The uninstaller goes on leaving data alone.
- Modify-style component selection. There are no optional components to pick.
- Auto-update, `latest.yml` semantics, `differentialPackage`.
- Code signing. The build stays unsigned and SmartScreen still warns.
- Versioning releases so that *Update* is ever reachable in practice — that is
  T-260829-02. This task is buildable and correct without it.
- Linux and macOS targets. X-09 stays open for those.

## Touches

- `build/installer.nsh` — new, and the whole of the behaviour change
- A new test asserting the include's macros, plus its tsconfig `include` entry
- `package.json` — only if `nsis.include` is set explicitly
- `CHANGELOG.md` — this is a user-visible change to how installing works

## Acceptance

- [ ] `npm run dist` exits 0 with `nsis.warningsAsErrors` left at its default of
      `true` — a custom NSIS include that emits warnings must not ship
- [ ] On a machine with **no** Solo CRM installed, the flow is unchanged: no
      maintenance page appears, and the app installs and launches
- [ ] On a machine with Solo CRM already installed, the installer shows a page
      offering both a repair-or-update choice and a remove choice, with the
      repair-side label matching the version comparison. Screenshot in the outcome
- [ ] Choosing **Remove** leaves no Solo CRM row in Apps and features, no desktop
      or Start-menu shortcut and no install directory — and
      `%APPDATA%\solo-crm\solocrm.db` still exists afterwards, verified by listing
      the file rather than by assuming
- [ ] Choosing **Repair** completes, the app launches from its shortcut, and the
      existing database opens with its records intact
- [ ] The installer exits with a success code on the Remove path — it must not
      report failure for a path the user deliberately chose
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run check:index`
      stay green

## Risks

- **UAC inner and outer instances both run `.onInit`.** Even with
  `perMachine: false` the UAC plugin can re-launch the installer elevated, and a
  `customInit` that shows UI or calls `Quit` in the wrong instance produces a
  hang or a doubled prompt. Guard on `${UAC_IsInnerInstance}` —
  `multiUserUi.nsh` and `assistedInstaller.nsh`'s `initMultiUser` both already do
  this, and are the pattern to copy rather than invent.
- **Exec'ing the old uninstaller is the classic trap.** A bare `Exec` of
  `UninstallString` returns immediately, because the uninstaller copies itself to
  temp and relaunches from there; the installer would then race a still-running
  uninstall. `ExecWait` with the `_?=` form is required, and `UninstallString`
  comes out of the registry quoted, so it needs parsing rather than concatenation.
- **`warningsAsErrors` is a real gate and a brittle one.** An unused variable or
  an unbalanced macro breaks `npm run dist`. That is the behaviour we want, but it
  means this task can turn a working build red — verify the packaged build, not
  only the tests.
- **Detection can be wrong in both directions.** A registry key left behind by a
  failed uninstall makes the page offer to remove something that is not there; an
  HKCU-only read would be blind to a per-machine install if that config ever
  changes. Confirm `InstallLocation` still exists on disk before treating an
  installation as present.
- **Near the data-root gotcha without touching it.** Nothing here may read, write
  or resolve `data-location.json`, and nothing may open the database. The
  installer's correct relationship to the data root is no relationship at all.
- This changes install behaviour for the second time after T-260828-16 changed it
  once. Both belong in `CHANGELOG.md`; anyone who has installed before will meet
  something new.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
