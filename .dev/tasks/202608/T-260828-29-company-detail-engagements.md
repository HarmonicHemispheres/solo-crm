---
id: T-260828-29
title: Build company detail — engagements billed here, delivered here, end clients, details
status: done
category: ui
plan_ref: P1-12
created: 2026-08-28
closed: 2026-08-28
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

This is the view that proves the data model was worth the trouble. Split billing
is an abstraction until a company page shows *engagements billed to this company*
and *engagements delivered here but billed elsewhere* as two distinct sections
that read correctly from either side of the same row. The plan puts P1-12 in the
P1-CUT subset for that reason: it is where "Notion stops being the relationship
system of record". `/company/:id` currently renders an `<h1>`.

## Scope

**In:** The company detail body at `/company/:id`:

- **Billed here** — engagements whose `billing_company_id` is this company, each
  marked with who the work is *for* when the client differs.
- **Delivered here, billed elsewhere** — engagements whose `client_company_id`
  is this company and whose billing company is not, each naming the billing
  party.
- **End clients** — companies appearing as `client_company_id` on engagements
  this company bills.
- **Details card** — kind, website, cadence, since, budget note, notes, and the
  billed-via / introduced-by relationships as links to those companies.
- A header carrying the company's identity colour, name, kind and cadence state,
  consistent with the cards in T-260828-28.
- Inline edit of the details card through `companies:update`.

**Out:** Todos, activity timeline and contacts — T-260828-30 owns the second
half of this page, and the two are split because together they are more than one
reviewable change. Links (P1-20). Revenue figures of any kind. Hours against
retainer allowance, which needs `time_entries` and stays provisional until P4-05.

## Touches

- `electron/renderer/views/CompanyDetail.tsx` — new
- `electron/renderer/routes.tsx` — replace the `/company/:id` placeholder
- `electron/renderer/components/primitives/Card.tsx`, `ModelTag.tsx`, `Chip.tsx` — consumed

## Acceptance

- [ ] Against the seed fixture, EZDeploy shows the Samay build under *billed
      here* marked "for W+K", and lists W+K and Programetrix as end clients
- [ ] W+K shows that same engagement under *delivered here, billed to EZDeploy*
- [ ] A company where billing and client are the same renders no "via" marker
      and no end-client section
- [ ] A company with no engagements on either side shows an empty state per
      section, not three blank panels
- [ ] Editing the details card writes only the columns it shows, verified by
      reading the row back
- [ ] Following billed-via or introduced-by navigates to that company's page and
      the breadcrumb updates (`nav.ts`'s `ROUTE_META` already maps
      `/company/:id` to the Companies nav item)
- [ ] An unknown `:id` shows a stated "not found", not a crashed route or an
      infinite spinner
- [ ] Keyboard reachable throughout, focus visible (X-06)

## Risks

- **Rendering the two sections from one query with a client-side filter that
  gets the direction backwards.** The failure looks like a plausible page. The
  seed-fixture assertions above are the guard, and they are worth writing first.
- **Treating billed-via as a parent/child company hierarchy** while laying out
  the page. §5 is explicit that it is a billing pointer.
- **Money creeping in.** A "total contract value" summary on this page would be
  per-model branching outside the P3-05 generator — ADR-003, and the standing
  flag in `architecture-review`.
- **`ends_on` NULL rendered as a missing date rather than "rolling".** The null
  carries meaning here.


---

## Outcome

Merged as `36da568`, resolving a two-line `routes.tsx`
conflict against T-260828-28 by taking both sides.

**Changed:** `views/CompanyDetail.tsx` and its test, one line of `routes.tsx`.

**This is the view that proves the data model was worth the trouble** — split
billing is an abstraction until a company page shows *billed here* and
*delivered here, billed elsewhere* as two sections reading correctly from either
side of the same row.

**Review:** non-blocking.

**Deferred → T-260828-53:**

- ADR-001's never-contacted guard is untestable as written: replacing
  `cadenceState`'s `lastTouchAt == null` branch with `{ pct: 0, label: 'never' }`
  renders a never-contacted company as a green "ok" bar and no test notices.
  That is the exact state every row is in on a fresh install.
- `companiesById` is built only from the list query, which has no pending gate
  and no error branch, while the body renders as soon as the detail query
  resolves — the three IPC calls race.
- The header's metadata row and the engagement pills are asserted by nothing:
  deleting the kind tag, the budget-note tag or the status tag leaves the suite
  green.
- No fixture sets `introducedByCompanyId`, so half of the "following billed-via
  or introduced-by navigates" criterion is unverified.
- `.endrow` is a `<Link>` where the mockup used a `<button>`, so `base.css`'s
  anchor colour cascades and end-client names render verdigris instead of
  papyrus.
