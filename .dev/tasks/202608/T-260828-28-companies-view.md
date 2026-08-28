---
id: T-260828-28
title: Build the Companies view — card and list presentations with a real record set
status: in-progress
category: ui
plan_ref: P1-11
created: 2026-08-28
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/companies` renders `<ViewPlaceholder title="Companies" />` — an `<h1>` and
nothing else (`electron/renderer/routes.tsx`). This is the first route to be
given a real body, and the pattern it sets is the one the other eight views
follow: a `ViewHeader` with the presentation toggle, a query through the
T-260828-26 channels, an `EmptyState` when there is nothing, and no direct
`window.crm` call from a component.

§6.13 wants both presentations because they answer different questions — cards
for recognition under about twenty records, lists for comparison beyond that —
and remembers the choice per view, which is what the settings repository
(T-260828-25) is for.

## Scope

**In:** The Companies view body, replacing its placeholder:

- **Cards:** identity colour, cadence ring, kind, active engagement count, end
  client count — taken from the mockup, not invented.
- **List:** aligned sortable columns, more rows per screen.
- The presentation toggle in the `ViewHeader`, persisted per view through
  `settings:set` so it survives a restart (§6.13).
- End clients are excluded from the top level — a company that exists only as
  another engagement's `client_company_id` belongs on that company's detail
  page, not as a peer row.
- Empty state that offers the create sheet, since on a fresh install this view
  is the first thing a user sees and it will legitimately be empty.
- Rows and cards navigate to `/company/:id`.

**Out:** Company detail itself (T-260828-29, T-260828-30). Decay computation —
P2-03 owns `days_since_last_touch / cadence_days` and its ok/warn/late bands;
this view renders the `Ring` and `DecayMeter` primitives against whatever the
shared function returns, and until P2-03 lands it may show a determinate
neutral state. Filtering and saved views (P2-08).

## Touches

- `electron/renderer/views/Companies.tsx` — new
- `electron/renderer/routes.tsx` — replace one `ViewPlaceholder`
- `electron/renderer/components/primitives/ViewHeader.tsx` — consumed
- `electron/renderer/lib/query-keys.ts` — consumed

## Acceptance

- [ ] Both presentations render the same record set — same count, same default
      order, asserted in a test rather than eyeballed
- [ ] Sorting a list column reorders the rows, and the order survives switching
      to cards and back
- [ ] A company that appears only as an end client on someone else's engagement
      does not appear as a top-level row — the seed fixture's Programetrix and
      W+K are the cases
- [ ] The presentation choice survives an app restart
- [ ] A company created from the sheet appears without a manual reload
- [ ] With zero companies the view shows the empty state, not a blank panel or a
      spinner that never resolves
- [ ] No component in this view calls `window.crm` directly; every read goes
      through a query hook
- [ ] Keyboard: every card and row is reachable and activatable, focus visible
      against the obsidian ground (X-06)

## Risks

- **A card that computes revenue.** The mockup fakes engagement money with
  hardcoded arrays and live per-model branching; porting that undoes ADR-003.
  Counts and dates only here.
- **Rendering a `NaN` cadence ring** for a company never touched —
  `last_touch_at` is null until T-260828-24 runs, and on a fresh install it will
  be null for every row. Determinate state, not `NaN`.
- **The mockup is the authoritative visual spec** (AGENTS.md). Its Pipeline nav
  item is deliberately absent under ADR-005; nothing here should reintroduce it.
