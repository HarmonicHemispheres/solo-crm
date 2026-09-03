---
id: T-260902-13
title: Turn the rail's Revenue item into a Reports group that expands, with Revenue inside it
status: done
category: ui
plan_ref:
created: 2026-09-02
closed: 2026-09-03
---

## Why

Revenue is one report and there are about to be two. A flat nav item named
after one of them has nowhere to put the second, and renaming it later moves
the operator's muscle memory twice instead of once.

## Story

As the operator, I click **Reports** in the rail and it expands to show
Revenue — and, once T-260902-16 lands, Timeline — instead of jumping me
straight at one report as though it were the only one.

## Constraints

- Reports is a group header, not a route. Clicking it expands and collapses;
  it has no page of its own. The operator settled this.
- `NAV_ITEMS` and `ROUTE_META` in `electron/renderer/nav.ts` are two
  hand-written descriptions of the same set and `routes.test.tsx` checks they
  agree — a nested item must not break that.
- `/revenue` keeps its path. The command palette, breadcrumbs and
  `getActiveNavId` must all still resolve it, and the breadcrumb should read
  the group ("Reports / Revenue"), not lose it.
- The group's expanded/collapsed state persists across launches, on the same
  `settings` key-value table everything else uses (ADR-002).
- Rail.css's `max-width:900px` off-canvas mode still has to work.

## Acceptance

- [ ] The rail's Work group shows Today, Todos, **Reports**, Activity; no item
      labelled Revenue sits at the top level.
- [ ] Expanding Reports reveals Revenue; navigating to `/revenue` lights it up
      and leaves the group open.
- [ ] Collapsing the group, quitting and relaunching leaves it collapsed.
- [ ] `npm run snap` — `today`, `revenue` at 700/900/1440 read correctly.
- [ ] Open the app, click Reports, click Revenue, land on the Revenue page
      with "Reports / Revenue" in the breadcrumb.

## Related

- `electron/renderer/nav.ts`, `routes.tsx`, `routes.test.tsx`
- `electron/renderer/components/shell/Rail.tsx` / `Rail.css`
- `electron/renderer/components/shell/Breadcrumb.tsx`

---

## Outcome

**Changed:** `nav.ts` gains a `NavSubgroupId` vocabulary, `NAV_SUBGROUPS`,
`parent` on Revenue, `railRowsFor()`, `getActiveNavSubgroupId()` and the
`Reports / Revenue` crumb; `Rail.tsx` splits into `NavRow` and
`NavSubgroupRow` and reads/writes the group's state; `Rail.css` gets the
header caret, the guide line and the nested row; `icons.tsx` gets
`ReportsIcon` and `NavChevronIcon`; `shared/settings.ts` gets
`nav.reportsExpanded`. Tests: `nav.test.ts` and `Rail.test.tsx`. Five
`SettingsSnapshot` fixtures updated because the type is exhaustive.

**Departed from scope:**

- **A collapsed group does not spring open when its child is the active
  route.** The scope's "navigating to `/revenue` … leaves the group open" is
  met by the default being expanded, not by an override — an override would
  make the collapse control do nothing at all while standing on Revenue,
  which is exactly when it gets reached for. Instead the *header* takes the
  active mark while collapsed, so the group still says where you are.
- **The mockup annotation and the AGENTS.md exception were not in the
  scope** and should have been: the rail now diverges from the authoritative
  visual spec, and the adherence review caught the omission. Both added, no
  ADR — a rearrangement of one nav item is the weight of T-260829-06's brand
  block, not ADR-005's or ADR-014's.
- `query-keys.ts`'s comment on `invalidate.settings` claimed settings writes
  happen "a few times in the life of a workspace". This toggle makes that
  false, so the comment now says what the new caller costs and why the shared
  prefix still holds.

**Not verified:** nothing in the acceptance. The relaunch case is covered by
the settings row plus a fresh-mount test rather than by actually restarting
the app.

**Found, not fixed — outside this task.** `code-review` at medium turned up
three defects in already-committed code: a `tm_actual` month double-counting
after regeneration (`revenue-generator.ts:305`), `ConfirmDelete`'s impact
query serving stale counts from cache (`ConfirmDelete.tsx:87`), and
`regenerateAllRevenueLines` running unguarded in `whenReady` so one bad
`started_on` makes the workspace unopenable (`main/index.ts:107`). Scoped
separately rather than folded in here.

**Elapsed:** 95 minutes.
