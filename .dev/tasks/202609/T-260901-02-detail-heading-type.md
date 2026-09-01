---
id: T-260901-02
title: Style the detail-page heading so the banner reads as a banner
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

On `/company/:id` the banner looks like an empty decorative strip with the
company name stranded underneath it, and the mark hangs off its bottom-left
corner. The reported symptom is "the banner is too short vertically". It is
not — it is 76px, exactly what the mockup specifies. The heading is what
moved.

`.dbanner` sets `margin-bottom: -40px`, so the `.dhead` row that follows is
meant to ride 40px up into the banner's lower half. That only works if the
row starts where the layout puts it. The mockup styles `h1` **globally**
(`h1{font-size:27px;font-weight:700;letter-spacing:-.9px;line-height:1.1;margin:0}`,
mockup line 35). When those rules were ported they were scoped to
`.vhead h1` ([ViewHeader.css:10](../../../electron/renderer/components/primitives/ViewHeader.css#L10)),
because the view header was the only `<h1>` at the time.

It is not any more. `CompanyDetail.tsx:1135` and `PersonDetail.tsx:555` both
render a bare `<h1>` inside `.dhead`, outside `.vhead`, and no stylesheet in
the app declares a heading rule that reaches them. They get the user agent's
default — `font-size: 2em` and `margin: .67em 0`, roughly 32px type with an
18–19px margin above and below. That top margin cancels most of the -40px
overlap and the extra height pushes the name clear of the banner entirely.

Both detail routes have it. Only one was reported.

## Scope

**In:**

- Give the detail header's `<h1>` the type the mockup gives it: 27px, weight
  700, `letter-spacing: -.9px`, `line-height: 1.1`, `margin: 0`.
- Decide **where** the rule lives and record the reason in the file header.
  Two defensible homes: a `.dhead h1` rule duplicated in `CompanyDetail.css`
  and `PersonDetail.css` (matching how `.back`/`.dbanner`/`.dhead` are
  already duplicated across those two files, each with a header saying so),
  or a single global heading reset in `base.css` (matching the mockup, which
  styles `h1` globally, and closing the hole for the next `<h1>`). Prefer the
  second and say why in `base.css`'s comment — the bug is precisely that a
  bare `<h1>` outside one component had no style at all.
- If a global rule is chosen, confirm `ViewHeader.css`'s `.vhead h1` still
  wins or is made redundant, and do not leave two rules stating the same four
  values in different places.
- `routes.tsx`'s `ViewPlaceholder` renders an `<h1>` too (`/revenue`,
  `/offerings`). It will pick up whatever rule lands. That is fine and is not
  a reason to choose one home over the other.

**Out:** the banner itself — its height, its gradient, and whether it should
hold an uploaded image are [T-260901-14](T-260901-14-company-header-images-edit.md)'s
question. This task changes no `.dbanner` rule. Also out: `h2`/`h3`, which are
already scoped inside `.card-h` and `.sheet-h` and have no reported problem.

## Touches

- `electron/renderer/styles/base.css` *or* `views/CompanyDetail.css` +
  `views/PersonDetail.css`
- `electron/renderer/styles/base.test.ts` — if the rule lands in `base.css`
- `electron/renderer/components/primitives/ViewHeader.css` — only if the
  scoped rule becomes redundant

## Acceptance

- [ ] On `/company/:id` the mark and the company name both sit **inside** the
      banner's vertical extent, with the name's baseline in the banner's lower
      half — checked in the running app against the same view in
      `planning/solo-crm-mockup.html`.
- [ ] `/person/:id` shows the same corrected header, without that view being
      edited for it.
- [ ] The computed `font-size` of the company-name `<h1>` is 27px and its
      computed `margin-top` is 0 — asserted in a test, not eyeballed.
- [ ] `/companies` and every other `ViewHeader`-titled view are visually
      unchanged.
- [ ] `npm run verify` passes.

## Risks

- A global `h1` rule reaches `ViewPlaceholder` and any future heading. That
  is the intent, but it means this task can change the look of `/revenue` and
  `/offerings` — check both before and after and say so in the outcome.
- `base.test.ts` exists and asserts things about the base stylesheet; adding
  a rule there without extending it leaves the new rule unguarded.
- The mockup is the authority here and it already agrees with the fix — this
  is a porting gap being closed, not a design change. Do not take the
  opportunity to adjust the size to taste.

## Outcome

**Changed:** 5 files — `styles/base.css` gains the mockup's global `h1`
rule (line 35, verbatim) with a header saying why it is global rather than
duplicated into the two detail stylesheets; `ViewHeader.css` loses its
`.vhead h1` copy of the same four values (pointer comment left in place);
`styles/base.test.ts` gains three tests that read the *computed* style
through jsdom rather than the file's text; `base.test.ts` moved from
`tsconfig.node.json` to `tsconfig.integration.json`'s `files`, the only
program with both the DOM lib and Node types, with the reason recorded in
that file's `// files` note.

**Review:** passed. Three mutants against `base.test.ts` alone: `font-size`
27→28px (two tests red), `margin: 0` deleted (two red — computed margin
falls to the UA's `0` vs the asserted `0px`, which is a thin but real
signal), and the rule re-scoped to `.vhead h1` (the detail-header test
red, the view-header test still green — exactly the split the bug was).
The non-vacuity test (same markup, no author sheet → 32px) proves the
computed-style path is live rather than jsdom returning declared values.
`ViewHeader.css` has no second copy of the values. `/revenue` and
`/offerings` (`ViewPlaceholder`) now take the same 27px heading — that is
the rule reaching them as intended, not a regression.

Not done here: the "checked in the running app against the mockup" and
"`/companies` visually unchanged" items were not eyeballed in Electron by
either the builder or the merge. The computed-style tests are the evidence
that stands in for them.
