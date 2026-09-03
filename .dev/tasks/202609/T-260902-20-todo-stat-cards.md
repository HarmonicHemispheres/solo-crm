---
id: T-260902-20
title: Cut the Todos stat cards back to the mockup — four cards, terser captions, a real sparkline
status: open
category: ui
plan_ref:
created: 2026-09-02
closed:
---

## Why

The page shows three stats where the mockup has four, and each caption
explains the label instead of adding to it: "what's owed right now" under
Open, "past their due date" under Overdue. The mockup's captions carry a
second fact — how many are next steps, how old the oldest overdue is — and the
fourth card carries a sparkline.

## Story

As the operator, I glance at the top of Todos and learn four things I did not
already know from the labels.

## Constraints

- Depends on T-260902-19 for the sparkline's data. It draws real completions
  or it does not ship — no placeholder array.
- Four cards, in the mockup's order: Open (hero), Overdue, Waiting on others,
  Closed this month.
- Captions state a fact, not a definition. The mockup's own: "N are next
  steps", "oldest Nd" / "nothing late", "not your move".
- Exactly one hero value per view (`.claude/rules/ui-design.md`); Open keeps
  it.
- `Stat` already has the `chart` slot and `.spark` is sized for a 22px
  sparkline (`Stat.css:40`). The sparkline itself is the view's to draw —
  inline SVG, no library. If a second view wants one, promote it then, not
  now.
- `tasks:countOpen` stays the only source of the owed count (the view's own
  header comment). Do not re-derive it.

## Acceptance

- [ ] Four stat cards render, matching the mockup's labels and order.
- [ ] Overdue reads "oldest Nd" when something is late and "nothing late"
      when nothing is, and turns red only when non-zero.
- [ ] The sparkline plots six real months and is `aria-hidden`, with the
      card's value carrying the number.
- [ ] `npm run snap` — `todos` at 700/900/1440.
- [ ] Open the app, complete a todo, see "Closed this month" and the
      sparkline's last point both move.

## Related

- `electron/renderer/views/Todos.tsx` (~line 289), `Todos.css`
- `electron/renderer/components/primitives/Stat.tsx` / `Stat.css`
- `planning/solo-crm-mockup.html` `views.todos` (~1195), `sparkline()` (~1007)
