-- An introduction is made by a person, not by a company.
--
-- `companies.introduced_by_company_id` pointed at another company, so the
-- form asked "which company introduced them?" — a question that has no good
-- answer when the honest one is a name. The operator asked for the field to
-- reference the People tab instead. This adds `introduced_by_person_id`,
-- a foreign key at `people.id`, and an index on it so `deletePerson`'s
-- referential pre-check and the person cascade's `clear` step both seek
-- rather than scan.
--
-- The old column is NOT dropped. SQLite refuses `DROP COLUMN` on a column
-- that participates in a foreign key constraint (it would need a full table
-- rebuild), and the values in it cannot be migrated: a company reference is
-- not a person reference. So `introduced_by_company_id` stays in the
-- database, still declared in schema.ts, and is simply no longer on the wire
-- — `electron/shared/companies.ts` dropped it, so nothing can write it
-- again. `deleteCompany` keeps its pre-check on it, and the company cascade
-- keeps its `clear` step, precisely because a row written before this
-- migration can still hold one and the foreign key is still enforced.
--
-- `budget_note` is retired the same way and at the same time: the form no
-- longer carries it, the detail page no longer shows it, the column stays.
--
-- Nullable, default NULL, no backfill — which is also the only shape SQLite
-- allows `ALTER TABLE … ADD` to take for a column with a REFERENCES clause
-- while `foreign_keys` is on.

ALTER TABLE `companies` ADD `introduced_by_person_id` text REFERENCES people(id);--> statement-breakpoint
CREATE INDEX `idx_companies_introduced_by_person_id` ON `companies` (`introduced_by_person_id`);
