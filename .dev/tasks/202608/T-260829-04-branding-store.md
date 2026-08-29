---
id: T-260829-04
title: Store an operator-supplied icon and logo as bytes in the database
status: in-progress
category: data
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
