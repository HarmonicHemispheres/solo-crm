-- T-260901-08 / ADR-015. Somewhere to keep a company's own logo and banner.
--
-- Company detail and the companies grid are to show an operator-supplied logo
-- and banner per company, and there was nowhere to put them: `companies` has
-- no image column, and the only other table holding operator-supplied bytes is
-- `branding`, which ADR-012 bounds to "two rows at most, ever" -- the
-- workspace's own mark and wordmark, read once at startup to paint the rail.
--
-- One row per FILLED slot. A company with no row for a slot renders the
-- derived mark it renders today (`hue(name)` and `initials(name)`, computed at
-- render time and stored nowhere). The absence IS the default, so clearing a
-- slot is a DELETE and there is no `enabled` flag that can disagree with the
-- bytes. Every column is NOT NULL, so a row holding an original with no
-- derivative -- or a derivative with no original -- is not representable.
--
-- NOT the natural-identity exemption. ADR-002's membership test is that the
-- key is a value the outside world already guarantees unique and that no other
-- table holds a foreign key to the row. `branding` passed on the first half:
-- 'logo' is an identity the outside world fixes. The pair (company_id, slot)
-- does not -- `company_id` is a UUID this app minted, and a composite of our
-- own foreign key and a discriminator is exactly what ADR-002 refused to call
-- an identity when it gave `taggings` a UUID plus a unique index on its
-- natural triple. Same reasoning, same shape: the pair is genuinely unique (a
-- company has one logo), so it is enforced as a unique index rather than as
-- the key, and this table carries `created_at`/`updated_at` like every other
-- non-exempt table.
--
-- COLUMN ORDER IS LOAD-BEARING. SQLite stores a row's columns in declared
-- order and spills a large row into a chain of overflow pages; reading a
-- column means walking every page before it. `bytes` -- the original, up to
-- 1 MB -- is declared LAST so the companies grid's read of `thumb_bytes` walks
-- the handful of overflow pages a thumbnail occupies and never touches the
-- up-to-256 pages the original does. Declared first, that same read would walk
-- all of them, for 120 rows, to return the small thing.
--
-- `thumb_bytes` is a downscaled derivative generated once, in main, at write
-- time (96x96 PNG for a logo, 480x270 JPEG q75 for a banner). It is the ONLY
-- rendition a list ever reads: the companies grid reads every company's
-- derivatives in one `companyImages:thumbnails` call (~1.5 MB of base64 at 60
-- companies, against the 83.9 MB reading the originals would cost), and only a
-- detail page reads an original, one company at a time. The original is kept
-- so the derivative stays a cache that can be rebuilt if 480x270 turns out
-- wrong.
--
-- `content_type` is derived from the bytes' own magic numbers
-- (`sniffImageContentType`, the sniffer `favicons` and `branding` already
-- share), never from a file extension and never from anything the renderer
-- says. `thumb_content_type` is asserted from the slot rather than sniffed:
-- every write goes through the same encode step even when no scaling happens,
-- so the derivative's format is a function of the slot and nothing else.
-- `byte_length`/`thumb_byte_length` are stored for `branding`'s reason -- a
-- caller that only wants a size must not have to load a blob -- and
-- `width`/`height` are the ORIGINAL's pixels, free at write time from the
-- decoder, so a view can reserve the banner's box with `aspect-ratio` before
-- the image decodes.
--
-- No CHECK constraining `slot` to the two names, for `branding`'s reason: the
-- list that matters is `COMPANY_IMAGE_SLOTS` in
-- `electron/shared/company-images.ts`, enforced by the repository that also
-- owns the byte caps and the format refusal. A duplicate list in SQL would be
-- a second place to update and the one a schema diff cannot read. Nothing
-- writes this table except that repository.
--
-- ON DELETE cascade -- the first cascading foreign key in this schema, where
-- every other one is `no action`. An image is an attachment in ADR-011's sense
-- (a property of the company, meaningless without it, referenced by nothing),
-- so it cascades rather than blocks. Not ADR-011's trigger: that decision
-- reached for triggers because "SQLite cannot express a foreign key with three
-- possible parents" and named the declarative form it would otherwise have
-- used. This table has one parent, so the engine expresses it. A consequence
-- worth stating where a reader will find it: `deleteCompany`'s
-- `refuseIfReferenced` list deliberately does NOT gain this table, even though
-- its header says it names every foreign key pointing at `companies.id`. This
-- is the one later foreign key that is deliberately not a blocker. The cascade
-- fires because `connection.ts` sets `PRAGMA foreign_keys = ON` per
-- connection; `migrate.ts` turns it off around each migration, which is
-- irrelevant at runtime and right during one.
--
-- Idempotency under a re-run is the runner's, not this file's: `migrate.ts`
-- records each applied version in `schema_migrations` and never re-applies
-- one. This is plain `CREATE TABLE`, exactly as `drizzle-kit generate` emits
-- it from the matching declaration in `schema.ts`.

CREATE TABLE `company_images` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`slot` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`thumb_content_type` text NOT NULL,
	`thumb_byte_length` integer NOT NULL,
	`thumb_bytes` blob NOT NULL,
	`bytes` blob NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_images_company_slot_unique` ON `company_images` (`company_id`,`slot`);
