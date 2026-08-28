---
id: T-260828-16
title: Brand the Windows installer — app icon, assisted flow, welcome banner
status: in-progress
category: build
plan_ref: X-09
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`fe9bc91` wired `electron-builder` and produces `release/Solo CRM-Setup-0.1.0.exe`,
but it is unbranded in every slot that exists: no `icon` is configured anywhere in
`package.json`, so the installed app, its taskbar button, its Start-menu entry and
the Apps-and-features row all carry the default Electron atom. And because
`nsis.oneClick` defaults to `true`, the installer has **no welcome page at all** —
it flashes a progress bar and exits.

The installer is the first thing anyone sees of this app, and §12's abandonment
risk is not theoretical. A tool that looks like an unsigned developer artifact
does not get double-clicked twice.

## Scope

**In:**

- A `build/` directory (electron-builder's default `buildResources` location — it
  does not exist yet) holding the generated brand binaries, committed to the repo.
- `build/icon.ico` — multi-resolution (16/24/32/48/64/128/256), sourced from
  `assets/solocrm-mark.svg`. Wired as the app icon, `nsis.installerIcon` and
  `nsis.uninstallerIcon`.
- `nsis.oneClick: false` — required, because `installerSidebar`
  (`MUI_WELCOMEFINISHPAGE_BITMAP`) is *assisted-installer only*. With it:
  `allowToChangeInstallationDirectory: true`, `perMachine: false`,
  `createDesktopShortcut: true`, `shortcutName`, `uninstallDisplayName`.
- `build/installerSidebar.bmp` — the opening banner, **164 × 314 px, 24-bit BMP3,
  no alpha channel**. A *portrait recomposition* of `assets/solocrm-banner.svg`
  using the same elements — cadence-ring mark, "Solo CRM" wordmark, the obsidian
  ground and verdigris/gold accents (`--obsidian:#0B0E14`, `--verdigris:#5BA4A4`,
  `--gold:#C9A84C`, `electron/renderer/styles/tokens.css:26,28`). Reused as
  `uninstallerSidebar`.
- `build/installerHeader.bmp` — `MUI_HEADERIMAGE`, **150 × 57 px, 24-bit BMP3**,
  the horizontal lockup from `assets/solocrm-logo.svg`.
- A committed, documented regeneration script (`scripts/brand-assets.*`, invoked
  by hand, **not** wired into `npm run dist`) so the binaries can be rebuilt when
  the SVGs change. Record the rasterizer used in the outcome.
- A test that parses the committed BMP and ICO headers and asserts their exact
  dimensions and bit depth, so a wrong-format regeneration fails a gate rather
  than shipping a black rectangle.
- Verify the open R-260828-01 follow-up while here: the `files` allowlist
  (`out/**/*`) has never been proven to package `better-sqlite3`. The installed
  app must actually open its database.

**Out:**

- **The installer does not choose the data location.** A custom NSIS page could,
  but it would be Windows-only and would duplicate the cross-platform first-run
  flow in T-260828-18. The install *directory* (`allowToChangeInstallationDirectory`)
  and the *data* directory are different things and must not be conflated in any
  wording shown to the user.
- Linux `deb`/`AppImage` and macOS `dmg` targets. X-09 stays open for those; only
  the shared icon source is produced here.
- Code signing. Unsigned is unsigned — see Risks.
- Auto-update, `latest.yml` semantics, `differentialPackage`.
- A license/EULA page.

## Touches

- `build/` — new: `icon.ico`, `installerSidebar.bmp`, `installerHeader.bmp`
- `package.json` — `build.win.icon`, expanded `build.nsis` block
- `scripts/` — new regeneration script
- A new test asserting the brand binaries' dimensions and bit depth
- `.gitignore` — confirm `build/` is not swept up by an existing ignore rule

## Acceptance

- [ ] `npm run dist` exits 0 and writes `release/Solo CRM-Setup-0.1.0.exe`
- [ ] `build/installerSidebar.bmp` is exactly 164 × 314 and 24 bits per pixel;
      `build/installerHeader.bmp` is exactly 150 × 57 and 24 bits per pixel —
      asserted by a test that reads the BMP header, not by eye
- [ ] `build/icon.ico` contains a 256 × 256 entry
- [ ] Running the installer shows a welcome page carrying the sidebar banner,
      with the artwork rendering on its own obsidian ground — **no black or
      magenta box, no fringing** (the 32-bit-alpha failure). Screenshot in the
      outcome.
- [ ] The installer window's title-bar icon, the desktop shortcut, the Start-menu
      entry and the Apps-and-features row all show the cadence-ring mark, not the
      Electron default
- [ ] The installed app launches from its shortcut, creates `solocrm.db` under
      `userData`, and renders the Overview — proving `better-sqlite3` was packaged
- [ ] Uninstalling removes the shortcuts and the Apps-and-features entry, and
      leaves `userData` intact
- [ ] `npm run lint`, `npm run typecheck` and `npm test` stay green

## Risks

- **The banner cannot be scaled.** `assets/solocrm-banner.svg` is 1280 × 360
  landscape; the sidebar slot is 164 × 314 portrait. Squashing it is the obvious
  wrong move and will look worse than no banner. This needs recomposition of the
  same elements, and the `.claude/rules/ui-design.md` restraint applies —
  gold is the one hero accent, not a second decoration.
- **NSIS MUI needs 24-bit BMP3 without alpha.** A 32-bit BMP from most modern
  exporters renders as a black or garbled block, and `warningsAsErrors` (default
  `true`) may not catch it — it is a runtime rendering failure, not a build one.
  This is why the header-parsing test exists.
- **No rasterizer is in `devDependencies`, and `sharp` cannot write BMP.** Adding
  an SVG→BMP toolchain to the build path is a bigger dependency than the problem
  deserves; generate once, commit the binaries, keep the script out of `dist`.
- **`oneClick: false` changes user-visible behaviour**, not just appearance —
  installs stop being silent and gain wizard pages. Deliberate, and worth naming
  in CHANGELOG.
- **The build is unsigned.** SmartScreen will still warn on a fresh download, and
  no amount of branding removes that. Do not claim the installer is "trusted";
  state the limitation in the outcome rather than papering over it.
- Near no AGENTS.md gotcha directly, but the `files` allowlist check above sits on
  the boundary of the "renderer never touches SQLite" invariant — a packaging
  mistake that drops the native module surfaces as a database error, not a
  packaging one.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
