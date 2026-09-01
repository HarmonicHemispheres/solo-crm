---
id: T-260831-04
title: Add the portable target to the release build, beside the installer
status: open
category: build
plan_ref: X-09
created: 2026-08-31
closed:
---

## Why

`npm run dist` produces one artifact, `release/Solo CRM-Setup-<version>.exe`,
because `build.win.target` is `["nsis"]`. The portable artifact an operator can
drop on a USB stick does not exist yet, and T-260831-03's resolution logic has
nothing to switch on until the build produces something marked portable.

## Scope

**In:**

- Add the target chosen by ADR-013 — the single-file `portable` target — to
  `build.win` in `package.json`, with its own `artifactName` carrying the product
  name and version, and the existing `icon.ico`. Both `nsis` and `portable`
  produce an `.exe`, so the two artifact names must not collide: the installer is
  `Solo CRM-Setup-<version>.exe` today, and the portable build needs a name that
  is distinct from it and still obviously the same product and version.
- **Produce the portable marker T-260831-03 reads.** However ADR-013 fixed the
  "is this build portable" signal, this task is what makes it true of the
  packaged output — a build-time define, a file in `resources/`, a distinct
  `appId`, whatever was chosen. The two halves have to agree; name the mechanism
  in the outcome so the next reader does not have to diff two tasks to find it.
- Keep `files` excluding `out/main/seed.js` for the new target as it does for
  `nsis` — the dev seed must not ship in a portable build any more than in the
  installer.
- Confirm `npm run dist` still runs `release-version.mjs check` before and
  `record` after, and that both artifacts are guarded (T-260831-02) and recorded.
- Update the README's **Cutting a release** section: what `npm run dist` now
  writes, which artifact stores data where, and the one-line warning that the two
  builds on one machine do not share a database.
- Update the AGENTS.md data-location gotcha so it states the portable exception
  rather than reading as though `userData` is the only answer.
- Add the CHANGELOG entry, per the `changelog` skill's rules.

**Out:** the resolution logic (T-260831-03); the hand-driven QA (T-260831-05);
code signing, auto-update, and any non-Windows target — X-09's Ubuntu and macOS
packaging stays where it is.

## Touches

- `package.json` — `build.win.target`, the new target's config block
- `electron.vite.config.ts` — only if the portable marker is a build-time define
- `README.md` — Cutting a release
- `AGENTS.md` — the data-location gotcha
- `CHANGELOG.md`

## Acceptance

- [ ] `npm run dist` exits 0 and writes both the NSIS installer and the portable
      artifact into `release/`, each with the version in its file name.
- [ ] `release/build-manifest.json` records both artifacts against the version
      and commit (depends on T-260831-02).
- [ ] Running `npm run dist` twice from the same commit succeeds both times;
      running it from a different commit without bumping the version is refused
      naming whichever artifact already exists.
- [ ] The portable artifact does not contain `out/main/seed.js` — checked by
      inspecting the packaged asar, not assumed from config.
- [ ] The installed build's data location is unchanged: it still resolves to
      `app.getPath('userData')`.
- [ ] README's Cutting a release lists both artifacts and says where each stores
      data; the AGENTS.md gotcha names the portable exception.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:index` all
      exit 0.

## Risks

- **The marker is the joint, and joints drift.** If this task's marker and
  T-260831-03's detection disagree, the portable build silently falls back to
  whatever the non-portable path does — which is `userData`, which looks like a
  working app storing data in the wrong place. Worth an assertion that fails the
  build rather than trust.
- **Build size and launch time.** The single-file target extracts the unpacked
  app — 410 MB, against a 116 MB installer — to `%TEMP%` on every launch and
  deletes it on exit. That is a user-visible cost, accepted deliberately when the
  target was chosen, and it belongs in the README note rather than being
  discovered by the operator on a USB stick.
- The new artifact is unsigned in the same way the installer is; nothing here
  changes that, but a portable exe downloaded and run directly draws more
  SmartScreen attention than one arriving via an installer.
