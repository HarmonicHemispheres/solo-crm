---
id: T-260828-34
title: Build the Activity view — the append-only log across companies, people and engagements
status: done
category: ui
plan_ref: P1-17
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/activity` is a placeholder. The global log is what makes quick-logging worth
doing — a note typed in five seconds has to be findable afterwards, from a view
that spans every entity rather than only the company you were on. It is also the
smallest of the record views, which makes it the cheapest place to establish
that the append-only rule (G8) is visible in the UI and not only in the
repository.

## Scope

**In:** The Activity view body:

- A single reverse-chronological log across all activity, each row showing
  kind (`call | email | meeting | note`), when, title, body excerpt, and the
  company / person / engagement it hangs on, each as a link.
- Filters by kind and by date range, and by entity when arrived at from
  elsewhere.
- Pagination or windowing — this is the table that grows fastest and the one
  most likely to be the first performance problem (§8, X-07).
- **No edit and no delete affordance anywhere in the view** (G8). A correction
  is a new row, logged through the quick log.
- Empty state that points at the quick log, since on a fresh install this is
  empty and the way to fill it is not obvious.

**Out:** The quick log overlay itself (T-260828-35). Company and person
timelines (T-260828-30, T-260828-31). Gmail-derived rows — ADR-001 reserves
`source: 'gmail'` with no writer, so nothing here should render that source yet.
Calendar-derived rows (P4-xx).

## Touches

- `electron/renderer/views/Activity.tsx` — new
- `electron/renderer/routes.tsx` — replace one `ViewPlaceholder`
- `electron/renderer/components/primitives/Row.tsx`, `Tag.tsx`, `ViewHeader.tsx` — consumed

## Acceptance

- [ ] One logged row appears in this global log and on its company, person and
      engagement pages
- [ ] The view renders no edit and no delete control — asserted in a test over
      the rendered output, not by reading the diff (G8)
- [ ] Rows are ordered by `occurred_at` descending, and a backdated row lands in
      its correct historical position rather than at the top
- [ ] Filtering by kind and by date range narrows the set and both clear cleanly
- [ ] Every entity link navigates to the right page
- [ ] With no activity the view shows an empty state naming the quick log
      shortcut
- [ ] The view stays responsive at the 10× volume X-07 targets — windowed, not
      rendering every row

## Risks

- **An edit affordance added later because a typo is annoying.** The rule is
  that a correction is a new row (G8); this view is where the rule is either
  obvious or quietly broken.
- **Ordering by `created_at` instead of `occurred_at`.** They are equal for
  everything typed live and differ for everything backdated, so the bug ships
  looking correct.
- **Loading the whole table.** Activity is unbounded; the first slow view in
  this app will be this one.


---

## Outcome

Merged as `4a870c5`, resolving a `query-keys.ts` conflict
against T-260828-31. Review non-blocking.

**Changed:** `views/Activity.tsx`, its CSS and test, one line of `routes.tsx`,
and `queryKeys.activity.list` made filter-aware.

**Conflict resolution worth recording:** T-260828-31 added `activity.byPerson`
and this task made `activity.list` take an optional filter. They are
complementary rather than competing, so both were kept — `byPerson` has a live
caller in PersonDetail, and a distinct prefix keeps a person's timeline
invalidatable without touching the Activity view's cached pages.

G8 holds: the view offers no edit and no delete affordance, asserted over the
rendered output.
