---
id: T-260902-14
title: Collapse the rail to a strip of icons, and remember which way the operator left it
status: open
category: ui
plan_ref:
created: 2026-09-02
closed:
---

## Why

The rail is a fixed `var(--rail)` column on every route and there is no way to
give that width back to a wide table or a timeline. Below 900px it already
goes off-canvas; above it, it cannot move at all.

## Story

As the operator, I collapse the rail to icons when I want the room and expand
it when I want the labels, and it stays how I left it next time I open the app.

## Constraints

- Icon-only, not hidden: every nav item stays one click away, with the label
  as a tooltip and as the accessible name. A collapsed rail must not become an
  unlabelled row of glyphs to a screen reader.
- Depends on T-260902-13. A collapsed rail has no room for a nested Reports
  group — decide and state what a group icon does when collapsed (a flyout, or
  expanding the rail) rather than letting the children disappear.
- The state persists on the `settings` key-value table (ADR-002), and the
  optimistic write rolls back on error (T-260901-28's rule).
- Ctrl+B toggles it. `useGlobalShortcuts` already owns the app's bindings; do
  not add a second listener.
- The existing `max-width:900px` off-canvas behaviour is a different thing and
  must survive unchanged.

## Acceptance

- [ ] A control in the rail collapses it to icons and expands it back; Ctrl+B
      does the same.
- [ ] Collapsed, every nav item has a visible tooltip and an accessible name.
- [ ] Collapsing, quitting and relaunching reopens collapsed.
- [ ] Below 900px the off-canvas rail still opens and closes as before.
- [ ] `npm run snap` — `today`, `companies`, `revenue` at 700/900/1440.
- [ ] Open the app, press Ctrl+B, watch the content take the width back.

## Related

- `electron/renderer/components/shell/Rail.tsx` / `Rail.css`
- `electron/renderer/components/shell/Shell.tsx`
- `electron/renderer/hooks/useGlobalShortcuts.test.tsx`
- `electron/renderer/styles/tokens.css` (`--rail`)
