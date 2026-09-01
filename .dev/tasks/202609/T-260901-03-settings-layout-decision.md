---
id: T-260901-03
title: Decide how Workspace Settings is organised, now that the mockup's card grid has stopped scaling
status: in-progress
category: docs
created: 2026-09-01
closed:
---

## Why

Workspace Settings is disorienting to use. Seven cards
(Identity, Branding, Default cadence, Integrations, Backup & appearance,
Shortcuts, Guided tour) reflow in a `repeat(auto-fit, minmax(340px, 1fr))`
grid, so a control's position depends on the window width and nothing is
where it was last time.

That grid is not a mistake — it is the mockup, transcribed faithfully
(`views.settings`, mockup line 1285). But the mockup's settings page has
three cards. The shipped one has seven, and `.claude/rules/ui-design.md` puts
the ceiling at "five to seven primary regions per view" with seven as "the
ceiling rather than the starting point". Phase 4's integration settings
(P4-08) and X-04's backup folder each add to the same page.

So this is a real conflict with the authoritative visual spec, and it has to
be settled as a decision before a view is rebuilt against it. AGENTS.md names
the mockup as authoritative and lists its two existing departures — Pipeline
([ADR-005](../../decisions/ADR-005-pipeline-view.md)) and the brand block
(T-260829-06, annotated in place in the mockup). Without a third record here,
the next agent building against the mockup restores the card grid and is
right to.

## Scope

**In:** one ADR, `.dev/decisions/ADR-014-settings-layout.md` (confirm 014 is
free — the index checker flags a collision, and two scopes picking "the next
free number" in parallel has happened before, see `check-task-index.mjs`).

It has to settle, with reasons, at least:

1. **The shape.** A secondary rail listing the page's primary sections, with
   the content area as one vertical page per section — this is what the user
   asked for. Record why it beats the card grid *here* and does not become a
   pattern every view reaches for.
2. **The sections and their order.** Which of the seven cards are top-level
   sections, which merge, and which become a row inside another. "Backup &
   appearance" is two subjects in one card because the mockup grouped them;
   that grouping does not survive a rail.
3. **Does Data move into it?** The rail draws Settings and Data as two
   independent Workspace buttons, but they already resolve under one
   `/workspace` parent route (`routes.tsx`, X-01). A settings page that grows
   its own section rail makes "Data is a section of Workspace" the obvious
   reading. Settle it either way — this decides whether
   `/workspace/data` keeps a top-level nav item, and the answer changes
   `nav.ts`, `ROUTE_META` and the breadcrumb. **If the answer is yes, that is
   a separate task, not part of the rebuild.**
4. **Where explanatory prose goes.** Every card currently ends in a
   `p.meta.settings-foot` paragraph, several of them four or five lines. The
   mockup's equivalent is a single line ("New companies inherit these. Any
   company can override its own."). The prose is drift, and the decision is
   that a section's explanation lives behind an info affordance rather than
   in the flow — but note the exception that matters: **the two honest
   "this isn't wired up yet" captions** (cadence defaults do not move any
   company until P2-02; the backup folder has no picker) exist because
   T-260828-38's acceptance required a panel whose behaviour has not landed
   to "say so plainly rather than storing a value and implying an effect".
   Hiding those behind a popover would break that criterion. Say which
   category each of the seven footers falls into.
5. **Responsive behaviour.** The rail already goes off-canvas at 900px; a
   second rail inside the content area at that width needs an answer, not a
   media query invented during implementation.

Also in: annotating `planning/solo-crm-mockup.html` in place at its settings
view, pointing at this ADR — the mechanism T-260829-06 established for "the
shipped thing deliberately differs here", so someone reading the mockup finds
the departure at the point they would otherwise copy from it. And a line in
AGENTS.md's References section beside the two departures already listed.

**Out:** building any of it. [T-260901-09](T-260901-09-settings-rebuild.md) is
the rebuild and cannot start until this lands. Out too: the settings *values*
and which keys exist — §6.11 and ADR-002 already settle those and nothing here
changes the `settings` table.

## Touches

- `.dev/decisions/ADR-014-settings-layout.md` (new)
- `planning/solo-crm-mockup.html` — an in-place annotation at the settings view
- `AGENTS.md` — References, beside ADR-005 and the brand block

## Acceptance

- [ ] The ADR names all five questions above and answers each with a reason,
      not a preference.
- [ ] It lists the final section set and their order explicitly, so
      T-260901-09 builds a decided thing rather than deciding it.
- [ ] It states which of the seven existing `settings-foot` paragraphs move
      into an info popover and which stay visible, and why the honest
      "not built yet" captions are in the second group.
- [ ] The ADR number does not collide — `npm run check:index` passes, which
      is what enforces that.
- [ ] Someone reading `planning/solo-crm-mockup.html`'s settings view finds
      the departure without having to already know it exists.
- [ ] AGENTS.md's References section lists three mockup departures, not two.

## Risks

- **Deciding more than was asked.** The user asked for a sidebar and for prose
  to move into info popups. An ADR is the right place to record that; it is
  not an invitation to redesign what settings *contains*.
- The `settings-foot` captions were written to satisfy an explicit acceptance
  criterion in T-260828-38. Moving all of them behind a click silently
  reverses a decision that was made on purpose. This is the single most
  likely way to get this wrong.
- The "eleven views and a twelfth needs a reason" rule in `ui-design.md`
  bears on question 3: folding Data into Settings removes a nav item, which
  is the cheap direction, but it also buries the one page that tells an
  operator where their database is.
