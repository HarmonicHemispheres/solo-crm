---
id: T-260829-15
title: Walk a new operator through the app once, skippable, and never nag again
status: done
category: ui
created: 2026-08-29
closed: 2026-08-30
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

Nothing in the app explains itself on first open. Solo CRM has ten nav items
across three groups and several ideas that are not guessable from their labels —
that contacts are stored apart from companies so history follows a person
through a job change, that an engagement splits "billed to" from "work is for",
that cadence is per relationship rather than a global staleness rule, that
Offerings is a price list with versioned prices. Every one of those is written
down in `ViewHeader`'s info popover on the view that needs it, which is exactly
the wrong place to find out the view exists.

A first-run walkthrough is not in `solo-crm-requirements.md` or the task plan.
It is new scope, requested directly: *"maybe we should have a guided tour with an
optional skip that shows them around setting up solo crm and what pages to go to
for starting off."*

This is **independent of T-260829-14** and can be built in parallel. Today's
empty-workspace card (that task) is the in-page prompt that is always there; this
is the one-time overlay on top of it. Neither depends on the other rendering.

## Scope

**In:** a self-contained tour overlay, its persistence, and the two places it
can start from.

**The sequence.** Five steps, each a card with a title, two or three sentences,
a step counter (`2 of 5`), *Back* / *Next*, and *Skip tour* on every step. The
last step's primary action is *Finish*. Content, one step each:

1. **Today** — this screen leads with what is owed, not with what is stored.
2. **Companies** — start here; a company is the anchor everything else hangs
   off. Its primary action navigates to `/companies`.
3. **People** — contacts are stored separately from companies, so history
   follows the person when they change jobs.
4. **Engagements** — the work itself, and how it bills; "billed to" and "work
   is for" are asked separately.
5. **Workspace** — cadence defaults, your own icon and logo, and where your
   database file lives. Its primary action navigates to `/workspace/settings`.

Each step's prose should be the same voice as the existing `description` strings
on those views; several can be lifted near-verbatim from them, which is a feature
— the tour and the view should not describe the same thing two ways.

**Where it appears.** A centred card over a scrim, in the middle of the window.
It does **not** spotlight or anchor to rail buttons — see Risks; the rail's
width and visibility change with the breakpoint, and an arrow pointing at a
collapsed element is worse than no arrow. Navigating a step is done by a button
in the card, not by highlighting something the reader must find.

**When it appears by itself.** On mount of the shell, only when both are true:
the persisted flag is unset, *and* `companies:list` is empty. An existing
workspace updating from 0.3.1 with forty companies in it gets no overlay. That
second condition is what keeps this a first-run tour rather than a popup.

**Persistence.** One new key in `SETTINGS_REGISTRY`
(`electron/shared/settings.ts`): `onboarding.tourSeen`, `z.boolean()`, default
`false`. Set to `true` on *Skip* and on *Finish* alike — a skip is a decision,
and asking again is the nag this task exists to avoid. It survives a restart
because the settings repository is the store the app already has (ADR-002); do
not invent a second one and do not use `localStorage`.

**Restarting it.** A *Take the tour* button in Workspace Settings, so dismissing
it is not irreversible. Put it in the existing Shortcuts card or a small card of
its own; it reopens the overlay without clearing the flag.

**Behaviour.** Escape skips. Focus moves into the card on open and returns to
the trigger on close. `Tab` stays inside the card while it is open. It respects
`appearance.motion` the way the rest of the app does (`useMotionAttribute`) —
under reduced motion the card appears without the transition, it does not
disappear.

**Out:**

- Anchored spotlights, arrows, element highlighting, and any per-view coach
  marks. If the tour ever needs those, that is a second task with a real answer
  for the breakpoint problem.
- Seeding example data, "try it with sample records", or any write to the
  database other than the one settings key.
- A tour of anything not yet built. Revenue and Offerings are placeholders; do
  not include a step for a page that renders `<h1>`.
- Changing the views themselves, their `description` popovers, or the rail.
- A first-run flow around the data-location chooser — that already exists in
  main (`electron/main/first-run/data-location-prompt.ts`) and runs before a
  window is on screen. Do not fold it in or re-explain it.

## Touches

- `electron/renderer/components/shell/Tour.tsx`, `Tour.css`, `Tour.test.tsx` —
  new.
- `electron/renderer/components/shell/Shell.tsx` — mounts it.
- `electron/renderer/components/shell/layer-manager-context.ts` and
  `LayerManager.tsx` — a `'tour'` `LayerKind`, if the tour joins the stack (see
  Risks; decide deliberately and say which way in the outcome).
- `electron/shared/settings.ts` — the `onboarding.tourSeen` key.
- `electron/main/db/repositories/settings.test.ts` — the registry snapshot
  assertions will name the new key.
- `electron/renderer/views/WorkspaceSettings.tsx` (+ `.test.tsx`) — the restart
  button.

## Acceptance

- [ ] On a stubbed empty workspace with `onboarding.tourSeen: false`, the
      overlay renders on first paint; with the flag `true` it does not; with the
      flag `false` but `companies:list` returning three companies it does not.
      Three separate tests, one per condition.
- [ ] *Skip tour* on step 1 closes the overlay and writes
      `onboarding.tourSeen: true` through `settings:set` — asserted on the
      recorded IPC call, not on the overlay merely unmounting.
- [ ] Walking to step 5 and pressing *Finish* writes the same flag. Skip and
      finish are indistinguishable afterwards.
- [ ] Escape closes it and writes the flag.
- [ ] *Back* on step 1 is absent or disabled; *Next* on step 5 is *Finish*; the
      counter reads `1 of 5` … `5 of 5`.
- [ ] The step-2 and step-5 primary actions navigate to `/companies` and
      `/workspace/settings` respectively and close the overlay.
- [ ] *Take the tour* in Workspace Settings reopens it at step 1 with the flag
      already `true`, and closing it again leaves the flag `true`.
- [ ] Focus is inside the card after open, and `Tab` from the last control
      returns to the first rather than reaching the rail behind the scrim.
- [ ] The new key passes `assertNoSecretKeys` (it will; the guard runs at import
      time) and `settings:getAll`'s exhaustiveness test still passes.
- [ ] `npm run typecheck && npm run lint && npm test` all green — including the
      `runtime-boot` projects, because `Shell.tsx` is in `App.test.tsx`'s path
      and `--project=renderer` alone will not exercise it.
- [ ] Mutation check, recorded in the outcome: removing the `settings:set` call
      from the skip handler, and inverting the "workspace is empty" condition,
      each turn `Tour.test.tsx` red.

## Risks

- **Anchoring to the rail.** The reason the scope forbids spotlights: the rail's
  layout changes at the mockup's 700px rule and T-260828-15 is still open on
  focus rings, rail `inert` and breakpoint behaviour. An overlay that positions
  itself against a rail button will be wrong at some width, and the failure is
  visual — no test catches it. A centred card has no such coupling.
- **Escape colliding with the layer stack.** `LayerManager` owns a single
  document-level Escape handler precisely so one keypress does not close two
  layers (`Sheet` passes `closeOnEscape={false}` for this reason). A tour with
  its own listener reintroduces exactly that bug. Either join the stack as a
  `'tour'` kind and let the central handler close it, or prove in a test that
  Escape with the palette open over the tour closes only the palette.
- **Firing on a populated workspace.** The empty-workspace condition depends on
  a query that has not resolved on first paint. Rendering the overlay while
  `companies:list` is still loading and then hiding it is a flash on every
  restart for every existing user. Wait for the query.
- **A key that changes meaning later.** `onboarding.tourSeen` as a boolean
  cannot answer "seen which version of the tour". If steps are added later,
  everyone who has seen v1 is marked done. That is the right trade for now —
  a version number invites re-nagging on every edit — but say so in the key's
  comment so the next person makes the choice deliberately.
- **Nagging.** The single failure mode that would make this worse than nothing
  is an overlay that comes back. Skip must be as final as finish, and the only
  way back must be the operator asking for it.
- Near no AGENTS.md gotcha directly: no network, no telemetry, no filesystem, no
  SQLite from the renderer. The only persisted state is one non-secret boolean
  in the table ADR-002 designated for exactly this.

---

## Outcome

**Changed:**

- `electron/renderer/components/shell/Tour.tsx` (new) — a controller that owns
  when the overlay opens and the one settings write closing it produces, plus
  the card itself as a separate component mounted only while the layer is open
  (so every open starts on step 1 from a fresh mount, not from a reset effect).
- `electron/renderer/components/shell/tour-steps.ts` (new) — the five steps as
  data. A fourth new file the scope did not list, forced by
  `react-refresh/only-export-components`: a file may not export both a
  component and a constant, the same rule that produced
  `layer-manager-context.ts`. `Tour.test.tsx` reads it to assert content.
- `electron/renderer/components/shell/Tour.css`, `Tour.test.tsx` (new).
- `Shell.tsx` — mounts `<Tour />`, so whether a new operator sees it does not
  depend on which route the app opened to.
- `layer-manager-context.ts`, `LayerManager.tsx` — a sixth `'tour'`
  `LayerKind`.
- `electron/shared/settings.ts` — `onboarding.tourSeen`, `z.boolean()`,
  default `false`.
- `WorkspaceSettings.tsx` / `.test.tsx` — a Guided tour card; the test file
  gained a `SettingsHost` wrapper (MemoryRouter + LayerManager + a sibling
  `<Tour />`) because the view now calls `useLayerManager`.
- `stub-crm.ts` — sets `onboarding.tourSeen: true`, the only value in that
  snapshot that deliberately diverges from its registry default, commented in
  place. Every harness reaching for the stub is testing a view, a sheet or the
  shell, not first run; `false` would drop the overlay on all of them.
- `Rail.test.tsx`, `Shell.test.tsx` — harness updates.

**The two decisions the scope left open, and how they went:**

1. **The tour joins the layer stack** rather than owning a `keydown` listener.
   That is the bug `Sheet`'s `closeOnEscape={false}` exists to avoid — two
   document-level Escape handlers means one keypress closes two layers — and
   joining also buys focus-return to the Settings trigger and `isTopmost` for
   free. Pinned by a test: ⌘K over the open tour, then Escape, and the palette
   closes while the tour stays.
2. **"Take the tour" is a card of its own,** not a row in Shortcuts. That
   card's header states it is generated from `GLOBAL_SHORTCUTS` and read-only;
   an action button contradicts its documented contract.

**The design decision worth keeping:** every close path — Skip, Finish,
Escape, both navigating actions — writes the flag through *one* effect
watching the layer close, not through four button handlers. "A skip is as
final as a finish" is therefore true by construction rather than by four
handlers each remembering.

**Review:** read against the acceptance criteria; no blocking findings. Five
mutants across the builder's run and the orchestrator's:

| Mutant | Result |
|---|---|
| Remove the `settings:set` call from the close path | 4 tests red |
| Invert the empty-workspace condition | 1 test red |
| Focus trap made a no-op | 1 test red |
| `Back` no longer disabled on step 1 | 1 test red |
| Remove the `autoOpenedRef` auto-open guard | **survived — fixed at merge** |

The survivor was a real gap, not an equivalent mutant. The close path writes
`true` into the cache immediately, so only a refetch can put `false` back —
and `settings:set`'s own success invalidates the snapshot, so a write that
reports success without persisting refetches `false` within the same session.
With the guard gone the effect's condition is satisfied a second time and the
overlay reopens on top of the operator who just dismissed it: precisely the
nag this feature exists to prevent, and the one line standing in its way had
no test. Rather than opening a follow-up for a single test, the orchestrator
added it at merge — `does not reopen when the flag does not stick` — and
confirmed it turns red under the same mutant and green with the guard
restored. `typecheck` and `lint` clean afterwards.

**Deferred:** nothing cut. The scope's "Out" list stands — no anchored
spotlights or coach marks, no seeded example data, no step for Revenue or
Offerings while both are still `<h1>` placeholders, and the main-process
first-run data-location prompt untouched. Scrim clicks deliberately do not
close the overlay: an accidental outside click permanently dismissing it is
the wrong default when dismissal is final.
