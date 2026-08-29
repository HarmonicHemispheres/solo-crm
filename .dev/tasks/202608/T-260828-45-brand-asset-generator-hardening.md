---
id: T-260828-45
title: Pin the brand generator's scale factor and put its test under a tsconfig
status: done
category: build
plan_ref:
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Deferred from T-260828-16's review. The committed binaries are correct — a full
install/uninstall cycle on the real machine confirmed the sidebar renders and
every icon slot carries the cadence ring. The hazard is the *next* regeneration.

`scripts/brand-assets.mjs` never pins the device scale factor.
`capturePage()` returns a bitmap at the display's `deviceScaleFactor`; `crop()`
takes DIP but `toBitmap()` hands back physical pixels, and `bgraToBmp24()` then
reads that buffer as if it were 164×314 at 1×. Review proved it empirically:
rerunning the committed script under `force-device-scale-factor=2` produced a
file with a *correct* byte count and a *correct* 164×314/24bpp header while the
image content was wrong. So the header test passes and the banner is garbage —
the failure mode this project keeps hitting, a test that checks the mechanism
and not the result.

Anyone regenerating these on a HiDPI laptop gets a broken installer banner and a
green suite.

The second half is quieter and cheaper: `scripts/brand-assets.test.ts` is not in
any tsconfig `include`, confirmed with `tsc --listFiles` against both projects —
zero hits. So `npm run typecheck` never sees the one test file guarding the
brand binaries.

## Scope

**In:**

- Pin `deviceScaleFactor` in `scripts/brand-assets.mjs` so output is
  display-independent: set it explicitly on the `BrowserWindow`
  (`webPreferences.zoomFactor` / `force-device-scale-factor`), or read
  `image.getSize()` back and scale from actual returned dimensions rather than
  assuming 1×.
- A test that would catch this class of failure — assert on image *content*, not
  only header fields. Comparing a few known pixels (the obsidian ground, the
  verdigris ring) against expected values is enough; a byte-count check is what
  already passes while wrong.
- Add `scripts/**/*.ts` to a tsconfig `include` so `npm run typecheck` covers it,
  and add `scripts/**/*.ts` to the Node-globals block in `eslint.config.js`
  alongside the `.mjs` entry already there.
- Drop the redundant `build/` prefix from `win.icon`, `nsis.installerIcon`,
  `nsis.uninstallerIcon`, `nsis.installerSidebar`, `nsis.uninstallerSidebar` and
  `nsis.installerHeader`. `directories.buildResources` already defaults to
  `build`, so these resolve only via app-builder-lib's second-chance fallback
  against `projectDir`.
- Decide what to do about the header bitmap: it is full-bleed obsidian and MUI
  sets `MUI_HEADERIMAGE_RIGHT`, so it paints as a dark slab at the right end of a
  white header strip. Either give it a light ground that sits on white, or drop
  `installerHeader` and let MUI use its default.

**Out:** Code signing — the build is unsigned and SmartScreen warns on first
download; that needs a certificate, not a task. Linux and macOS targets (X-09's
remaining half). Any change to the SVG artwork. Auto-update.

## Touches

- `scripts/brand-assets.mjs`, `scripts/brand-assets.test.ts`
- `package.json` — the nsis path entries
- `tsconfig.node.json`, `eslint.config.js`
- Possibly `build/installerHeader.bmp`

## Acceptance

- [ ] Running the generator under `force-device-scale-factor=2` produces
      byte-identical output to running it at 1× — verified by actually running
      both and diffing, and recorded in the outcome
- [ ] A test asserts on pixel content, and fails if the image is scaled wrong —
      proven by regenerating at 2× without the fix and watching it go red
- [ ] `tsc -p tsconfig.node.json --listFiles | grep brand-assets` returns a hit
- [ ] `npm run lint` and `npm run typecheck` still clean
- [ ] `npm run dist` still produces a working installer, and the finish page
      still renders the sidebar correctly
- [ ] The header image either reads correctly against MUI's white strip or is
      removed

## Risks

- **Regenerating the binaries as part of this task.** If the committed files
  change, the diff stops being reviewable as a fix and becomes new artwork.
  Prefer proving the generator now produces the same bytes.
- **A pixel test that is too strict.** Anti-aliasing differs across Chromium
  versions; sample a few flat-colour regions rather than hashing the file.


---

## Outcome

Merged as `d867359`. Review non-blocking (3 should-fix, 1 nit).

**Changed:** `scripts/brand-assets.mjs`, `scripts/brand-assets.test.ts`,
`tsconfig.node.json`, `eslint.config.js`, `electron-builder.yml`; deleted
`build/installerHeader.bmp`.

The scale factor is pinned, so a regeneration on a HiDPI laptop no longer
produces a byte-count-correct, header-correct, visually-garbage banner. The
acceptance criterion asked for the 1x-vs-2x diff to be recorded here, and review
re-ran it independently: both runs produce `installerSidebar.bmp` md5
`c10dcfa12b3657e7bf4be9cf02f64714` and `icon.ico` md5
`534a384e4a78bfe456df28704f9e0f14`. Identical under
`force-device-scale-factor=2`, which is the whole point.

`scripts/**/*.ts` is now inside a tsconfig `include`, so `npm run typecheck`
covers the one test file guarding the brand binaries — confirmed with
`tsc --listFiles`, the same way review originally found it absent.

**Deferred (follow-ups, not blockers):**

- The ring sample point sits 1px from the antialiased edge, not the "several
  pixels" its comment claims — a one-pixel arc shift in a future Chromium would
  fail the test for the wrong reason.
- `icon.ico` still has no content assertion, so the scale-factor failure is only
  half-covered: the unpinned generator at 2x emitted 49005 bytes against the
  correct 73828 and all six ICO tests stayed green.
- The header's documented invocation dies under `ELECTRON_RUN_AS_NODE=1`, which
  agent shells set.
