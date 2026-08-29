---
id: T-260829-04
title: Store an operator-supplied icon and logo as bytes in the database
status: done
category: data
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The rail's brand block is hardcoded markup. For the operator to put their own
icon and wordmark there, the app needs somewhere to keep two images that
survives a restart, moves with the data root when it is relocated, and is
covered by whatever backs the database up. Nothing in the app stores an
operator-supplied file today — `favicons` is the only table holding bytes, and
those come from the network, not from disk. This task is that store and the
decision record behind it; nothing user-visible changes until T-260829-05 and
T-260829-07 land on top of it.

## Scope

**In:**

- Migration `0005_branding.sql` creating

  ```sql
  CREATE TABLE `branding` (
    `slot` text PRIMARY KEY NOT NULL,   -- 'icon' | 'logo'
    `bytes` blob NOT NULL,
    `content_type` text NOT NULL,
    `byte_length` integer NOT NULL,
    `updated_at` text NOT NULL
  );
  ```

  Two rows at most, ever. A missing row means "use the built-in default" — the
  absence is the default, so there is no third state to keep in sync. Mirror the
  Drizzle table in `electron/main/db/schema.ts` next to `favicons`, carrying the
  same natural-identity comment.

- `electron/shared/branding.ts` — the shared vocabulary: `BRANDING_SLOTS =
  ['icon', 'logo'] as const`, `BrandingSlot`, the accepted content types, the
  per-slot byte cap, and the zod schemas for a slot state. Follow
  `electron/shared/favicons.ts` for shape and for where the reasoning comments
  live.

- `electron/main/db/repositories/branding.ts` — `readBrandingSlot(db, slot)`,
  `readAllBranding(db)`, `writeBrandingSlot(db, slot, bytes)`,
  `clearBrandingSlot(db, slot)`. `writeBrandingSlot` sniffs the content type
  from the bytes and refuses anything that does not sniff, or that exceeds the
  cap, with a `ValidationError`; it never trusts a caller-declared type. Reuse
  `sniffImageContentType` from `electron/main/favicons/sniff.ts` rather than
  writing a second sniffer.

- **SVG is refused**, on the same reasoning as `electron/shared/favicons.ts:40-52`
  and more strongly: the rail renders inside the app's own origin, so admitting
  an SVG document there is a larger surface than admitting its pixels. Accepted
  set is the raster set already declared for favicons — PNG, JPEG, WEBP, GIF,
  BMP, ICO — decided by magic number, never by file extension or by anything the
  renderer says.

- A byte cap of **512 KB per slot**, declared once in `shared/branding.ts` and
  enforced in the repository. The reason for a cap at all: these bytes are read
  on every app start to paint the rail, and they are base64-inflated on the way
  across IPC.

- `ADR-012-operator-branding-storage.md` recording three decisions together:
  the bytes live in the database rather than as files in the data root (so the
  relocation path in T-260828-19 and any backup carry them without a second
  filesystem path to resolve and guard); the table is keyed by natural identity
  (`slot`) and so takes the ADR-002 exemption from UUID and
  `created_at`/`updated_at`, exactly as `favicons` does; and branding is **not**
  a `settings` key, because `settings:getAll` is fetched by the shell on every
  load and by the settings view, and up to a megabyte of base64 in that snapshot
  would make every settings read pay for an image nobody asked for.

- Unit tests: a good PNG round-trips and sniffs back to `image/png`; an SVG
  document is refused; a byte string that sniffs as nothing is refused; a
  512 KB + 1 byte payload is refused; `clearBrandingSlot` on an absent slot is a
  no-op rather than an error; writing a slot twice replaces rather than
  accumulates.

**Out:** the IPC channels and the native file picker (T-260829-05). Any renderer
change (T-260829-06, T-260829-07). Image resizing, re-encoding, or dimension
validation — there is no decoder in main and adding one is a dependency this
does not need; display size is a CSS concern and the consuming task fixes the
box. Branding anywhere but the rail — not the window icon, not the installer,
not exported documents.

## Touches

- `electron/main/db/migrations/0005_branding.sql` (new), and the migrations
  `meta` journal
- `electron/main/db/schema.ts`
- `electron/main/db/repositories/branding.ts` (new) + its test
- `electron/shared/branding.ts` (new)
- `.dev/decisions/ADR-012-operator-branding-storage.md` (new)

## Acceptance

- [ ] `npm run verify` passes, migrations included.
- [ ] Migrating a database created before this change adds `branding` and leaves
      every existing row untouched; the migration is idempotent under a second run.
- [ ] `writeBrandingSlot` with the bytes of a real PNG stores it, and
      `readBrandingSlot` returns those exact bytes with `content_type = 'image/png'`.
- [ ] `writeBrandingSlot` with an `<svg …>` document throws `ValidationError`
      and writes no row — asserted by reading the slot back as absent.
- [ ] `writeBrandingSlot` with a payload one byte over the declared cap throws
      and writes no row.
- [ ] `grep -rn "branding" electron/shared/settings.ts` finds nothing — branding
      is not a settings key.
- [ ] ADR-012 exists, is `status: accepted`, and its Alternatives section names
      both rejected options (files in the data root; a `settings` key) with the
      specific reason each lost.

## Risks

- **Sniffing is the only gate.** A file that sniffs as PNG but is malformed
  reaches Chromium's decoder as a `data:` URL. That is the same exposure the
  favicon path already accepts, and it is bounded by the same thing: raster only,
  no SVG, hard byte cap.
- **ADR-002's rule is a gotcha in AGENTS.md** — "every table gets a UUID primary
  key and `created_at`/`updated_at`, except tables keyed by natural identity". A
  new natural-identity table without an ADR reads as a violation of that rule
  rather than a documented exemption, which is why the ADR is in scope and not a
  follow-up.
- **The data root must never be a sync folder** — this adds no second path and
  no second way to open the database, so `resolveDatabasePath()` stays the only
  door. Any temptation to write the images beside the database instead would
  reopen that.
- Getting the cap wrong in either direction is quiet: too low and a legitimate
  logo is refused with no obvious recourse; too high and app start slows in a way
  nobody attributes to their logo. 512 KB is the stated compromise and the ADR
  should say it is revisable.

---

## Outcome

**Changed:**

- `electron/shared/branding.ts` (new) — `BRANDING_SLOTS`, `BrandingSlot`, the zod schemas, and `BRANDING_MAX_BYTES = 512 * 1024`. `BRANDING_CONTENT_TYPES` is aliased to `FAVICON_CONTENT_TYPES` so the accepted set cannot drift from what `sniffImageContentType` can actually return.
- `electron/main/db/migrations/0005_branding.sql` (new) — the five-column table, every column `NOT NULL`, so a half-written row is not representable.
- `electron/main/db/migrations/index.ts` — registers `{ version: 5, name: '0005_branding' }`.
- `electron/main/db/schema.ts` — the `branding` Drizzle table beside `favicons`, and the ADR-002 exemption comment in the header extended to name it.
- `electron/main/db/repositories/branding.ts` (new) + 17 tests — read one slot, read both, write, clear.
- `electron/main/db/schema.test.ts` — the drift check widened; see below.
- `.dev/decisions/ADR-012-operator-branding-storage.md` (new) — `status: accepted`, with four alternatives rejected rather than the two the scope asked for.

**Review:** no blocking findings.

*Mutation-tested rather than read.* Four mutants against `branding.test.ts`, each
reverted with a targeted edit: relaxing the cap by one byte → 1 failure; deleting
the unsupported-format refusal → 3; making `clearBrandingSlot` always report a
removal → 1; storing a constant `byte_length` instead of the real one → 3. The
tests can fail, including on the cap boundary and on a stored value — the class
of defect this project has shipped before.

*The widened drift test is a widening, not a weakening.* `schema.test.ts`
asserted the drizzle-kit delta between 0001's snapshot and `schema.ts` contained
`CREATE INDEX` lines and nothing else; `branding` is the first table declared
since 0001, so the delta legitimately carries a `CREATE TABLE` now. The residue
must still be empty after stripping both, and `createTableStatements(delta)` must
*equal* those in the checked-in `0005_branding.sql` — so an undeclared table or a
drifted column list still fails, exactly as before.

**Two scope corrections, both accepted:**

- **The `meta` journal was correctly not touched**, though this task's Touches
  names it. Verified: `meta/_journal.json` holds only `0001_init` — 0002, 0003
  and 0004 are all absent, because migrations register themselves in
  `migrations/index.ts` and the journal is vestigial. Adding a `0005` entry with
  no matching snapshot would have broken `schema.test.ts`, which copies the
  journal into a temp dir and runs `drizzle-kit generate`. The scope was written
  from an assumption about a journal this repo does not maintain.
- **`schema.test.ts` was changed though it is not in Touches.** Unavoidable: the
  first new table since 0001 necessarily lands in that delta. Flagged for
  T-260829-10, which renames tables in `schema.ts` and will land in the same
  delta — it must extend `0006`'s side of this assertion, not relax it.

`typecheck`, `lint`, the branding tests, the whole `electron/main/db` layer (22
files, 597 tests) and the shared-conventions walk all passed on the branch;
`branding` and `schema` (44 tests) passed again on the merged tree.

**Deferred:** nothing. The repository went beyond its listed criteria in one
place worth keeping: a refused write is asserted not to destroy the image already
in the slot, which is how a validation-ordering mistake would have been quietly
destructive.
