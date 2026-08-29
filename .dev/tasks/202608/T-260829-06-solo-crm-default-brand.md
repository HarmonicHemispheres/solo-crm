---
id: T-260829-06
title: Make the rail's default brand Solo CRM's own mark and wordmark
status: done
category: ui
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The top-left of the app does not show Solo CRM's icon and logo. It shows
MagicPill Labs' — two inline SVGs hand-written into `Rail.tsx:74-116`, carried
over verbatim from the mockup, with the product name relegated to a small text
row underneath. That was correct while the app had one operator and no notion of
a configurable brand. Once the operator can supply their own icon and logo
(T-260829-07), the built-in default is what a workspace shows *before* anyone
has chosen anything, and a specific consultancy's mark is the wrong thing to put
there. Solo CRM already has its own mark and lockup in `assets/`, referenced
today by the installer generator and by nothing the app renders.

**This task is separable from the feature and can be cut on its own.** If the
default stays MagicPill Labs, T-260829-07 still works — it simply overrides a
different default. Cutting this is a decision about which brand is the fallback,
not about whether the feature ships.

## Scope

**In:**

- Replace the mark at `Rail.tsx:76-99` with `assets/solocrm-mark.svg` inlined —
  inline SVG on tokens is the established pattern (`electron/renderer/components/icons.tsx:8`,
  and the rule in `.claude/rules/ui-design.md`); nothing in `assets/` is reachable
  from the bundle today and this task does not make it so. Swap the file's hex
  literals for the tokens they equal on the way in: `#5BA4A4` → `var(--verdigris)`,
  `#C9A84C` → `var(--gold)`, `#0B0E14` → `var(--obsidian)`, `#242D39` →
  `var(--border)`, `#1E2630` → `var(--surface-3)`. A hex left in the rail is a
  defect; `tokens.css` is the only place colour is spelled out.

- Replace the wordmark at `Rail.tsx:101-115`. `assets/solocrm-logo.svg` is a
  *lockup* — the mark at `scale(0.6458)` plus the "Solo CRM" glyphs inside a
  322 × 112 rounded rect — so it cannot drop into the 104px-wide `.wordmark`
  slot as it stands. **Preferred:** extract the glyph-only group into a new bare
  `assets/solocrm-wordmark.svg` (glyphs only, no rect, no mark, tight viewBox),
  commit it, and inline that. **Fallback if extraction is impractical:** render
  the lockup across the full brand-block width and drop the separate `.mark`
  element, adjusting `.brand` in `Rail.css` accordingly. Take one or the other;
  do not ship a squashed lockup in a 104px box.

- The `.rail-app` row (`Rail.tsx:117-120`) now duplicates the product name that
  the wordmark states. Drop the `<span class="name">Solo CRM</span>` and keep the
  version chip, and make that chip **live**: it is hardcoded `v0.1` while
  `package.json` says `0.2.0`. The `app:version` channel already exists
  (`electron/main/ipc/registry.ts:148-151`) and returns `app.getVersion()`. Render
  `v{version} · local`, falling back to `local` alone while the query is in
  flight rather than flashing a wrong number.

- **Record the divergence from the mockup.** AGENTS.md calls
  `planning/solo-crm-mockup.html` the authoritative visual spec, so a rail that
  no longer matches its brand block is either a documented exception or a defect,
  and the difference between those is written down. Annotate the mockup's brand
  block (around line 478) with an HTML comment naming this task and stating that
  the shipped rail carries Solo CRM's mark and an operator override, and add a
  bullet to the mockup entry in AGENTS.md's References section beside the
  existing Pipeline/ADR-005 exception.

**Out:** any settings UI, upload, or override behaviour — that is T-260829-07,
which lands after this one. The window icon, the installer artwork and
`build/icon.ico` — all already Solo CRM's and untouched. Restyling the rail
beyond what fitting the new wordmark requires. Regenerating anything in
`assets/` other than the extracted wordmark.

## Touches

- `electron/renderer/components/shell/Rail.tsx`
- `electron/renderer/components/shell/Rail.css`
- `assets/solocrm-wordmark.svg` (new, on the preferred path)
- `planning/solo-crm-mockup.html` — comment only, no CSS or token change
- `AGENTS.md` — one bullet

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `grep -n "MagicPill" electron/renderer/` returns nothing.
- [ ] `grep -nE "#[0-9A-Fa-f]{3,8}" electron/renderer/components/shell/Rail.tsx`
      returns nothing — every colour in the brand block is a token.
- [ ] In a real window at the default rail width (`--rail: 230px`), the mark and
      wordmark sit on one line inside the 230px rail with no clipping and no
      horizontal overflow, and the wordmark is legible at its rendered size.
      Screenshot in the outcome.
- [ ] The version chip reads the version `package.json` declares, verified by
      changing the version and seeing the chip follow.
- [ ] `grep -n "tokens.css" planning/solo-crm-mockup.html` — the mockup's `:root`
      block is byte-identical to before this change; only a comment was added.
- [ ] AGENTS.md names this divergence in the References section.

## Acceptance the reviewer should not accept

"Looks right in the browser" is not the check — the rail is 230px in a real
Electron window with the app's fonts, and a wordmark that fits in a dev-server
tab can still clip there.

## Risks

- **The mockup is the authoritative spec and this deliberately departs from it.**
  Undocumented, the next person reading the mockup will "fix" the rail back. The
  annotation and the AGENTS.md bullet are the mitigation and are in scope for
  that reason.
- Glyph extraction from `solocrm-logo.svg` is fiddly: the lockup applies a
  transform to the mark group, and lifting the wordmark group without recomputing
  the viewBox yields an SVG that renders mostly empty space and therefore tiny.
  The visual acceptance criterion is what catches it.
- `.wordmark` is `fill: currentColor` on `--papyrus`. A wordmark carrying its own
  fills will ignore that and may land off-palette; keep it on `currentColor`.
- The `.rail-app` row also carries the `local` affordance, which is a real claim
  about the app. Dropping the whole row rather than just the name would remove it.

---

## Outcome

**Changed:**

- `assets/solocrm-wordmark.svg` (new) — the lockup's glyphs alone, on a tightened `viewBox`.
- `electron/renderer/components/shell/Rail.tsx` — Solo CRM's mark and the extracted wordmark inlined on tokens; the duplicated `.rail-app` name span dropped; the version chip now a live `app:version` query.
- `electron/renderer/components/shell/Rail.css` — the `.rail-app .name` rule deleted, replaced by a comment saying why the mockup has it and the app does not.
- `electron/renderer/components/shell/Rail.test.tsx` — harness gains `QueryClientProvider` and `stubCrm`; the old "renders the app name" test became a wordmark-identity test; four new version-chip tests.
- `planning/solo-crm-mockup.html` — an 11-line divergence comment above `.brand`, and nothing else.
- `AGENTS.md` — a second exception bullet beside the Pipeline/ADR-005 one.

**The preferred path was taken: the glyphs were extracted, not the lockup
squashed.** The builder parsed every coordinate of the lockup's two glyph paths
— all commands absolute `M`/`L`/`Q`, so control points bound the curves — giving
bounds x 110.17–291.95, y 40.15–71.63 and a `viewBox` of `109.5 39.5 183 33`.
The glyphs fill ~99% of its width and ~95% of its height, so this is not the
"renders mostly empty space, and therefore tiny" failure the scope warns about.
At the 104px slot that is ~18.8px of cap height against the ~17.3px the MagicPill
wordmark had, so the brand row's optical weight is unchanged. The fallback was
not needed.

**Review:** no blocking findings.

*Mutation-tested.* The version chip has two properties and both are pinned. The
builder replaced the interpolation with a hardcoded `v0.2.0 · local` → 2 tests
red. Independently at merge, the in-flight fallback was changed from `local` to
`v0.1 · local` — the exact wrong number this task exists to remove, in the exact
state where flashing it would be invisible to a test that only checks the
resolved case → 2 tests red. Both reverted with targeted edits.

Checked by reading rather than trusting: the wordmark extraction arithmetic
above; `.wordmark` still on `fill: currentColor`, with "Solo" carrying no fill so
it inherits `--papyrus` and only "CRM" naming `var(--verdigris)`; the mockup diff
a single 11-insertion hunk at `@@ -475,6 +475,17 @@`, nowhere near the `:root`
block at lines 11-21; and the two owned-line boundaries with T-260829-10 respected
— the first hunk starts at line 17, eight lines clear of the `CatalogueIcon`
import.

**Two things a person still has to look at**, both listed here because neither is
machine-checkable and the task's own acceptance says so:

1. **The wordmark's rendered height in a real 230px window.** The arithmetic says
   17+25+10+104+17 = 173px of 230px, but that sum has no fonts and no drop-shadow
   in it. It should read as ~19px of "Solo CRM" filling its box, not a small mark
   in whitespace. If it looks tiny, the `viewBox` is wrong, not the extraction.
2. **`stopColor="var(--verdigris)"` inside the mark's `radialGradient`.** `var()`
   in a presentation attribute is the established pattern in this file — the
   outgoing mark used `stroke="var(--verdigris)"` and shipped — and `stop-color`
   goes through the same mechanism, so it is expected to work. If Chromium
   declines it the stops fall back to black at 0.2/0.07/0 opacity over
   `--obsidian`, which is near-black: the inner glow simply would not show, the
   mark is otherwise unaffected, and `.brand .mark`'s own drop-shadow still
   carries the glow. The degraded case is cosmetic, which is why this merged
   rather than blocking.

`typecheck`, `lint`, the full `--project=renderer` (51 files, 426 tests) and the
tokens test all passed on the branch; `Rail` (15 tests) and `tokens` (24) passed
again on the merged tree.

**Deferred:**

- **`grep -rn "MagicPill" electron/renderer/` is not empty, deliberately.** Two
  hits remain, both in `WorkspaceSettings.test.tsx` — a `SettingsSnapshot`
  fixture setting `workspace.name: 'MagicPill Labs'` beside
  `workspace.operator: 'Robby Boney'`, and the assertion that reads it back.
  That is operator-*supplied data*, which is precisely what this branding feature
  makes configurable, not brand chrome the app ships. Nothing the app renders as
  branding says MagicPill any more, which is what the criterion was written to
  prove. Editing the user's own company name out of an unrelated view's fixture
  to make a string search return empty would satisfy the letter against the
  intent, so it was left — flagged rather than silently changed, since that name
  is the user's to keep or drop.
- The visual acceptance criterion and its screenshot are outstanding, per the two
  items above. They belong with
  [T-260828-15](T-260828-15-real-window-qa-pass.md).
