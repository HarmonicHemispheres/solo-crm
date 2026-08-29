---
id: T-260828-48
title: Build the links repository — paste a URL on any entity, host decides the kind
status: done
category: data
plan_ref: P1-18
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

§6.10 is the last piece of Phase 1 with no task written for it, and the `links`
table has sat in migration 0001 since T-260828-07 with nothing reading or writing
it. The seed fixture already inserts link rows — Notion agreements, Drive
folders, Figma flows, a PDF — so the data exists and nothing can reach it.

The point of the feature is small and specific: the contract, the folder and the
design file for an engagement live in three different products, and the CRM's job
is to be the one place that remembers where they are. That only works if adding
one costs a paste.

`links` is also the first **polymorphic** table to get a repository —
`entity_type` / `entity_id` with no foreign key, because a link attaches to a
company, a person or an engagement and no single-table FK can express that. Every
referential guard built so far assumes a real foreign key, so this repository has
to establish how the polymorphic case is handled, and T-260828-41 is already open
against the fact that these rows orphan silently on delete.

## Scope

**In:** `electron/main/db/repositories/links.ts`, following the pattern ADR-007
and T-260828-20 established — wire schemas in `electron/shared/links.ts` as pure
zod, SQL and mapping in main, `errors.ts` and the shared refusal machinery reused
rather than re-rolled:

- `listLinks({ entityType, entityId })`, `addLink`, `updateLink` (title only),
  `deleteLink`.
- Kind detection from the host, porting the mockup's `linkKind` map verbatim —
  it is the authoritative source for which hosts map to which kind. An
  unrecognised host stores `web` rather than failing.
- One table serves companies, people and engagements; `entity_type` is a closed
  union validated in the shared schema, not a free string.
- URL validation at the boundary: a scheme allowlist of `http:` / `https:` only.
  T-260828-26's security review flagged that `companies.website` carries no
  scheme constraint and named its two sinks; this table is the same shape and
  should not repeat it. A `javascript:` or `file:` URL must be refused here, not
  at the point some view renders an `href`.
- Title defaults from the URL and is editable.

**Out:** Favicon fetching and caching — T-260828-49, and it is a separate task
because it touches the network and needs its own security review. Any renderer
code (T-260828-50). Deciding what happens to link rows when their entity is
deleted — **T-260828-41 owns that**, and this task must not quietly implement one
answer to it.

## Touches

- `electron/shared/links.ts` — new
- `electron/main/db/repositories/links.ts` — new
- `electron/main/db/repositories/links.test.ts` — new

## Acceptance

- [ ] Every host in the mockup's `linkKind` map resolves to its documented kind —
      one assertion per host, driven from the map rather than a re-declared copy
      (the re-declaration failure T-260828-44 exists to fix)
- [ ] An unrecognised host stores `web` and does not throw
- [ ] Links attach to a company, a person and an engagement through the one table,
      and `listLinks` for one entity never returns another's
- [ ] `javascript:alert(1)` and `file:///etc/passwd` are both refused with a
      stated reason; `http:` and `https:` are accepted
- [ ] A URL with no path, with a port, and with query parameters all resolve kind
      correctly — host extraction is not a naive string split
- [ ] `entity_type` rejects a value outside the closed union
- [ ] Adding a link does not mutate the entity it attaches to
- [ ] Tests run against a real migrated database

## Risks

- **Kind detection by substring.** `notion.so` appearing anywhere in a URL is not
  the same as being its host — `https://evil.test/?ref=notion.so` must not read
  as a Notion link. Parse the URL and match the host.
- **Repeating the `website` scheme gap.** Review already flagged that field as
  unconstrained; adding a second unconstrained URL column would be knowingly
  repeating it.
- **Implementing a delete policy by accident.** Whatever this repository does
  when an entity disappears becomes the de facto answer to T-260828-41. If it
  does nothing, say so explicitly in a comment rather than leaving it unstated.
- **A seventh copy of the shared repository machinery.** Five already exist and
  T-260828-43 will extract them; do not add another.


---

## Outcome

Merged as `291055e`. Review non-blocking (5 should-fix, 2 nits).

**Changed:** `electron/shared/links.ts`, `electron/main/db/repositories/links.ts`
and its test (all new).

The first polymorphic repository — `entity_type` / `entity_id` with no foreign
key, because a link attaches to a company, a person or an engagement and no
single-table FK can say that. Links attach to all three through one table,
`listLinks` for one entity never returns another entity's, `entity_type` is a
closed union validated in the shared schema, and kind detection is driven from
the mockup's `linkKind` map rather than a re-declared copy. `javascript:` and
`file:` URLs are refused at the boundary rather than at some future render site.

What happens to link rows when their entity is deleted is left explicitly
undecided in a comment — T-260828-41 owns that, and this task deliberately does
not answer it by accident.

**Deferred (follow-ups, not blockers). The first is the one to fix:**

- **Validate one string, store another.** `addLink` validates the WHATWG-parsed
  URL but inserts the raw caller string, so characters the parser strips survive
  into the row: a URL carrying an embedded tab or NUL stores them verbatim. The
  scheme allowlist itself is not bypassable, so this is hardening rather than an
  open hole — but every future sink (a renderer `href`, T-260828-49's favicon
  fetch, `shell.openExternal`) receives the unvalidated form. `linkSchema.url`
  is also a bare `z.string()`, so the guarantee is write-side only.
- `detectLinkKind` matches its rule substrings against the whole hostname, so
  `mynotion.com` and `notion.evil.com` both resolve as Notion. The acceptance
  criterion (the query-string spoof) is met and tested; the false-positive
  direction is not.
- Mutation survivors: every `.strict()` can become `.passthrough()`, and both
  empty-string guards can be relaxed, with all 31 tests still green.
- `ORDER BY added_at DESC` is untested and unstable — flipping to `ASC` leaves
  the suite green, and `added_at` has millisecond precision with no tiebreaker.
- `addLink` accepts any `entityId` for a valid `entityType` without checking a
  row exists, so a typo'd id creates a link nobody can reach.
- The seed fixture hardcodes kind `pdf` for a Drive-hosted PDF while
  `detectLinkKind` returns `drive`, so one URL renders with two different icons
  depending on whether it was seeded or pasted.
