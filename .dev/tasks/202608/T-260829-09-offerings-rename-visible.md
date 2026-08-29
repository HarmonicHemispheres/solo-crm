---
id: T-260829-09
title: Rename Catalogue to Offerings everywhere a person reads it
status: in-progress
category: ui
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The section is called **Catalogue** — in the rail, in the breadcrumb, in the
mockup, and in the requirements section that specifies it. It should be called
**Offerings**. The view itself is still a placeholder (P3-01 and P3-07 are
unbuilt), so the whole cost of the rename right now is text: one nav label, one
breadcrumb, one placeholder title and the planning documents that name it. Every
week that passes adds another document and another comment written against the
old word.

Note the current spelling is British — "Catalogue", with "catalog" appearing
only inside seed fixture data as part of a link title. Search for both.

## Scope

**In:** every user-visible occurrence and every reference in the planning and
decision documents.

- `electron/renderer/nav.ts:47` — the rail's nav label, `Catalogue` → `Offerings`
- `electron/renderer/nav.ts:77` — the breadcrumb for `/services`
- `electron/renderer/routes.tsx:40` — `<ViewPlaceholder title="Catalogue" />`
- `electron/renderer/nav.ts:111` — the comment explaining why the catalogue is
  absent from `SEARCH_KINDS`
- `electron/main/db/schema.ts:149` — the `// Catalogue: services and products`
  section header
- `electron/renderer/components/shell/CommandPalette.test.tsx:243` and
  `electron/main/db/seed/index.test.ts:158` — test names and comments
- `planning/solo-crm-mockup.html` — the nav button label (line 501), the section
  comments (411, 675, 1375), the table-description and view-title maps (861,
  1027, 1714). **Labels and comments only** — the `:root` token block must not
  move, since `tokens.css` is lifted from it verbatim.
- `planning/solo-crm-requirements.md` — §6.5's heading (line 322), the schema
  comment at 132, the palette list at 343, the phase list at 408
- `planning/solo-crm-taskplan.md` — P3-01, P3-07, the §6.5 traceability row (791)
  and the prose at 220, 336, 578. Task **IDs do not change** — P3-01 stays P3-01.
- `.dev/decisions/ADR-003-materialised-revenue.md:45,52` — the two places the
  catalogue price list is named as a legal read. An ADR's prose may be corrected
  for a rename; its decision must not shift, so change the word and nothing else.

**Out:** identifiers of every kind — the `/services` route, the `services` nav
id, `CatalogueIcon`, and the `services` / `service_versions` /
`service_categories` tables. That is [T-260829-10](T-260829-10-offerings-rename-identifiers.md),
deliberately separate because it carries a migration and a different review gate.
Closed task files under `.dev/tasks/` — they are a record of what was said at the
time and are not retroactively edited. Any change to what the section *does*.

## Touches

- `electron/renderer/nav.ts`, `routes.tsx`
- `electron/main/db/schema.ts` (comment), `seed/index.test.ts`
- `electron/renderer/components/shell/CommandPalette.test.tsx`
- `planning/solo-crm-mockup.html`, `solo-crm-requirements.md`, `solo-crm-taskplan.md`
- `.dev/decisions/ADR-003-materialised-revenue.md`

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `grep -rni "catalogue" electron/ planning/ .dev/decisions/` returns nothing.
- [ ] `grep -rni "catalog" electron/ planning/` returns only the seed fixture's
      link title `SiteFacts — GIS catalog`, which is sample data describing a
      client's Notion page and is not this app's vocabulary.
- [ ] The rail's third Records item reads **Offerings**, and navigating to it
      shows a breadcrumb and a placeholder heading that both read Offerings.
      Screenshot in the outcome.
- [ ] `git diff planning/solo-crm-mockup.html` touches no line inside the `:root`
      block, and `npm run verify` still passes `tokens.test.ts`.
- [ ] `git diff .dev/decisions/ADR-003-materialised-revenue.md` changes only the
      word, on the two lines named above.

## Risks

- **Editing the mockup is editing the authoritative visual spec.** A find-and-
  replace that strays into its CSS or its `:root` block breaks the one file
  `tokens.css` is required to match. Confine the change to labels and comments.
- Both spellings are in the tree and only one of them is this app's word.
  Replacing "catalog" blindly rewrites seed data describing a client's document.
- Sentences do not always survive a word swap: "the catalogue is the price list
  you sell from" (mockup line 1027) reads differently as "the offerings is". Read
  each hit rather than running `sed` over the file.
- Renaming the label while `/services` and `CatalogueIcon` keep the old word
  leaves a permanent translation tax between what the user says and what the code
  says. That is the reason T-260829-10 exists and the reason to run it in the
  same wave.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
