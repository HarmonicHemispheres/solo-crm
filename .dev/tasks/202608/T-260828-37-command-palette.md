---
id: T-260828-37
title: Build the command palette (⌘K) — search everything, lead with create commands
status: done
category: ui
plan_ref: P1-10
created: 2026-08-28
closed: 2026-08-29
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


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed by the
orchestrator at merge, with one staleness hole closed on top.

**Changed:** `CommandPalette.{tsx,css,test.tsx}` and `CommandPalette.latency.test.tsx`
(all new), `create-commands.ts` (new), `LayerManager.{tsx,test.tsx}`,
`Topbar.test.tsx`, `nav.ts`, `views/Engagements.tsx`, `lib/query-keys.ts`,
`lib/test-support/stub-crm.ts`, `electron/main/ipc/registry.{ts,test.ts}`,
`electron/shared/ipc-types.ts`.

### It meets its performance requirement, measured

§8 asks for results within one frame of a keystroke at 10× data volume. Measured
and printed by the run: **median keystroke 1.74 ms against the 16.67 ms frame**,
with 100 companies / 1000 people / 500 engagements cached and a full 25-row
result set. That budget is only reachable because T-260828-51 landed first —
`search_source` is now a rowid seek rather than a five-table scan.

Esc is **not** handled here. `LayerManager` owns it centrally (T-260828-12), and
`CommandPalette.test.tsx` proves the palette adds no listener of its own by
rendering the component *outside* the palette layer and showing Escape does not
call `onClose`. That is the right way to assert an absence.

### Five result kinds, not the six the acceptance names

The scope says a catalogue entry is searchable and the acceptance asks for "each
of the six result types". **The index has five kinds** — company, person,
engagement, task, activity — because `services` is not one of the five source
tables `0002` indexes, and the FTS index is explicitly *out* of this task's
scope.

The builder implemented and asserted one navigation target per **indexed** kind
and said so in `targetForSearchResult`'s comment, rather than quietly shipping
five and letting the acceptance read as met. Catalogue search is a change to the
index — a new kind code, append-only under ADR-008 — not to the palette. Left as
a stated gap rather than papered over; it is not a defect in this task.

### Files touched outside the Touches list, all named

`LayerManager.tsx` was listed as "consumed, unchanged", but its `PaletteShell`
placeholder *was* the palette's mount point and said so in its own comment. It is
now `<CommandPalette>`, preserving the exact markup its tests assert
(`role="dialog"`, `aria-label="Search"`, the `Search or create…` placeholder,
`.scrim`/`.pal`/`.pal-foot`).

Two foreign test harnesses needed a provider, **not** a behaviour change:
`LayerManager.test.tsx` gains a `MemoryRouter` (the palette navigates) and
`Topbar.test.tsx` gains `QueryClientProvider` + `stubCrm` (the palette queries) —
the same accommodation `LayerManager.test.tsx` had already made for the real
quick log. No assertion in either file was altered.

"An engagement scrolled to it" needed an anchor that did not exist:
`engagementAnchorId` now lives in `nav.ts` beside `ROUTE_META`, and
`Engagements.tsx` renders it as the row's `id` — one attribute. The palette
navigates to `/engagements#engagement-<id>` and scrolls best-effort across a
bounded number of frames, since the view fills in from a query after it mounts.

### Review fix: a created record could be missing from search

The palette caches a result set for 30 s — a deliberate departure from the app's
`staleTime: Infinity`, because the search index is maintained by SQLite triggers
and **nothing in the renderer can observe that it changed.** The builder flagged
this for review rather than leaving it implicit, which is what made it findable.

The hole it leaves: create a company, then re-run a search term typed moments
earlier, and the answer comes from a cache that predates the row — **a record the
user just watched themselves make, missing from the one surface built to find
anything.**

`useSheetMutation`'s `onSuccess` is a single choke point for all four create
sheets, so it now invalidates search alongside the entity; `QuickLog` does the
same for a logged touch. The 30 s stale time **stays**, as the backstop for
writes that do not pass through either — an update, a delete, the seeder. Two
lines, in the two places that already knew a write had happened, rather than a
follow-up task.

`queryKeys.search` and `invalidate.search` were added to the key factory because
CONVENTIONS.md requires keys to come from it, and its
`Record<keyof typeof queryKeys, …>` forces the paired invalidate entry — which is
why the fix above had a function waiting for it.

**Verified at merge:** typecheck clean across all three passes, lint clean, and
the whole suite green on the merged tree.

## Note for the next builder in the registry

`stub-crm.ts` gained a `search:query` default because `CrmApi` is not partial.
Any task adding a channel will collide there — it is now the third one to do so
(`db:query`, `search:query`), which makes it a reliable marker that two channel
tasks are in the same wave.

## The gate caught a third harness the builder never ran

`useGlobalShortcuts.test.tsx` failed five tests on the merged tree with
*"useNavigate() may be used only in the context of a `<Router>`"*. The builder
fixed the two harnesses it knew about and ran `components/shell`, `lib` and
`views` — a reasonable reading of "the tests covering your diff". It missed this
one because **that file does not import anything the diff changed; it *mounts*
it.**

Fixed with the identical accommodation the other two already carry — a
`MemoryRouter` around the harness. No assertion altered, nothing weakened. 9/9
in that file, and the whole suite **1041 + 68 = 1109 green**.

The rule went into `subagent-preamble.md` rather than staying an anecdote: if
you change something other components mount — a layer, a shell, a provider, a
route table — run its whole project. `--project=renderer` is about a minute; a
gate failure costs a full-suite re-run plus a diagnosis.
