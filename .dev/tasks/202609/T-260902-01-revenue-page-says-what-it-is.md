---
id: T-260902-01
title: Give the Revenue route a real header and an honest empty body instead of a bare heading
status: done
category: ui
created: 2026-09-02
closed: 2026-09-02
---

## Why

`/revenue` rendered `<h1>Revenue</h1>` and nothing else — the shell task's
placeholder from T-260828-12, never replaced because the view it stands in
for (P3-10) cannot show a number until `revenue_lines` has a writer (P3-05,
ADR-003). Reported by the user: "the revenue page has nothing on it." A
blank page reads as broken; the truth is that the feature is unbuilt.

## Story

As the operator, I open Revenue and see the same header every other view
has, and a sentence telling me what the page will show and why it is empty.

## Constraints

- ADR-003 / AGENTS.md: no revenue figure computed off engagement columns.
  This page reads nothing at all; the mockup's `mrr()`/`backlog()` do not
  get ported as a stopgap.
- `ViewHeader` with the rail's revenue glyph and the mockup's own info text.

## Acceptance

- [x] `/revenue` renders `ViewHeader` (icon, title, info popover) and an
      `EmptyState` naming what is missing.
- [x] A test fails if the view gains a query, an IPC read, or an arithmetic
      over engagement money columns.
- [x] Open the app, click Revenue: header and message, no blank page.

## Related

`electron/renderer/routes.tsx` (`ViewPlaceholder`, now gone),
`views/Revenue.tsx`, `components/shell/Tour.test.tsx` (its comment on the
placeholders), the five open tasks T-260902-02 to -06 that replace this body.

---

## Outcome

**Changed:** new `views/Revenue.tsx` + test; `routes.tsx` drops
`ViewPlaceholder` (Revenue was its last user); one comment in
`Tour.test.tsx`.

**Departed from scope:** Nothing.

**Not verified:** Nothing. `npm run snap -- --routes revenue` at 1440 and
700 read.

**Elapsed:** ~15 minutes.
