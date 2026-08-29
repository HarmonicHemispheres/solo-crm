-- T-260828-41. Two structural gaps migration 0001 left, both of which every
-- repository inherits.
--
-- PART 1 -- the foreign-key indexes.
--
-- 0001 created three indexes and none of them on a foreign key, so every
-- repository's delete pre-check (`refuseIfReferenced`, one
-- `SELECT COUNT(*) FROM <child> WHERE <fk> = ?` per blocker) was a full table
-- scan -- including against `activity`, the fastest-growing table in the app.
-- The statements below are `drizzle-kit generate` output, verbatim, diffed
-- against 0001's snapshot: `schema.ts` now declares each of them, and
-- `schema.test.ts` regenerates the same diff and asserts it matches this file
-- statement for statement, so the two cannot drift.
--
-- Each index exists because a query names the column, never for symmetry with
-- the foreign key -- an index costs write throughput on exactly the tables the
-- Gmail and timelog importers will hammer hardest (this task's Risks). The
-- three composite `(entity_type, entity_id)` indexes are the ones PART 2 needs:
-- a polymorphic reference is only ever queried by both columns together.
--
-- PART 2 -- the polymorphic cascade.
--
-- `links`, `taggings` and `external_refs` reference an entity as
-- `entity_type`/`entity_id` with no foreign key -- no single-table FK can span
-- three parent tables -- so nothing stopped a company delete from stranding
-- their rows, and `seed/index.ts` writes `links` rows with
-- `entity_type = 'company'` today. The recorded decision is **cascade, not
-- refuse**: ADR-011 (.dev/decisions/ADR-011-polymorphic-attachment-cascade.md)
-- has the reasoning and the alternative it rejects.
--
-- The cascade is a trigger rather than a call inside each `deleteX`, for the
-- reason ADR-011 states: a trigger runs inside the deleting statement's own
-- transaction, cannot be forgotten by the next repository, and also covers the
-- writers that never go through a repository at all (the seeder, the importers
-- P4 adds). `referential-guard.ts` holds the matching declaration in TypeScript
-- and its test asserts a trigger exists for every (parent, attachment) pair.
--
-- PART 3 -- the create side of the same policy.
--
-- `links.ts` (T-260828-55) states that `addLink` does not check `entity_id`
-- exists, and names this task as the owner of that decision. Settled the same
-- way and in the same place: a `links` row must name a live entity, enforced
-- by a `BEFORE INSERT`/`BEFORE UPDATE` trigger, so the create side and the
-- delete side give one answer instead of two. `taggings` and `external_refs`
-- get no such trigger -- no writer exists for either yet, and a guard with
-- nothing to guard is a guess about a repository nobody has written.
--
-- This migration deliberately does not touch `search_fts`, `search_source`, or
-- any of the fifteen `trg_*_search_*` triggers 0002/0003 own.

CREATE INDEX `idx_activity_company_id` ON `activity` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_person_id` ON `activity` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_activity_engagement_id` ON `activity` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_affiliations_person_id` ON `affiliations` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_affiliations_company_id` ON `affiliations` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_companies_billed_via_company_id` ON `companies` (`billed_via_company_id`);--> statement-breakpoint
CREATE INDEX `idx_companies_introduced_by_company_id` ON `companies` (`introduced_by_company_id`);--> statement-breakpoint
CREATE INDEX `idx_engagements_billing_company_id` ON `engagements` (`billing_company_id`);--> statement-breakpoint
CREATE INDEX `idx_engagements_client_company_id` ON `engagements` (`client_company_id`);--> statement-breakpoint
CREATE INDEX `idx_external_refs_entity` ON `external_refs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_links_entity` ON `links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_milestones_engagement_id` ON `milestones` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_revenue_lines_engagement_id` ON `revenue_lines` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_taggings_entity` ON `taggings` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_company_id` ON `tasks` (`company_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_engagement_id` ON `tasks` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_tasks_person_id` ON `tasks` (`person_id`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_engagement_id` ON `time_entries` (`engagement_id`);--> statement-breakpoint
CREATE INDEX `idx_time_entries_company_id` ON `time_entries` (`company_id`);

-- ---------------------------------------------------------------------------
-- The cascade. One trigger per parent table, each deleting from all three
-- attachment tables, so the trigger set is three rows rather than nine and a
-- new attachment table extends three bodies in lockstep -- the same shape
-- 0002/0003 use for the search triggers.
--
-- `entity_type` is compared against a literal per parent table, never against
-- a column, so a row whose `entity_type` is NULL or an unrecognised string is
-- left alone rather than silently swept up by whichever delete ran last.
--
-- Naming: `trg_<parent>_attachments_ad`. Distinct from `trg_<parent>_search_ad`
-- (0003), which stays untouched; SQLite runs both, and their order relative to
-- each other does not matter -- neither reads what the other writes.
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_companies_attachments_ad AFTER DELETE ON companies BEGIN
  DELETE FROM links         WHERE entity_type = 'company' AND entity_id = old.id;
  DELETE FROM taggings      WHERE entity_type = 'company' AND entity_id = old.id;
  DELETE FROM external_refs WHERE entity_type = 'company' AND entity_id = old.id;
END;

CREATE TRIGGER trg_people_attachments_ad AFTER DELETE ON people BEGIN
  DELETE FROM links         WHERE entity_type = 'person' AND entity_id = old.id;
  DELETE FROM taggings      WHERE entity_type = 'person' AND entity_id = old.id;
  DELETE FROM external_refs WHERE entity_type = 'person' AND entity_id = old.id;
END;

CREATE TRIGGER trg_engagements_attachments_ad AFTER DELETE ON engagements BEGIN
  DELETE FROM links         WHERE entity_type = 'engagement' AND entity_id = old.id;
  DELETE FROM taggings      WHERE entity_type = 'engagement' AND entity_id = old.id;
  DELETE FROM external_refs WHERE entity_type = 'engagement' AND entity_id = old.id;
END;

-- ---------------------------------------------------------------------------
-- The create side, for `links` only (see PART 3 above).
--
-- The `UNION ALL` subquery is the polymorphic equivalent of a foreign key: at
-- most one branch can match, because each branch tests `new.entity_type`
-- against a different literal, and each branch is an `id = ?` primary-key seek.
-- A NULL or unrecognised `entity_type`, and a NULL `entity_id`, match no branch
-- and are therefore refused -- a `links` row that names nothing live is exactly
-- the orphan this migration exists to make impossible.
--
-- `RAISE(ABORT, ...)` surfaces as `SQLITE_CONSTRAINT_TRIGGER`, which
-- `links.ts` translates into a `RefusalError` through the shared
-- `translateWriteError`; the driver's own message never reaches a caller.
--
-- The UPDATE trigger fires `OF entity_type, entity_id` only. `updateLink`
-- patches `title` and nothing else, so in practice this guards a future writer
-- rather than today's, and costs nothing on the update path that exists.
-- ---------------------------------------------------------------------------

CREATE TRIGGER trg_links_entity_exists_bi BEFORE INSERT ON links BEGIN
  SELECT RAISE(ABORT, 'links.entity_id does not name an existing entity')
  WHERE NOT EXISTS (
    SELECT 1 FROM companies   WHERE new.entity_type = 'company'    AND id = new.entity_id
    UNION ALL
    SELECT 1 FROM people      WHERE new.entity_type = 'person'     AND id = new.entity_id
    UNION ALL
    SELECT 1 FROM engagements WHERE new.entity_type = 'engagement' AND id = new.entity_id
  );
END;

CREATE TRIGGER trg_links_entity_exists_bu BEFORE UPDATE OF entity_type, entity_id ON links BEGIN
  SELECT RAISE(ABORT, 'links.entity_id does not name an existing entity')
  WHERE NOT EXISTS (
    SELECT 1 FROM companies   WHERE new.entity_type = 'company'    AND id = new.entity_id
    UNION ALL
    SELECT 1 FROM people      WHERE new.entity_type = 'person'     AND id = new.entity_id
    UNION ALL
    SELECT 1 FROM engagements WHERE new.entity_type = 'engagement' AND id = new.entity_id
  );
END;
