---
id: T-260828-12
title: Build the app shell — rail, topbar, router, layer dismissal
status: done
category: ui
plan_ref: P0-10
created: 2026-08-28
closed: 2026-08-28
---

## Why

Every view task from P1-11 onward needs somewhere to render and a route to be
reached by. The shell is also where the two global keyboard entry points live —
`⌘K` and `⌘L` — and where `Esc` closing any open layer is decided once instead
of eleven times.

## Scope

**In:**

- The rail from the mockup: three nav groups (Work · Records · Workspace), their
  items and count slots, the database chip at the foot. Counts wire up as their
  entities arrive; render a placeholder rather than a zero that looks like data.
- The topbar: breadcrumb, search button with its `⌘K` hint, the New menu.
- Routing for all ten views — Pipeline is dropped (ADR-005), do not port its
  nav item or route — plus the two detail routes (`company/:id`,
  `person/:id`), with the active nav item derived from the route — including
  detail routes highlighting their parent, as the mockup does.
- A layer manager: palette, sheet, log sheet, menu and popover. **`Esc` closes
  the topmost open layer**, and opening one closes the popover and menu. One
  place, not per-component.
- Keyboard registration for `⌘K` and `⌘L` that the palette and quick-log tasks
  hang their handlers on — the shell owns the shortcut, not the feature.
- The 900px collapse: rail off-canvas with a toggle, topbar keeping its actions.

**Out:** The palette itself (P1-10) and quick-log (P1-09) — this task provides
the shortcut and the layer, not the content. Any view body. The Pipeline nav
item, which T-260828-02 decides.

## Touches

- `electron/renderer/App.tsx`, `routes.tsx`
- `electron/renderer/components/shell/{Rail,Topbar,Breadcrumb,NewMenu}.tsx`
- `electron/renderer/components/shell/LayerManager.tsx`
- `electron/renderer/hooks/useGlobalShortcuts.ts`

## Acceptance

- [ ] Every route in the mockup resolves and highlights its nav item; `company/:id`
      highlights Companies
- [ ] `Esc` closes the topmost layer only — with a sheet open over the palette,
      one press leaves the palette open
- [ ] `⌘K` and `⌘L` fire from every route, including with focus inside a text
      input, and do not fire twice when a layer is already open
- [ ] Below 900px the rail goes off-canvas with a working toggle and the topbar
      keeps its actions
- [ ] The whole shell is keyboard-navigable with visible focus rings; the rail is
      reachable by `Tab` and its items activate on `Enter`
- [ ] No horizontal body scroll at 1440px, 900px or 700px
- [ ] Dialog layers carry the right roles and return focus to their trigger on
      close

## Risks

- **`Esc` handled per-component is the default outcome** and produces a nested
  sheet that closes its parent too. A layer stack decided here costs an hour;
  retrofitted across eleven views it costs a day.
- `⌘L` in a browser context is the address bar, and `⌘K` is a search in many
  apps. In Electron these are ours, but a `preventDefault` missed means the
  shortcut works everywhere except inside an input — which is exactly where
  quick-capture gets used.
- **Counts on nav items are data the shell does not own.** Wiring them to real
  queries here creates a dependency on entities that do not exist. A placeholder
  that is visibly not a number is better than `0`, which reads as "no companies".
- `ui-design.md` caps a view at five to seven primary regions and eleven views
  total. The shell is where a twelfth would be added without noticing; the nav
  groups are closed unless a decision says otherwise.
- Route structure constrains X-01's Workspace → Data view and the settings view,
  both of which are sub-routes of Workspace. Model them as nested routes now
  rather than as two top-level entries.

---

## Outcome

Merged to main in run R-260828-01 (build `0d0ec52` + review fixes at merge
`391f884`, merge `dd177e5`). HashRouter (survives reload under packaged
`file://`) → `routes.tsx` with all ten views — Pipeline deliberately absent
per ADR-005, two tests assert its absence — plus `company/:id` / `person/:id`
highlighting their parent nav items and `/workspace/{settings,data}` nested
for X-01. The three-group rail with en-dash placeholder counts (`aria-hidden`,
a test asserts no digit ever renders), the database chip, and the 900px
off-canvas collapse; topbar with breadcrumb, ⌘K search button and New menu;
`useGlobalShortcuts` registering ⌘K/⌘L once at the shell (fires from inside
inputs; `preventDefault` before the open check); `LayerManager` owning the
palette/sheet/log/menu/popover stack from one document-level Esc handler.
Dropped the mockup's "synced 14m ago · 1.4 MB" chip deliberately — pull-only
integrations make it fiction; the reviewer judged the call correct, likewise
`--motion-rail: .2s` (mockup line 461 verbatim).

Review (opus, combined gate) found the task's own named central risk realized
despite green tests: `Sheet`'s standalone document-level Esc listener
(T-260828-11 behaviour) fired alongside the manager's central handler, so a
palette stacked over a sheet closed *both* on one press — the sheet/log
mutual exclusion only covered the ordering the tests exercised, and the
reverse was reachable in two keystrokes. The same cause painted the palette
under the sheet's scrim (equal `.scrim` z-index, fixed JSX order) while
focusing its now-invisible input. Fixed at merge: `Sheet` gained a
`closeOnEscape` prop (default true — standalone behaviour unchanged) and the
manager renders both sheets with it off, making the central handler the only
thing Esc reaches; the sheet/log mutual exclusion dissolved, so the create
form and quick-log stack independently as the mockup keeps them (⌘L no longer
silently discards a half-filled form — the review's should-fix); overlays
render DOM-ordered by stack position so the topmost paints above. Also fixed:
`openLayer` no longer retargets the focus-return trigger on a re-open, and
`Shell` ports the `scrollTo(0,0)` half of the mockup's `go()`. The vacuous
double-fire test was replaced with a mocked-context pin of the `isOpen`
guard, and reverse-ordering Esc, paint-order, sheet/log-independence and
trigger-preservation tests added — the Esc tests proven by re-enabling the
primitive's listener and watching them fail. 351/351 on the branch and on
the merged tree.

Recorded as follow-ups, not fixed here: the shell's raw `.btn` classes are
the missing Button primitive (T-260828-14); the below-900px off-canvas rail
lacking `visibility`/`inert` (Tab reaches an invisible menu) and the
one-directional `ROUTE_META` ↔ `AppRoutes` agreement test both fold into the
real-window QA pass (T-260828-15) that T-260828-11's outcome also feeds.
