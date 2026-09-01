---
id: T-260831-04
title: Add the portable target to the release build, beside the installer
status: done
category: build
plan_ref: X-09
created: 2026-08-31
closed: 2026-08-31
---

## Why

`npm run dist` produces one artifact, `release/Solo CRM-Setup-<version>.exe`,
because `build.win.target` is `["nsis"]`. The portable artifact an operator can
drop on a USB stick does not exist yet, so T-260831-03's resolution logic — which
detects a portable launch by observing where it is running from — has nothing to
detect and no way to be exercised outside a test.

## Scope

**In:**

- Add the target chosen by ADR-013 — the single-file `portable` target — to
  `build.win` in `package.json`, with its own `artifactName` carrying the product
  name and version, and the existing `icon.ico`. Both `nsis` and `portable`
  produce an `.exe`, so the two artifact names must not collide: the installer is
  `Solo CRM-Setup-<version>.exe` today, and the portable build needs a name that
  is distinct from it and still obviously the same product and version.
- ~~Produce the portable marker T-260831-03 reads.~~ **Cut by
  [ADR-013](../../decisions/ADR-013-portable-data-root.md) Decision 2, which
  landed after this scope was written.** There is no build-time marker to
  produce and none to keep in sync: electron-builder's per-target options are
  `artifactName` and `publish` only (`app-builder-lib/out/core.d.ts:39`), and
  both Windows artifacts are packed from one `electron-vite build` and one
  `electron-builder --win` over the same `win-unpacked` payload, so a define,
  a `resources/` file or an `appId` would mark the installer portable too. The
  app instead observes that it is portable (packaged, and running out of a
  directory inside `os.tmpdir()`), entirely within T-260831-03. **This task
  produces no marker and must not invent one.**
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

- ~~The marker is the joint, and joints drift.~~ Removed with the marker itself
  by ADR-013 Decision 2 — which is most of why that decision was made.
- **Build size and launch time.** The single-file target extracts the unpacked
  app — 410 MB, against a 116 MB installer — to `%TEMP%` on every launch and
  deletes it on exit. That is a user-visible cost, accepted deliberately when the
  target was chosen, and it belongs in the README note rather than being
  discovered by the operator on a USB stick.
- The new artifact is unsigned in the same way the installer is; nothing here
  changes that, but a portable exe downloaded and run directly draws more
  SmartScreen attention than one arriving via an installer.

---

## Outcome

**Changed:**

- `package.json` — `build.win.target` is `["nsis", "portable"]`, with a
  `build.portable` block naming the artifact
  `${productName}-Portable-${version}.${ext}`. No marker, no define, no
  `resources/` file, no separate `appId`, per ADR-013 Decision 2.
- `README.md` — *Cutting a release* now describes both artifacts in a table,
  says where each stores its data, states plainly that the two do not share a
  database, and records the portable build's costs.
- `AGENTS.md` — the data-location gotcha names the portable exception and the
  fact that dropping a portable `.exe` into a synced folder is now the easiest
  route into it.
- `CHANGELOG.md` — an `Unreleased` section with one feature bullet.

**Artifacts:** `Solo CRM-Setup-0.4.0.exe` (121,523,759 bytes) and
`Solo CRM-Portable-0.4.0.exe` (121,154,344 bytes), both recorded in
`release/build-manifest.json` under the plural `artifacts` shape T-260831-02
added — so the multi-artifact path is exercised, not just implemented.

**Review:** passed. The builder verified the guard covers the new artifact
three ways rather than trusting `WINDOWS_TARGETS`, including that `check`
printed both names before the build and that the later refusal named both. The
seed exclusion was checked by extracting `app.asar` out of the portable `.exe`
itself — 3287 entries, zero matching `seed` — rather than inferred from config,
which is what that acceptance criterion asked for.

One report was checked against direct evidence rather than accepted: the
builder said neither of its builds wrote `release/latest.yml`, which contradicts
the `nsis`-only build run earlier the same day that did. Both are true — adding
the portable target changed the behaviour. The README sentence claiming
electron-builder "writes it on every build" was therefore false in a section
this task had just rewritten, and is corrected here as a one-line fix rather
than left standing or deferred.

**Deferred:**

- ADR-013's Consequences says the extraction ksuid is "fixed at build time…
  the same path on every launch of a given build". Accurate as written, but two
  rebuilds of the *same commit* get different ksuids (`NsisTarget.js:246-247`),
  so the two portable `.exe` files differed by 11 bytes. Worth a clarifying
  sentence if anyone ever diagnoses the concurrent-launch collision from it; not
  worth reopening an accepted ADR on its own.
- The portable target writes no `.blockmap`, so `release/` is not symmetrical
  between the two artifacts. Nothing claims otherwise; recorded so it is not
  read as a missing file later.
