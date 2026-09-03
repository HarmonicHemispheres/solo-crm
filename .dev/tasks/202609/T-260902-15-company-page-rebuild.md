---
id: T-260902-15
title: Rebuild the company page as two columns — one Engagements card, one activity feed, a Notes card, no empty cards
status: open
category: ui
plan_ref:
created: 2026-09-02
closed:
---

## Why

The page is an auto-fit grid of eight cards that reflows into ragged columns,
shows "Delivered here, billed elsewhere — Nothing here yet" on almost every
company, prints "—" four times in Details, and strands Links at the bottom of
the left column. `shots/company-1440.png` is the evidence.

## Story

As the operator, I open a company and read it top to bottom: what I sell them,
what has happened and what I owe, then the reference material down the side —
instead of hunting across a grid for the card that has something in it.

## Constraints

- **The banner and the identity mark stay.** They are ADR-015's and
  T-260901-14's, and the reference design predates both.
- ADR-018 (T-260902-12) is the shape. Build what it decides, not what this
  brief sketches; if the two disagree, the ADR wins.
- Two columns, not auto-fit: the wide column carries Engagements and the
  activity feed, the narrow one Details, Contacts, Links, Notes. It still has
  to hold at 700px and 900px.
- A card with nothing in it is not drawn. Empty Details fields become one add
  affordance ("+ Add budget, billed via…"), not a row of em dashes.
- The header collapses to one meta line — since, cadence, last touch, billed
  via — with badges for kind and status. Cadence comes from the one
  computation (T-260901-27), never a second one.
- T-260901-31 (where the logo/banner controls live when narrow) is open and
  this page is where it lands. Resolve it here or say why not.
- `.dhero`/`.dhead` styles are shared with the person page
  (T-260901-30) — do not fork them.

## Acceptance

- [ ] A company with one engagement, no budget and no website renders no empty
      card and no "—" row.
- [ ] Todos and touches appear in one feed with a working Touch/Todo input.
- [ ] `npm run snap` — `company` at 700/900/1440, read against the reference.
- [ ] Open the app, open Sitefacts, log a touch and add a todo from the same
      card and see both appear.

## Related

- `electron/renderer/views/CompanyDetail.tsx` / `.css`, `shots/company-*.png`
- `electron/renderer/components/links/LinksCard.tsx`
- `electron/renderer/styles/detail-header.css`
