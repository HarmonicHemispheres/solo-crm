---
id: T-260901-08
title: Store a company's logo and banner as bytes, per company
status: open
category: data
created: 2026-09-01
closed:
---

## Why

Company detail and the companies grid are to show an operator-supplied logo
and banner per company. There is nowhere to put them: `companies` has no image
column, and the only table in the app holding operator-supplied bytes is
`branding`, which
[ADR-012](../../decisions/ADR-012-operator-branding-storage.md) bounds to
"two rows at most, ever" — the workspace's own mark and wordmark, read once at
startup to paint the rail.

This is the migration and the repository that give per-company images a home,
built to whatever [T-260901-04](T-260901-04-company-images-decision.md)
decides. **It cannot start until that ADR lands** — the read path for a grid
of sixty companies is the open question, and it determines the table's
columns, not just its access pattern.

## Scope

**In:**

- One migration adding the store the ADR specifies, appended as the next
  numbered file in `electron/main/db/migrations/` and registered in
  `migrations/index.ts`. Follow `0005_branding.sql`'s shape: every column
  `NOT NULL`, so a half-written row — bytes with no content type, a content
  type with no bytes — is not representable.
- A repository beside `repositories/branding.ts`, reusing what already
  exists rather than copying it: `sniffImageContentType` from
  `main/favicons/sniff.ts` is the sniffer both `favicons` and `branding`
  already share, and it is what decides the format. **Content type is
  derived from the bytes' own magic numbers, never from a caller's claim.**
- Reads: one company's slots; and the list read the ADR chose, in the shape
  it chose.
- Writes: store a slot's bytes for a company, clear a slot. **Clearing is a
  `DELETE`** — the absence is the default, as in `branding`, so there is no
  `enabled` flag that can disagree with the bytes.
- Cascade on company delete, by the mechanism the ADR named. Test it by
  deleting a company that has both slots and counting rows, not by reading
  the DDL.
- If the ADR chose a stored derivative, generating it belongs here, in main,
  where the bytes already are.
- A Drizzle schema entry in `db/schema.ts` and whatever
  `db/test-support/snapshot-renames.ts` and the drift test need so the
  snapshot stays honest — T-260829-12 exists because that drifted once.

**Out:**

- The IPC channels and the native picker
  ([T-260901-12](T-260901-12-company-images-ipc.md)). Nothing here opens a
  dialog or reads a file off disk; this repository takes bytes it is handed.
- Any view.
- Changing `branding`, its cap, or its two slots.
- Backfilling anything. Every company starts with no images and the derived
  `hue()`/`initials()` mark stays the fallback.

## Touches

- `electron/main/db/migrations/00NN_company_images.sql` (new)
- `electron/main/db/migrations/index.ts`
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/company-images.ts` (new) + its test
- `electron/shared/company-images.ts` (new) — the zod vocabulary, PURE zod
  with no Node imports, as every `electron/shared/**` module is
- the migration's own `.test.ts`, migrating a database that already has data

## Acceptance

- [ ] The migration runs against a database seeded by
      `electron/main/db/seed/` and every existing row count is unchanged
      afterwards.
- [ ] Running the full migration set twice is a no-op the second time — the
      idempotence property `0006`'s test already asserts for its own case.
- [ ] Storing an SVG is refused, and the refusal is on the bytes' magic
      number: a file named `.png` whose contents are `<svg…` is refused too.
- [ ] Storing bytes over the cap is refused and no row is written.
- [ ] Clearing a slot removes the row; reading it back returns the "absent"
      answer rather than a sentinel row.
- [ ] Deleting a company removes both of its image rows, asserted by count.
- [ ] Two companies' images are independent — writing one does not change the
      other's `updated_at`.
- [ ] No refusal message contains a filesystem path.
- [ ] `npm run verify` passes.
- [ ] `architecture-review` has run (the default extra gate for 🗄 data) and
      its findings are recorded.

## Risks

- **The database grows by whatever this admits, and the nightly JSON export
  copies tables** (§8, X-04). ADR-012 accepted that for two images. Sixty
  companies is a different number and the ADR has to have said so; if the
  outcome finds the ADR did not, that is a finding, not something to decide
  here.
- AGENTS.md: "Every table gets a UUID primary key and `created_at` /
  `updated_at` — except tables keyed by natural identity". Which side this
  table falls on is the ADR's call; implementing the other one is a silent
  divergence from a decision that was just made.
- The drift test compares the Drizzle snapshot to the migrations. A table
  added to one and not the other passes locally and fails on the merged tree.
- `sniffImageContentType` returns `FaviconContentType`. Aliasing that set
  (as `BRANDING_CONTENT_TYPES` does) keeps the three stores from drifting
  into disagreeing about what the sniffer can return; re-listing the literals
  is the mistake that compiles.
