-- T-260829-04. Somewhere to keep the operator's own icon and wordmark.
--
-- The rail's brand block is hardcoded markup today. For the operator to put
-- their own mark there, the app needs a store that survives a restart, moves
-- with the data root when it is relocated (ADR-006's pointer file), and is
-- carried by whatever backs the database up. That is one table, in the
-- database, and ADR-012 records why it is not files beside the database and
-- not a `settings` key.
--
-- Two rows at most, ever: `slot` is 'icon' or 'logo'. A missing row means "use
-- the built-in default" -- the absence IS the default, so there is no third
-- state and no flag that can disagree with the bytes. Clearing a slot is a
-- DELETE.
--
-- Keyed by `slot`, a natural identity: no UUID primary key, no `created_at`.
-- That is ADR-002's stated exemption class, the same one `settings` (by key)
-- and `favicons` (by host) sit in, and ADR-012 records this table's
-- membership explicitly so it does not read as a violation of the
-- unqualified rule in AGENTS.md. `updated_at` is kept and `created_at` is
-- not, for `settings`' reason: a slot has no creation event worth recording
-- -- the built-in default was in force before the row existed -- but
-- last-write-wins is exactly what a future replica needs.
--
-- `content_type` is stored rather than re-sniffed on every read, unlike
-- `favicons`, because it is written from bytes the repository has already
-- sniffed and refused if unrecognised, and because these bytes are read on
-- every app start to paint the rail. It is never a caller's claim about the
-- file: `writeBrandingSlot` derives it from the magic numbers and ignores
-- anything the picker, the file extension or the renderer says. `byte_length`
-- is stored for the same reason -- so a read that only wants to report size
-- does not have to load the blob.
--
-- No CHECK constraining `slot` to the two names. The check that matters is in
-- `electron/shared/branding.ts` (`BRANDING_SLOTS`) and enforced by the
-- repository, which is where the byte cap and the format refusal already
-- live; a duplicate list in SQL would be a second place to update and the
-- one a schema diff cannot read. Nothing writes this table except that
-- repository.
--
-- Idempotency under a re-run is the runner's, not this file's: `migrate.ts`
-- records each applied version in `schema_migrations` and never re-applies
-- one. This is plain `CREATE TABLE`, exactly as `drizzle-kit generate` emits
-- it from the matching declaration in `schema.ts`.

CREATE TABLE `branding` (
	`slot` text PRIMARY KEY NOT NULL,
	`bytes` blob NOT NULL,
	`content_type` text NOT NULL,
	`byte_length` integer NOT NULL,
	`updated_at` text NOT NULL
);
