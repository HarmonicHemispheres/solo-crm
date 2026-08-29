---
id: T-260829-06
title: Make the rail's default brand Solo CRM's own mark and wordmark
status: open
category: ui
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
