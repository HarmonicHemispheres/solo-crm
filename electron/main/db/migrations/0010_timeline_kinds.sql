-- Notes and todos carry the same six facts, and the category is editable.
--
-- The operator asked for an event and a todo to hold the same thing: a short
-- description, a full description, the date it happened, the date it is due,
-- which of the two it is, and a category they can maintain themselves. Five
-- of the six existed already, split unevenly across the two tables:
--
--   activity  had title, body, occurred_at, kind          — no due date
--   tasks     had title,       due_on                     — no body, no
--                                                            happened-on,
--                                                            no category
--
-- So this migration adds the four missing columns. It deliberately does NOT
-- merge the two tables into one `timeline_entries`. `activity` is append-only
-- (G8, ADR-001) and `tasks` has a status lifecycle with transition-owned
-- timestamps and the single-next-step-per-company invariant; one table would
-- have had to abandon the first and special-case the second. It would also
-- have meant renumbering `search_fts`'s kind codes 3 and 4, which ADR-008
-- says plainly does not fail loudly — it silently repoints already-indexed
-- rows at the wrong table. "Event" and "todo" are therefore not a stored
-- column anywhere: an event is an `activity` row, a todo is a `tasks` row,
-- and `renderer/lib/timeline.tsx` reads the two back as one list.
--
-- `kind` becomes the category rather than gaining a `category` column beside
-- it. It was a closed four-value set (call | email | meeting | note) enforced
-- by a zod enum on the wire and by nothing at all in SQL; it is now a slug
-- from the `timeline.kinds` setting, which the operator edits. There is no
-- CHECK constraint on either table's `kind` and there must not be one: a
-- category can be removed from the list while rows that carry it remain, and
-- an `activity` row cannot be edited to repair its category even in
-- principle. Rendering an unknown id is `resolveTimelineKind`'s job
-- (electron/shared/timeline.ts), not the database's.
--
-- Nothing is lost on either table. `DEFAULT_TIMELINE_KINDS` seeds the setting
-- with the operator's four requested defaults plus `call` and `email`, so
-- every existing `activity.kind` value still resolves to the label it always
-- had; the `activity` table itself needs no backfill at all. `tasks` gets one
-- — every pre-existing row becomes `task`, matching `DEFAULT_TODO_KIND_ID`
-- and matching what `createTask` now defaults a new row to, so a workspace
-- upgrading into this version does not open onto a list of uncategorised
-- todos.
--
-- Column order is not load-bearing here the way it is in `company_images`:
-- neither table holds a large blob, so nothing spills into overflow pages and
-- an appended column costs nothing to read past.

ALTER TABLE `tasks` ADD `body` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `occurred_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `activity` ADD `due_on` text;--> statement-breakpoint

-- The one backfill. `WHERE kind IS NULL` rather than unconditional so
-- re-running this statement by hand against a partly-migrated database
-- cannot overwrite a category the operator has since chosen.
UPDATE `tasks` SET `kind` = 'task' WHERE `kind` IS NULL;
