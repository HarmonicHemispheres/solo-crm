---
id: ADR-014
title: Workspace Settings is a section rail over one card at a time, not the mockup's card grid; Data stays its own view
status: accepted
date: 2026-09-01
---

## Context

The mockup's settings view (`planning/solo-crm-mockup.html`, `views.settings`,
line ~1285) is a `repeat(auto-fit, minmax(340px, 1fr))` grid of **five** cards:
Identity, Default cadence, Integrations, Backup & appearance, Shortcuts.
T-260828-38 transcribed that grid faithfully. The shipped page
(`electron/renderer/views/WorkspaceSettings.tsx`) now holds **seven** — Branding
(T-260829-07) and Guided tour (T-260829-15) were added since — and two plan
items add to the same page again: P4-08 gives every integration a last-sync
time and status, X-04 gives Backup a last-run time and snapshot count.

Three forces make this a decision rather than a tidy-up:

1. **Auto-fit reflows by width.** With seven cards of unequal height, which
   card sits where depends on the window width, so the same control is in a
   different place on a maximised window than in a half-screen one. A settings
   page is looked up, not scanned — the operator comes for one control and
   wants it where it was last time. The grid is the reason the page is
   disorienting, and it is the mockup's own grid.
2. **`ui-design.md` caps a view at five to seven primary regions**, with seven
   as "the ceiling rather than the starting point". Seven cards is at the
   ceiling today and over it on the day P4-08 or X-04 lands. The rule's own
   remedy is "something merges or moves behind a tab, sheet or detail route".
3. **AGENTS.md names the mockup authoritative** and lists exactly two
   departures — Pipeline ([ADR-005](ADR-005-pipeline-view.md)) and the brand
   block (T-260829-06, annotated in the mockup). Without a third record, the
   next agent who reads the mockup restores the grid and is right to.

Two constraints already decided elsewhere bound the answer. T-260828-38's
acceptance — carried into the task plan as P2-09 — requires that "a panel whose
behaviour hasn't landed elsewhere … says so plainly rather than storing a value
and implying an effect". And §6.11 requires that the integrations UI "must
state" pull-only, which T-260828-38 asserted in a test over rendered output.
Both are statements about what is *visible*, and a layout that hides them
behind a click reverses them silently.

## Decision

### 1. The shape: a section rail, one section visible at a time

The settings view becomes a two-column layout: a **section rail** on the left
listing the page's primary sections, and a **content column** on the right
showing **exactly one section at a time** — the one the rail has selected.
`.settings-grid` is removed. The `Card`, `.setrow`, `.switch`, `.steps`,
`.stepb`, `.field` controls are unchanged; only their arrangement is.

- The rail is a `<nav>` labelled for the page ("Settings sections"), holding
  one real `<button>` per section in the order given in §2 below. The selected
  item carries `aria-current="true"` and a visible selected state; the
  selection is never colour alone. Tab moves between the buttons in order —
  no roving tabindex, matching the app rail's own `Link`s. Activating a button
  swaps the content column and leaves focus on the button, so the content
  region is the next Tab stop in DOM order.
- The content column is a `<section>` whose accessible name is the selected
  section's heading. It shows one section's card; nothing from the other
  sections is mounted. A section change is an immediate swap with no
  transition, so `prefers-reduced-motion` has nothing to remove — the
  section change is the meaning and there is no animation carrying it.
- The content column is left-aligned beside the rail with a `max-width` of
  720px. A `.field` row stretched across a maximised window is the failure
  the card grid's 1fr columns happened to prevent, and a single column needs
  the cap the grid gave for free.
- **The selected section is component state, defaulting to the first section
  on every visit.** It is not persisted in the `settings` table, not a route
  and not a location hash. Persisting it would put the operator on *last
  time's* section, which is the "nothing is where it was" complaint in a new
  form; routing it would add six leaf routes to `ROUTE_META` for a page
  nothing deep-links into (the tour's `finishPath` is `/workspace/settings`,
  the palette has no settings result). T-260901-09 therefore adds no setting
  key, and `electron/shared/settings.ts` is untouched.

**Why the rail beats the grid here.** The grid gives every card equal standing
and lets width decide adjacency; the rail gives the page a fixed order and a
table of contents, and showing one section at a time caps the visible regions
at one card regardless of how many sections exist. That is what makes P4-08
and X-04 additive rather than a fresh layout crisis: a new row in Integrations
or Backup lengthens one section, and a genuinely new subject is one more rail
entry, not one more thing competing for position.

**Why it does not become a pattern.** A secondary rail is permitted only where
all three hold: the sections are a **fixed set known at build time** rather
than records; the view is **at or over the region ceiling** and no two
sections can merge without lying about their subject; and **no section is a
record's detail** — detail belongs on the record's own route. Settings is the
only view that meets all three. Companies, People, Engagements, Todos and
Activity are lists of records; Today is a dashboard of five regions; Data is
four regions under the ceiling. A view that later qualifies must first fail
the ceiling and be unable to merge — the rail is the remedy of last resort
`ui-design.md` already lists, not a first move.

### 2. The sections and their order

Six sections, in this order. Each is exactly one `Card`; where a section has
two groups they are two `Card.Header` siblings inside that one card, which is
the shape `Card.tsx`'s own header recommends over nested cards.

| # | Rail label | Card header(s) | Holds |
|---|---|---|---|
| 1 | **Identity** | Identity · Branding | workspace name, operator, currency, fiscal year; then the icon and logo slot rows |
| 2 | **Default cadence** | Default cadence | one `.setrow` per `COMPANY_KINDS` member with its stepper |
| 3 | **Integrations** | Integrations | one switch per `INTEGRATION_SOURCES` member with its row note |
| 4 | **Backup** | Backup | nightly export switch, folder row with its disabled picker |
| 5 | **Appearance** | Appearance | interface motion, compact density |
| 6 | **Help** | Shortcuts · Guided tour | the generated shortcut reference and the Esc row; then the tour row and its button |

What merged, what split, and why:

- **Branding merges into Identity.** Two image slots are the workspace's
  identity as much as its name is, and each half is short on its own. The
  merge is visual only: the Branding group keeps reading `branding:get` and
  writing `branding:choose`/`branding:clear`, and is not folded into the
  settings snapshot (T-260901-09's own risk names this).
- **Backup & appearance splits.** The mockup grouped them because each was
  two rows and the grid wanted a card; that is the grouping the task named as
  not surviving a rail. They are different subjects with different futures —
  Backup grows with X-04, Appearance does not — and a rail entry named for
  two subjects is one an operator has to guess at.
- **Shortcuts and Guided tour merge into Help.** Neither is a setting; both
  are orientation. `WorkspaceSettings.tsx`'s Guided tour comment refused to
  put the tour *inside Shortcuts* because "a button that does something is
  not a keyboard reference" — that reasoning still holds and is honoured:
  Shortcuts stays a read-only group generated from `GLOBAL_SHORTCUTS`, and
  the tour is a second group with its own header beneath it. The section is
  named Help, not Shortcuts, so the operator who "would come here looking for
  [the tour] by name" finds a rail entry that answers.
- **Order follows the mockup wherever the mockup had an opinion** — Identity,
  Default cadence, Integrations, Backup & appearance, Shortcuts — with the
  split and the merges applied in place. The departure from the spec is the
  layout, and it is kept to the layout.

### 3. Data stays its own view

**`/workspace/data` keeps its nav item, its route and its breadcrumb.** It is
not a section of the settings rail, and no follow-up task to fold it in is
filed. `nav.ts`, `ROUTE_META` and `Breadcrumb.tsx` are unchanged.

- The `/workspace` parent route is a URL fact (X-01), not a UI statement. The
  mockup's own breadcrumb already reads `Workspace / Data` while drawing two
  nav buttons; `nav.ts` says so in its `path` comment. The shipped rail
  matches the mockup here and this ADR keeps it matching.
- Data is not settings. It is a read of a *file* — size, path, journal mode,
  schema version, row counts, and a read-only console — fetched with
  `staleTime: 0` against the app-wide `Infinity`, the one page in the app
  that overrides it (`WorkspaceData.tsx`'s header). Its saved snippets are
  the only preference on it. Putting a query console one rail entry away from
  "workspace name" mixes a page you *set* with a page you *run*.
- It is the page the rail's `dbchip` links to from every route — the one
  place an operator can see where their database is. Folding it into a page
  that opens on Identity buries that behind a second click, or forces the
  section to be routable, which pulls the routing change this ADR declines.
- As a section it would be the largest thing on the rail — four regions of
  its own — so the move reduces nothing; it relocates a whole page under a
  heading. The "eleven views and a twelfth needs a reason" rule is a ceiling
  on growth, not a reward for removal.

### 4. Where explanatory prose goes

The rule: **a section's explanation lives behind an info affordance
(T-260901-06's `InfoPopover`, in the relevant `Card.Header`'s `actions` slot,
labelled with the section's name); a section's *state* stays in the flow.**
State means one of two things — behaviour a control implies that has not
landed (P2-09's honest-caption criterion), or a constraint §6.11 requires the
UI itself to state. The switches' one-line `note` rows ("Keeps the last 30
snapshots", "Off also honours the system reduced-motion setting", the three
integration notes) are the mockup's own and are neither: they stay as rows.

The shipped page has **six** `p.meta.settings-foot` paragraphs across its
seven cards — Identity and Shortcuts have none — and each is classed here.
The task that scoped this ADR counted seven and named two honest captions;
the page holds six and three, and the third is classed on the same criterion
as the first two.

| Card | Footer today | Class | Reason |
|---|---|---|---|
| Branding | accepted formats and cap, why SVG is refused, bytes-not-extension (4 lines) | **Popover**, on the Branding header | It explains a rule the control already enforces: a refused pick renders its reason beside the row (`brandrow-error`, `role="alert"`), so the honest path survives without the paragraph. The format list stays composed from `BRANDING_CONTENT_TYPES` inside the popover. |
| Default cadence | "Sets the stored default … not built yet (P2-02); changing a value here has no effect on any company until then." | **Stays visible** | Honest caption. The steppers store a number that moves no company until P2-02; hiding that is the silent inertness P2-09 forbids. The mockup's own line — "New companies inherit these. Any company can override its own." — is the *explanation* of intended behaviour and moves to a popover on this header. When P2-02 lands, the caption is deleted and the popover stays. |
| Integrations | "Every source above is pull-only. Solo CRM never writes back to Stripe, Google Calendar or Gmail." | **Stays visible** | §6.11: "All pull-only; the UI must state this." A statement behind a click is not the UI stating it, and T-260828-38 asserts this text in rendered output. Already one line; no popover is added — there is nothing further to explain. |
| Backup (folder) | "Choosing a folder here isn't wired yet — it needs a main-process dialog channel … The nightly export itself is a separate, later task (X-04)." | **Stays visible** | Honest caption, and it covers the whole section: the export switch stores a value X-04 does not yet read, and the picker is disabled. It sits under the folder row as now. |
| Backup & appearance (density) | "Stored for later use — no view applies compact density yet." | **Stays visible** | Honest caption — the third one. `appearance.density` has no consumer anywhere in the renderer; the switch is exactly "storing a value and implying an effect" until one exists. It moves with its switch into Appearance and is already one line. |
| Guided tour | "The walkthrough a new workspace opens with … writes no record but its own 'seen' flag." (2 lines) | **Popover**, on the Guided tour header | The button's label says what it does; the paragraph explains a flag. Nothing here is unbuilt or required visible. |

So: two footers move behind a popover (Branding, Guided tour); four stay in the
flow (cadence, integrations pull-only, backup folder, density), three of them
because they are the honest captions and one because a requirement names it.
Identity's fields and the Shortcuts group get no popover — a section gains one
only when it has prose assigned to it, and a popover with nothing to say is
an icon button that lies about having content.

The visible captions keep the `settings-foot` class and its border-top so the
test T-260901-09 writes can find them by class and by text. Their wording may
be tightened toward one line, but each must keep its fact: the cadence line
says no company moves until P2-02; the backup line says the picker is not
wired and the export is X-04; the density line says no view applies it.

### 5. Responsive behaviour

**One breakpoint, the app's.** At `max-width: 900px` — the same query under
which the app rail goes off-canvas (`Rail.css`, `--bp-tablet`) — the section
rail becomes a horizontal strip of the same buttons above the content column,
and the content column takes the full width. The strip **wraps** (`flex-wrap`)
rather than scrolling sideways: six short labels wrap to two rows at 700px,
and `ui-design.md`'s "never scrolls horizontally" is honoured without an
exception for a strip. Above 900px the rail is a fixed-width column of 180px;
it is not sticky, because one-section-at-a-time keeps every page shorter than
the viewport it is read in.

No second off-canvas rail and no menu toggle: below 900px there is already
one hamburger on the screen, and a second hidden rail would hide the current
section's name along with its siblings. No `<select>` either — a select
collapses the six names to one and needs a click to see the rest, which is
the discoverability the rail exists to provide.

The strip keeps the `<nav>`, the buttons and `aria-current`; only its
direction changes, so keyboard operation is identical at every width.

## Consequences

**Easier.** A control is always in the same place: section order is fixed,
nothing reflows by width, and the visible view is at most one card. P4-08 and
X-04 add rows to Integrations and Backup without touching the layout; the
timelog CSV folder the mockup draws in Integrations, should it ever be built,
is a row there too. The region ceiling is met by construction, not by hoping
the next addition is small.

**Easier.** `nav.ts`, `ROUTE_META`, `Breadcrumb.tsx` and `routes.test.tsx` are
untouched. T-260901-09 is a change to one view and its stylesheet, with
T-260901-06's primitive as its only new dependency.

**Harder — one click further to the other sections.** The grid showed every
control at once on a wide window; the rail shows one section. An operator
changing a cadence default and then a backup folder makes two rail clicks
where before they scrolled. This is the trade the region ceiling asks for, and
it is the cheaper direction: settings are visited seldom and for one thing.

**Harder — the honest captions are now load-bearing in two places.** The
criterion that keeps them visible lives in P2-09 and here; T-260901-09's test
finds them by text. The day P2-02, a `dialog:selectFolder` channel, or a
density consumer lands, the matching caption must be deleted in the same
change, or the page states a limitation that no longer exists — the inverse
of the failure P2-09 prevents, and just as misleading.

**Cost — a third standing contradiction with the mockup.** Resolved the same
way as the first two: annotated in place at `views.settings` so a reader finds
it where they would otherwise copy from, and listed in AGENTS.md's References
beside Pipeline and the brand block. The grid the mockup draws is still the
spec for its *contents* — the cards, rows, switches and steppers — and only
the arrangement departs.

**Forecloses a persisted "last section".** Deliberately; the reasoning is in
§1. A later case for it is a new setting key with its own decision, not a
silent addition to this layout.

## Alternatives

**Keep the grid and merge cards until it fits (seven → five).** Rejected.
Merging is the remedy `ui-design.md` lists first, and it was tried here on
paper: Identity+Branding, Backup+Appearance already merged, Shortcuts+Tour
gives five. But it does not answer the complaint — five cards in an auto-fit
grid still reflow by width, and a control is still not where it was — and it
buys one addition before the ceiling is hit again. The grid is the cause, not
the count.

**A stacked page of all sections with a scroll-spy rail.** Rejected. It keeps
a fixed order, which is half the fix, but the visible view is still every
region at once — seven today, more after P4-08 and X-04 — so the ceiling is
exceeded rather than met, and the rail becomes a scroll aid for a page that
should not need one. A long stacked page also puts the honest captions and
the pull-only line wherever scrolling leaves them, which is a weaker guarantee
of "visible" than one card on screen.

**Tabs in the `ViewHeader` instead of a rail.** Rejected. Six tabs at the top
collapse badly at 700px — the mockup has no tab strip pattern to lift from —
and a rail is what the user asked for. The 900px strip in §5 is that tab row,
used only where the rail cannot stand.

**Fold Data into the rail as a seventh section.** Rejected for the reasons in
§3: it is a page you run, not one you set; it is the `dbchip`'s target from
every route; and it would need a route of its own, which makes the "section"
a view wearing a rail entry.

**Move every footer behind a popover, including the honest captions.**
Rejected — this is the single most likely way to get the rebuild wrong, and
the task that scoped this ADR names it as such. "Put descriptions in info
popups" reads naturally as "all of them", and doing so reverses P2-09's
criterion without anyone deciding to. The rule in §4 exists so the line is
drawn once, by kind — explanation versus state — rather than paragraph by
paragraph during implementation.

**Persist the selected section in `settings`, like `view.companies.mode`.**
Rejected in §1. §6.13's per-view memory is for *presentation* of the same
records — cards or list — where the operator's last choice is the right
default. A settings section is a destination, and the right default for a
destination is the first one.
