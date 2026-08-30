---
id: T-260828-15
title: Real-window QA pass — focus rings, rail `inert`, breakpoints, route-meta guard
status: done
category: ui
plan_ref: P0-10
created: 2026-08-28
closed: 2026-08-30
---

## Why

Run R-260828-01 proved that jsdom certifies structure, not paint: T-260828-11
shipped a design system that was green in tests while never imported at
runtime, and T-260828-12's blocking defect (palette painting under the
sheet's scrim) was invisible to every DOM assertion. Both tasks closed with
items that only a real window can check. This task is that window, before
the P1-1x view tasks start building on top of whatever it finds.

## Scope

**In:**

- Boot the built app (`ELECTRON_RUN_AS_NODE` unset) and compare against
  [planning/solo-crm-mockup.html](../../../planning/solo-crm-mockup.html)
  at 1440px, 900px and 700px: layout, tokens actually applied, no
  horizontal body scroll — T-260828-12's acceptance line checked for real.
- Keyboard walk of the whole shell: visible focus rings on every stop, rail
  reachable by Tab and activating on Enter, Esc/⌘K/⌘L behaving as the jsdom
  tests claim.
- The below-900px off-canvas rail is currently `left:-250px` with no
  `visibility`/`inert` — Tab walks into an invisible menu (T-260828-12
  review nit). Confirm in-window, then fix with `inert` (or
  `visibility: hidden` delayed past the transition) without breaking the
  slide animation.
- Make the `ROUTE_META` ↔ `AppRoutes` agreement test bidirectional — today a
  route added to `AppRoutes` alone highlights no nav item with every test
  green (T-260828-12 review nit).
- Layer dialogs: role, focus-return and aria audited with devtools, not
  only testing-library queries.

**Out:** Fixing any *view* content — there is none yet. Restyling anything
that matches the mockup. Automated visual-regression tooling (worth its own
decision if this pass finds enough).

## Touches

- `electron/renderer/components/shell/Rail.css` — the `inert`/visibility fix
- `electron/renderer/routes.test.tsx` — the bidirectional guard
- Whatever the pass finds, each as its own small commit

## Acceptance

- [ ] A written pass/fail list against the mockup at all three widths, filed
      in this task's Outcome
- [ ] Tab never lands on an element that is not visible
- [ ] A route present in `AppRoutes` but missing from `ROUTE_META` fails a test
- [ ] No horizontal body scroll at 1440px, 900px or 700px, in a real window

## Risks

- A screenshot pass with no checklist degrades into "looks fine". The
  mockup is the checklist; every deviation is either fixed or written down
  as deliberate, nothing in between.
- Real-window Electron boots flaked under load during R-260828-01; run this
  serially, not alongside another build.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

---

## Progress — the machine-checkable half is merged (R-260828-03)

This task stays **open**. Two of its four acceptance criteria are met and on
`main`; the other two need a person at a real window, and are not claimed.

### Done, merged, and guarded by a test

**`A route present in AppRoutes but missing from ROUTE_META fails a test.`**
`routes.test.tsx` walked `ROUTE_META` and proved every entry resolved — one half
of an agreement, and the only half checked. A `<Route>` added to `AppRoutes`
alone, which is the ordinary way a view gets added, highlighted no nav item,
showed no breadcrumb, and **left every test green**. The guard now reads
`routes.tsx`'s own source and requires each declared path to have a `ROUTE_META`
entry, with three exclusions each stated in the code (`*` is a redirect,
`workspace` is a layout wrapper, an `index` route has no path attribute at all).

It imports the source through Vite's `?raw` rather than `node:fs`, because a
renderer module may not touch the filesystem and **blunting that rule to let a
test read a file would trade a real boundary for a convenience.** A sanity
assertion requires at least eleven declared paths, so a rename or a change in
how routes are written cannot turn the scan into a vacuous pass over nothing.

*Verified by mutation:* adding `<Route path="reports">` with no `ROUTE_META`
entry fails the new case and nothing else; removed, 20/20.

**`Tab never lands on an element that is not visible.`** Below 900px the rail
was `left: -250px` and nothing more — still in the document, still focusable, so
Tab walked into an invisible menu of eleven nav items and a footer. Fixed with
`visibility: hidden`, delayed past `--motion-rail` so the slide still runs, and
`visibility: visible` with no delay on `.rail.open` because a rail sliding *in*
must be focusable from the first frame.

`visibility` rather than `inert` or `display: none` because it is the only one
of the three that is animatable — the others would remove the tab stop and the
animation together.

*Verified by mutation:* removing `visibility: hidden` fails the new test.

**That mutation check is the reason this section can be trusted, because the
first version of the test passed with the fix removed.** The rule's own
explanatory comment contains the words `visibility: hidden`, so every assertion
was matching prose instead of a declaration. Comments are stripped now. This
project has hit that trap three times — a doc comment tripping
`connection.test.ts`'s Database-owner walk, the ADR-003 money guard needing the
same strip, and here.

### Not done — needs a person at a real window

- [ ] **A written pass/fail list against the mockup at 1440px, 900px and
      700px.** Layout, tokens actually applied, compared with
      `planning/solo-crm-mockup.html`.
- [ ] **No horizontal body scroll at any of the three widths, in a real
      window.** jsdom computes no layout, so nothing automated can answer this;
      a test that claimed to would be measuring nothing.

Also unexercised, and listed so it is not mistaken for covered: the keyboard
walk of the whole shell, and the layer-dialog role/focus-return/aria audit with
devtools. The jsdom tests assert what they can reach; a real window is where
`Esc`/`⌘K`/`⌘L` and focus return are actually seen.

**Boot it with `npm run dev`, or install the built artefact.** The rail fix is
the one to look at first — resize below 900px, close the rail, and Tab through
the page.

---

## Outcome

Closed 2026-08-30 (R-260829-03). The two criteria left open in the progress
note above are now met, against a real Chromium window rather than jsdom.

**How the pass was run.** `scripts/window-pass.mjs` (new) boots the built app
— `out/main` + `out/preload` + `out/renderer`, the same entry `npm run dev`
uses — with `--user-data-dir` pointing at a throwaway, freshly seeded profile,
attaches over the Chrome DevTools Protocol, and records geometry plus a
screenshot per route per width. It never touches the operator's own database,
and because the temp profile already holds a `solocrm.db`, main resolves the
first-run location flow with no dialog, exactly as its comment says.

It is deliberately **not** wired into `npm test`. That would be the automated
visual-regression tooling this task's Scope puts out of bounds; the note there
says it is "worth its own decision if this pass finds enough". It found
enough — that decision is the user's, not this task's.

### The list, at 1440 / 900 / 700

| Check | 1440 | 900 | 700 |
|---|---|---|---|
| No horizontal body scroll | pass (1430/1430) | pass (890/890) | pass (690/690) |
| No element past the viewport | pass | pass | pass |
| Rail on-canvas ≥900, off-canvas below | pass | pass (`visibility:hidden`, `left:-250px`) | pass |
| Rail not focusable when off-canvas | pass | pass | pass |
| Tokens applied (`--verdigris` #5BA4A4, body #0B0E14) | pass | pass | pass |
| Exactly one gold hero value | pass | pass | pass |
| Focus ring visible on rail nav | pass (2px solid #5BA4A4) | pass | pass |
| Stat grid reflows without clipping | pass (4 across) | pass (3+1) | pass (3+1) |
| Cards collapse rather than scroll sideways | pass | pass | pass |

The `900` column is the breakpoint boundary itself and behaves as the mockup
specifies: the rail leaves the flow and the hamburger appears.

### Three defects found, all fixed on main

**1. Every cadence decay bar rendered at 0px, in four views.** `.decay .fill`
is a `<span>`, therefore `display: inline`, and `width` does not apply to a
non-replaced inline box. The bar computed `width: 100%`, animated to
completion with `forwards`, and painted nothing: an empty grey track wherever
a cadence meter appears. `.track` escapes only by accident, because `.decay`
is a flex container and blockifies its children. Measured: `display: inline`
→ 0px; with `display: block` → 56px, the full track.

This was transcribed faithfully from the mockup, which carries the same
declaration and could not reveal it. **No jsdom test could have caught it** —
jsdom computes no layout, so `getBoundingClientRect()` is 0 for everything and
a width assertion passes against the broken CSS. It has been shipping since
the Companies view landed (T-260828-28): `DecayMeter` is consumed by
Companies, CompanyDetail, People and Today.

*Correction to this run's own record:* T-260829-13's "Why" claims `DecayMeter`
"shipped in T-260828-11 and no view renders either one". That is wrong — four
views render it. The claim came from a `grep -l … | head` whose output was
truncated before the `views/` entries. The task's actual value stands (the
decay arithmetic was still duplicated per view, which is why `Companies.tsx`
carries its own `decayColor` mirroring DecayMeter's thresholds), but the
premise was overstated and is corrected here rather than left standing.

**2. Three stylesheets declared the same unscoped `.tli` selectors.**
`Activity.css`, `CompanyDetail.css` and `PersonDetail.css` each transcribed
the mockup's timeline classes — `.tl`, `.tli`, `.tli .t/.d/.note` — into the
global namespace. Whichever the bundler emitted last styled all three views.
The detail views won, and they declare `.tli .d { display: block }` because
their meta row is plain text; Activity's is a `Tag`, a timestamp and a
variable number of entity links needing `display: flex; gap: 5px`. The result
was `Aug 29, 2026, 9:32 AMRinvii` — every element butted against the next — on
the Activity view and in Today's Recent card, which renders the same
`ActivityItem`. Fixed by scoping this file's rules under `.tl-log`; measured
after: `display: flex`, 5px between each child.

`CompanyDetail.css` and `PersonDetail.css` declare byte-identical timeline
blocks, so they cannot disagree with each other — scoping Activity is the
whole fix for the visible collision. What remains is duplication, not a
defect, and is recorded as a follow-up rather than restyled here.

**3. `npm run seed` produced a database the app refuses.** Not a layout
finding, but the pass could not start without fixing it, so it is recorded
here. `tasks.waiting_since` is `timestampSchema` and the repository stamps it
with `nowTimestamp()`, but the seed wrote it through `shiftDateOnlyOrNull` —
the date-only shifter — putting bare `YYYY-MM-DD` in the column. Every
`tasks:list` against a seeded database then failed its response schema, and
Today, Todos and every other task-listing view rendered *"tasks:list: the
response was not in the expected shape"* instead of any content. The fix is
one line; the adjacent `done_at` already used the right helper.

The guard added with it is the general one: `seed/index.test.ts` now reads
every seeded row back through the repository the app calls and parses it with
the wire schema the IPC layer validates against, for all five entity kinds. A
field added to any of those schemas is covered without this list changing.
Verified by reverting the one-line fix: the new test goes red, and only it.
The neighbouring test named `companies.last_touch_at` in its title while never
querying that column — also fixed, with `people.last_contact_at` added.

**Not exercised, and not claimed:** the full keyboard walk of every stop, and
the layer-dialog role/focus-return/aria audit with devtools. The focus ring
and rail focusability were measured; `Esc`/`⌘K`/`⌘L` were not driven by hand.
`scripts/window-pass.mjs` is where that would be added.

**Changed:** `scripts/window-pass.mjs` (new), `DecayMeter.css`,
`Activity.css`, `Activity.tsx`, `Today.tsx`, `db/seed/index.ts`,
`db/seed/index.test.ts`. Gate green: typecheck, lint, **1438 tests**,
`check:index`.
