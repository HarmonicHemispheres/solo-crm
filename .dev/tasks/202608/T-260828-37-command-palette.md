---
id: T-260828-37
title: Build the command palette (⌘K) — search everything, lead with create commands
status: open
category: ui
plan_ref: P1-10
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The palette is how a single-user desktop tool stays fast without growing a
navigation surface for every path. §6.9 wants one keystroke that reaches any
record and any create action, and the plan puts P1-10 in the P1-CUT subset for
that reason. It also has a hard performance requirement — results within one
frame of a keystroke at 10× data volume (§8) — which is why it comes after the
FTS index rather than being built on client-side filtering that would have to be
thrown away.

## Scope

**In:** A palette overlay bound to ⌘K (Ctrl+K), through the existing
`LayerManager` so Esc dismissal stays centrally owned:

- Searches companies, people, engagements, catalogue entries, todos and activity
  notes through a `search:query` channel over T-260828-36's `searchAll`.
- **Leads with create commands** — every item in the New menu is reachable here,
  ranked above record matches when the query is short.
- Arrow keys move, Enter activates, and each row carries a **kind label** and a
  hint so a result is identifiable without guessing from the title alone.
- Enter on each result type lands on the right view: a company on
  `/company/:id`, a person on `/person/:id`, an engagement on `/engagements`
  scrolled to it, a todo on `/todos`, an activity note on `/activity`.
- Debounced query with results rendered from cached data where possible, to hold
  the one-frame budget.

**Out:** The FTS index itself (T-260828-36). The quick log (T-260828-35) —
separate shortcut, separate overlay, though a "log activity" command here should
open it. Natural-language or AI-assisted search. Saved searches (P2-08).

## Touches

- `electron/renderer/components/shell/CommandPalette.tsx` — new
- `electron/renderer/hooks/useGlobalShortcuts.ts` — bind ⌘K
- `electron/shared/ipc-types.ts`, `electron/main/ipc/registry.ts` — the
  `search:query` channel
- `electron/renderer/components/shell/LayerManager.tsx` — consumed, unchanged

## Acceptance

- [ ] Results update **within one frame of a keystroke at 10× data volume**
      (roughly 100 companies, 500 engagements, 20k activity rows) — measured
      against a generated fixture and asserted, not eyeballed (§8, X-07)
- [ ] Every create command in the New menu is reachable from the palette, checked
      by comparing the two lists in a test rather than by hand
- [ ] Enter on each of the six result types lands on the correct view — one
      assertion per type
- [ ] Every row shows a kind label, so two records with the same name are
      distinguishable
- [ ] Arrow keys and Enter operate the whole palette; no mouse is required (X-06)
- [ ] Esc dismisses through `LayerManager`, not a local handler
- [ ] An empty query shows create commands and recent records rather than a
      blank panel
- [ ] A query matching nothing states that plainly

## Risks

- **Client-side filtering as a shortcut** while FTS lands. It passes at seed
  volume and fails the §8 budget, and by then the palette is written against the
  wrong data source.
- **The one-frame budget measured by feel.** X-07 exists because an unmeasured
  non-functional requirement is a wish; this is the first place that bites.
- **Taking Esc locally** — the same finding already raised on T-260828-12.
- **The New menu and the palette drifting apart.** Two hand-maintained lists of
  create actions is exactly the drift `nav.ts`'s `ROUTE_META` test was written to
  prevent elsewhere; use the same approach.
