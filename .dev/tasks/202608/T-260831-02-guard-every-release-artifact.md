---
id: T-260831-02
title: Guard every artifact the release build writes, not only the NSIS one
status: done
category: build
plan_ref: X-09
created: 2026-08-31
closed: 2026-08-31
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

---

## Outcome

**Changed:**

- `scripts/release-version.mjs` — the guarded set is now derived from every
  entry in `build.win.target` (string, list, or `{ target }` objects), each
  target's name template resolved through electron-builder's real precedence
  (target → `win` → top-level → the target's own default, read out of the
  installed app-builder-lib rather than guessed). `decide()` takes every
  artifact actually present; one is enough to refuse. Unknown targets, empty
  target lists and unresolvable `${...}` placeholders all throw instead of
  defaulting — `${arch}` deliberately still refuses, since electron-builder
  drops it on the default arch and expands it otherwise.
- `scripts/release-version.test.ts` — 29 tests, up from 10.

**Review:** passed. Verified independently rather than on the builder's word:
`TargetSpecificOptions` really is `artifactName` + `publish` only
(`core.d.ts:39`), and a mutation the builder had not tried — narrowing
`present` to `artifacts.slice(0, 1)`, i.e. the original one-artifact bug —
fails 4 tests including the zip-artifact and commit-attribution assertions. The
tests can fail for the reason the task exists. No blocking findings.

One point was flagged for a reviewer's eye: whether `record` should always write
an `artifacts` array. It should not. This task's own first acceptance criterion
requires the `nsis`-only config to write a manifest byte-for-byte identical to
today's, so singular-when-one is required, not a compromise. Resolved as built.

**Deferred:** nothing. The `portable` and `zip` targets are already in the
guard's table, so T-260831-04 adds a target the guard covers on arrival.
