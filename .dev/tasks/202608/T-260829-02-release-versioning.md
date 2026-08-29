---
id: T-260829-02
title: Give each release a distinct version so two installers are never the same file name
status: in-progress
category: build
plan_ref: X-09
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`package.json` has said `version: 0.1.0` since T-260828-03 scaffolded it, and
`nsis.artifactName` is `${productName}-Setup-${version}.${ext}`. Every build
therefore writes the same path, `release/Solo CRM-Setup-0.1.0.exe`, over the
previous one. Two builds cut hours apart on 2026-08-29 differed by three merged
tasks and were indistinguishable by file name, by version, and by anything in
Apps and features.

That has three consequences that are already real, not hypothetical:

- Testing a build cannot be told apart from testing the one before it. "Is this
  the new installer?" is currently answered by a file timestamp.
- The installed app's `DisplayVersion` is `0.1.0` forever, so the version
  comparison T-260829-01 uses to choose between *Repair* and *Update* only ever
  reaches *Repair*. The branch is correct but unreachable.
- `latest.yml` is regenerated each build claiming the same version, which is a
  trap already armed for whenever auto-update is wired.

## Scope

**In:**

- Decide and record how the version moves. The options are a hand-bumped
  `package.json` version, or a version derived at build time (commit count, short
  SHA, date). Pick one, write down why in the outcome, and make it the only way a
  release gets its number.
- Whatever is chosen must make `release/` unambiguous: two builds from different
  commits must not produce the same artifact file name.
- A documented step for cutting a release, in `README.md` or a `docs`-adjacent
  spot the next person will actually find — including where it sits relative to
  `verify` and `check:index`. The current `npm run dist` runs neither.
- If a hand-bump is chosen, a check that fails when a release is built from a
  commit whose version already has an artifact in `release/`, so the silent
  overwrite cannot recur.

**Out:**

- Auto-update, update feeds, `latest.yml` semantics beyond noting that it is
  currently misleading. Wiring auto-update is a much larger task and is not
  triggered by this one.
- Code signing.
- Git tagging or release automation on a forge. There is no CI in this project
  and this task does not add one.
- Changing `artifactName` to embed a SHA *instead of* a version — the version is
  what Apps and features shows, so it is the field that has to move. A SHA may be
  added alongside, not substituted.
- CHANGELOG policy. `changelog` already covers what goes in it; this is about the
  number, not the notes.

## Touches

- `package.json` — `version`, and possibly `scripts.dist`
- Possibly a small script under `scripts/` if the version is derived
- `README.md` or equivalent — the release procedure
- `.dev/decisions/` — only if the choice is durable enough to bind later work;
  the implementer should say whether it reached that bar rather than filing an
  ADR reflexively

## Acceptance

- [ ] Two `npm run dist` runs from two different commits produce two artifacts
      that coexist in `release/` — demonstrated, with both file names in the
      outcome
- [ ] The installed app's Apps-and-features row shows the version that was built,
      and it differs between those two builds
- [ ] The release procedure is written down somewhere a person lands on without
      being told the path, and names where `verify` fits
- [ ] `npm run dist` still exits 0 and the installed app still launches and opens
      its database
- [ ] `npm run lint`, `npm run typecheck`, `npm test` and `npm run check:index`
      stay green

## Risks

- **A derived version can produce an invalid one.** NSIS and Windows require a
  four-part numeric `FileVersion`; electron-builder will reject or mangle a
  version with a non-numeric suffix in some slots. A `0.1.0+a1b2c3d` style build
  metadata suffix is the usual casualty. Verify the packaged build rather than
  trusting that the string was accepted.
- **Changing the version changes the upgrade relationship.** `uninstallOldVersion`
  keys off the registry entry, not the version, so this is unlikely to strand an
  install — but it is exactly the kind of thing that is only found by installing
  over a real previous version. Test that path, do not reason about it.
- **A bumped version invalidates nothing in the database**, and must not. If any
  future migration or settings default ever keys off the app version, this task
  is where that coupling would first become load-bearing; there is none today and
  none should be added here.
- **This task is cuttable.** T-260829-01 does not depend on it, and the project
  has never shipped to anyone but its author. If the run is tight, this is the
  one to drop — the cost of dropping it is that *Update* stays unreachable and
  installers keep overwriting each other, both of which are annoyances rather
  than defects.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
