---
id: T-260902-11
title: A press that starts inside a sheet and ends on the scrim must not close it
status: done
category: ui
created: 2026-09-02
closed: 2026-09-02
---

## Why

Reported: *"whenever i try to edit the form in engagements for edit
engagement, the form will disappear."*

Not edit-specific, and not the engagement sheet's. `Sheet.tsx`'s scrim closed
on any `click` whose `target` was the scrim itself. A `click` fires on the
nearest common ancestor of its mousedown and mouseup targets — so pressing
inside a field and releasing outside the sheet, which is exactly what
selecting the text already in a field looks like, delivered a click whose
target *was* the scrim. Every sheet in the app, and every unsaved edit in it.

It bit editing far harder than creating, which is why it was reported that
way: a create form's fields are empty and there is nothing to drag across,
while editing a record begins by selecting the value you mean to replace.

## Story

As the operator, selecting the text in a field does not close the form and
throw away what I typed.

## Acceptance

- [x] A press beginning inside the sheet and ending on the scrim leaves it open.
- [x] A press beginning on the scrim and ending inside it also leaves it open.
- [x] A whole press on the scrim still closes it.
- [x] Drive the real app: drag from a field to the scrim; the sheet and the
      typed text survive.

## Related

`electron/renderer/components/primitives/Sheet.tsx`, its test.

---

## Outcome

**Changed:** `Sheet.tsx` records whether the press *began* on the scrim
(`onMouseDown`) and closes only when the click both began and ended there.
Four tests, replacing one.

**Departed from scope:** Nothing. It closes on `click` rather than
`mouseDown` deliberately — a press that starts on the backdrop and drags back
into the sheet is not a dismissal either, and waiting for the click is what
lets both cases be judged on one event. There is a test for that direction
too.

**Not verified:** Nothing. Reproduced first by driving the built app over
CDP — a real mouse press in the Name field of the engagement edit sheet,
released on the scrim, closed it and discarded "HALF TYPED NAME" — and the
same script after the fix reports the sheet open and the text intact.

**Elapsed:** ~25 minutes.
