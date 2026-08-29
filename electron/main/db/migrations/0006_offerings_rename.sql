-- T-260829-10. The catalogue's identifiers become the offerings' identifiers.
--
-- T-260829-09 renamed what the operator reads (the rail's nav label, the
-- breadcrumb). This renames what the code and the database say, so the two do
-- not drift: `service_categories` -> `offering_categories`, `services` ->
-- `offerings`, `service_versions` -> `offering_versions`, and the two columns
-- that name a renamed table, `offering_versions.service_id` ->
-- `offering_id` and `engagements.service_version_id` -> `offering_version_id`.
--
-- `offerings.category_id` keeps its name: it was already generic, and renaming
-- it would be a change for symmetry rather than for meaning.
--
-- WHY NOW, AND WHY THIS IS CHEAP TODAY -------------------------------------
--
-- No repository reads these three tables yet -- P3-01 (offerings
-- repositories) and P3-07 (the offerings view) are unbuilt, and `/offerings`
-- renders a `ViewPlaceholder`. The only thing that writes them is the dev
-- seed. After P3-01 and P3-07 land the same rename costs a repository, a
-- view, IPC channels and a set of shared zod schemas.
--
-- WHY PLAIN `ALTER TABLE ... RENAME`, NOT THE REBUILD PATTERN ---------------
--
-- The failure this migration has to avoid is silent, not loud: a table
-- renamed while a foreign-key reference to it is not leaves a database that
-- opens, reads, and only fails when something walks the relationship. Since
-- SQLite 3.25 -- and as long as `PRAGMA legacy_alter_table` is off, which is
-- the default and which nothing in this app turns on -- `ALTER TABLE ...
-- RENAME TO` rewrites every `REFERENCES` clause in *other* tables' schemas to
-- name the new table, and `ALTER TABLE ... RENAME COLUMN` rewrites every
-- reference to the column in views and triggers.
--
-- That rewrite is deliberately NOT conditional on `PRAGMA foreign_keys` being
-- on, which matters here because `migrate.ts` runs every migration with
-- foreign keys OFF (its own header explains why: the pragma is a no-op inside
-- a transaction, so the toggle has to sit outside `db.transaction`). The
-- distinction is easy to get backwards from the SQLite documentation, so it
-- is asserted rather than assumed: `0006_offerings_rename.test.ts` migrates a
-- database that already holds *seeded* rows -- a fresh one has nothing to
-- orphan and would pass either way -- then asserts `PRAGMA
-- foreign_key_check` returns no rows, that the `engagements` DDL names
-- `offering_versions`, that row counts survived, and that every engagement's
-- `offering_version_id` still resolves to a row.
--
-- The rebuild pattern (CREATE new, INSERT SELECT, DROP old, RENAME) would be
-- strictly worse here: `engagements` carries the search triggers from 0002 and
-- 0003 and the foreign-key indexes from 0004, and `DROP TABLE` takes its
-- triggers and indexes with it. A rename keeps all of them and moves no rows.
--
-- WHAT THIS DOES NOT TOUCH -------------------------------------------------
--
-- The search index. AGENTS.md's kind-code gotcha (a renumbered code silently
-- repointing already-indexed rows at the wrong table) reads as though it
-- applies and does not: `search_source_live`'s union is companies, people,
-- engagements, tasks and activity, and the catalogue has never been one of
-- them. No kind code moves, so no index rebuild is needed. `engagements` is
-- in that union, but only its `id` and `name` are projected, and neither is
-- renamed here.
--
-- `0001_init.sql` and its drizzle snapshot are history and are not edited:
-- they record what was applied, and editing them would make an existing
-- database's `schema_migrations` row disagree with the file it names. They
-- keep the old names forever, which is correct.

ALTER TABLE `service_categories` RENAME TO `offering_categories`;

ALTER TABLE `services` RENAME TO `offerings`;

ALTER TABLE `service_versions` RENAME TO `offering_versions`;

ALTER TABLE `offering_versions` RENAME COLUMN `service_id` TO `offering_id`;

ALTER TABLE `engagements` RENAME COLUMN `service_version_id` TO `offering_version_id`;
