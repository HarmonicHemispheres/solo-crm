---
id: T-260831-02
title: Guard every artifact the release build writes, not only the NSIS one
status: open
category: build
plan_ref: X-09
created: 2026-08-31
closed:
---

## Why

[T-260829-02](T-260829-02-release-versioning.md) built the overwrite guard so two
different commits can never ship under one installer file name and one
`DisplayVersion`. It watches exactly one file. `artifactFileName()` in
[scripts/release-version.mjs](../../../scripts/release-version.mjs) reads
`pkg.build.nsis.artifactName` and nothing else, with `ext` defaulted to `'exe'`,
and `check()` calls it once.

The moment `build.win.target` holds a second entry, that second artifact is
unguarded: it can be overwritten by a different commit under the same version,
silently, which is precisely the failure T-260829-02 exists to prevent. The
guard would still print a confident success line while doing half its job.

This is worth landing on its own and **before** the portable target exists. It is
independently buildable today, it is correct with only `nsis` configured, and it
means T-260831-04 adds a target to a guard that already covers it rather than
having to remember to widen one.

## Scope

**In:**

- Derive the guarded artifact set from **every** configured target under
  `build.win.target`, resolving each target's own `artifactName` template
  (`build.nsis.artifactName`, `build.portable.artifactName`, and the
  electron-builder default for a target that sets none) with that target's real
  extension — `exe` for `nsis` and `portable`, `zip` for `zip`, and so on.
- Keep the existing refusal on an unrecognised `${...}` placeholder, per target.
  A placeholder this script cannot substitute must still fail loudly rather than
  leave the guard watching a file name that is never written.
- `check` refuses when **any** artifact for the current version is present and
  the manifest attributes that version to a different commit.
- `record` stamps the manifest with every artifact it wrote for this version.
- **Migrate the manifest shape compatibly.** An entry today is
  `{ version, commit, dirty, builtAt, artifact }` — singular. A
  `release/build-manifest.json` with singular `artifact` entries exists on real
  machines right now (one was written by the 0.4.0 build on 2026-08-31), and
  `release/` is gitignored, so the script cannot assume a clean slate. Reading an
  old entry must keep working; a corrupt manifest must still throw rather than
  read as "nothing was built here".

**Out:** adding any new target (T-260831-04), and anything about where a portable
build stores data.

## Touches

- `scripts/release-version.mjs`
- `scripts/release-version.test.ts` (or wherever its fixture-root tests live)

## Acceptance

- [ ] With only `nsis` configured, `check` and `record` behave byte-for-byte as
      they do today — same stdout, same exit codes, same manifest content.
- [ ] A fixture root configuring two targets, where only the **second** target's
      artifact exists on disk and the manifest attributes that version to a
      different commit, makes `check` exit non-zero and name that second
      artifact in its message.
- [ ] The same fixture with the manifest attributing the version to the **same**
      commit exits 0 — rebuilding one's own output stays allowed.
- [ ] A fixture whose manifest holds a pre-migration singular-`artifact` entry is
      read without throwing, and its commit is still honoured by `check`.
- [ ] A target whose `artifactName` contains an unknown placeholder makes the
      script exit non-zero naming that placeholder.
- [ ] A corrupt manifest still throws the existing "not readable JSON" error.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:index` all
      exit 0.

## Risks

- **The extension map is where this goes wrong quietly.** Guessing `exe` for a
  `zip` target leaves the guard watching a file that is never written, which
  looks exactly like "no previous build" and passes. The unknown-target case
  should refuse, not default.
- **Silent success is the failure mode of the whole script.** Every bug here
  reports "building X from Y" and guards nothing; the tests have to assert
  refusals, not just that the happy path prints.
- The manifest is in gitignored `release/`, so a wrong migration is invisible in
  review and only shows up on a machine with build history.
