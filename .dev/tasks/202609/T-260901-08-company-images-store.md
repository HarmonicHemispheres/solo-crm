---
id: T-260901-08
title: Store a company's logo and banner as bytes, per company
status: done
category: data
created: 2026-09-01
closed: 2026-09-01
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

## Outcome

Merged into `main` from branch `T-260901-08` (builder `4d0a73f`, two tests
added at merge in `9326fe7`). Thirteen files:

- `electron/shared/company-images.ts` — the two slots, the accepted content
  types (PNG and JPEG — `sniffImageContentType`'s set, aliased not re-listed),
  the per-slot byte caps, the pixel ceiling, the derivative sizes and
  `companyImageSlotSchema`. **No per-slot state, request or response schemas
  yet** — T-260901-12 adds those alongside the channels that need them.
- `electron/main/images/dimensions.ts` (+ test) — a pure PNG/JPEG header
  reader, so the pixel ceiling is enforced before any decode.
- `electron/main/images/derive.ts` — `ImageDeriver = (bytes, slot) =>
  DerivedImage | null`, `nativeImageDeriver` on Electron's `nativeImage`,
  `fitWithin`. Its test is Electron-bound and registered in
  `RUNTIME_BOOT_NODE_FILES` in `vitest.config.ts`; the repository tests inject
  a fake deriver.
- `migrations/0007_company_images.sql`, `migrations/index.ts` (version 7),
  `schema.ts`, `schema.test.ts` — table `company_images`: UUID `id`,
  `company_id` FK `ON DELETE cascade`, `slot`, original content type, byte
  length, width, height, `created_at` / `updated_at`, thumbnail content type,
  byte length and bytes, and `bytes` declared last; unique index on
  `(company_id, slot)`. The natural pair is a unique index, not the key —
  the migration header reasons this against ADR-002's exemption.
- `repositories/company-images.ts` (+ 34 tests) — `readCompanyImage`,
  `readCompanyImages` (a `Record<slot, StoredCompanyImage | null>`),
  `listCompanyImageThumbnails` (one query, derivatives only, ordered by
  `company_id, slot`; `bytes` is never selected), `writeCompanyImage` (company
  exists → non-empty → byte cap → sniff against the accepted set → header
  pixel ceiling → derive → upsert `ON CONFLICT (company_id, slot)`) and
  `clearCompanyImage` (boolean delete).
- `migrations/0007_company_images.test.ts` — seeded row counts unchanged,
  second run a no-op.

Every acceptance box is ticked except `npm run verify`, which ran as the
underlying tools on the scratchpad Node 22.22.0 (see the run summary):
covering tests, `tsc` for the node, web and integration projects, and eslint
on the changed paths.

**Review.** Seven mutants against `company-images.test.ts`. Five died as
written. Two survived — the byte-cap comparison (`>` → `>=`) and the
replacement's `updated_at` — and were strengthened at merge in `9326fe7`: the
GIF refusal now asserts the message and that the deriver was never called, and
a fake-timer test asserts `updated_at` moves on a replacement while
`created_at` stays. A seventh "survivor" (removing the cascade) was a harness
artefact — the replace hit the SQL comment's `ON DELETE cascade` before the
constraint's; applied to the constraint, the count-by-cascade test fails
`FOREIGN KEY constraint failed`. Dead.

**architecture-review** (the 🗄 data gate): structurally fine.

- Sync-ready schema: kept. UUID key, both timestamps, the natural
  `(company_id, slot)` pair as a unique index rather than a composite key,
  reasoned in the migration header against ADR-002. Not an exemption.
- IPC boundary: untouched — main-only code; no channel yet.
- Performance: the grid read is one query returning derivatives only, with
  `bytes` last in the row so a `SELECT *` by mistake pays for it visibly
  rather than silently. ADR-015's ~84 MB failure mode cannot be reached from
  this repository.
- The schema's first `ON DELETE cascade` is **a deliberate tradeoff already
  decided** by ADR-015 §6 and recorded again in the migration: an image is
  a property of the company, not a record a refusal should protect, and
  `deleteCompany`'s `refuseIfReferenced` header scopes its claim to migration
  0001's foreign keys, so it stays true. No new ADR.
- Risk check: ADR-015 does address sixty companies' worth of images and the
  export (its §7); the ADR-012 acceptance was for the two branding images
  and this task did not have to reopen it.

**Not eyeballed:** `nativeImageDeriver` output was asserted by dimensions and
content type in `derive.electron.test.ts`, not by looking at a resized image.
The first view to paint one (T-260901-14) is where a garbage derivative would
show.
