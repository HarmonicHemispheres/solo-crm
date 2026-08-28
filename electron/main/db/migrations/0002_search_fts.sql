-- P1-06 (T-260828-36): the FTS5 search index and its sync triggers, in
-- their own migration. schema.ts's header and 0001_init.sql both leave
-- `search_fts` out on purpose (G6) -- an external-content FTS5 table needs
-- its five source tables to already exist, so it cannot be created before
-- them. This file is hand-written, not drizzle-kit output: drizzle-kit has
-- no representation for FTS5 virtual tables or triggers, so schema.ts
-- deliberately says nothing about either (see its header) and
-- schema.test.ts's regeneration check only ever compares against
-- 0001_init.sql.
--
-- Design -- a genuine external-content table, not a self-contained one:
-- `search_fts` is declared with content=/content_rowid=, so its own shadow
-- tables hold the inverted index only, never a second stored copy of
-- `name` / `title` / `body`. (The alternative this task's Risks section
-- warns against, "contentless", cannot be queried for its columns at all --
-- not what was chosen here, and not what this table is.)
--
-- SQLite's content= option names exactly one physical relation with one
-- rowid space, but five different tables need to feed this one index. The
-- view below unions all five, and gives every unioned row a synthetic rowid
-- of `<that table's own SQLite rowid> * 8 + <kind code, 0-4>`. None of the
-- five source tables is declared WITHOUT ROWID, so each already carries a
-- stable, implicit 64-bit rowid distinct from its TEXT `id` column;
-- reserving the low 3 bits for the kind code keeps every table's rowid
-- range disjoint from every other's, with 61 bits of headroom per table --
-- far beyond anything this app's data volumes ever approach.
--
-- The AFTER INSERT/UPDATE/DELETE triggers below recompute that identical
-- `rowid * 8 + <kind code>` formula against NEW/OLD for their own table. It
-- has to match the view's formula exactly, or a trigger's write lands on a
-- rowid the view would never produce for that row, and the
-- rebuild-vs-incremental equivalence test (search.test.ts) catches the
-- mismatch as soon as it diverges.
--
-- AFTER UPDATE is delete-then-insert, never a bare UPDATE -- SQLite's own
-- documented external-content sync pattern (fts5.html, "External Content
-- Tables"). The special `INSERT INTO search_fts(search_fts, rowid, ...)
-- VALUES ('delete', ...)` command removes exactly the terms the OLD column
-- values produced; it is the only correct way to un-index a row from an
-- external-content table, because by the time any trigger body runs, the
-- source row already holds its NEW value (or, on DELETE, is already gone) --
-- FTS5 has no other way left to learn what the OLD text was.
--
-- Kind codes -- fixed. Changing one here without a full rebuild would
-- silently misfile every existing row of that kind on its next write:
--   0 = company    (companies.name)      3 = task     (tasks.title)
--   1 = person     (people.name)         4 = activity (activity.body)
--   2 = engagement (engagements.name)

CREATE VIEW search_fts_content AS
  SELECT rowid * 8 + 0 AS content_rowid, 'company'    AS kind, id AS source_id, name  AS text FROM companies
  UNION ALL
  SELECT rowid * 8 + 1,                  'person',           id,              name         FROM people
  UNION ALL
  SELECT rowid * 8 + 2,                  'engagement',       id,              name         FROM engagements
  UNION ALL
  SELECT rowid * 8 + 3,                  'task',             id,              title        FROM tasks
  UNION ALL
  SELECT rowid * 8 + 4,                  'activity',         id,              body         FROM activity;

CREATE VIRTUAL TABLE search_fts USING fts5(
  kind UNINDEXED,
  source_id UNINDEXED,
  text,
  content='search_fts_content',
  content_rowid='content_rowid'
);

-- Backfill: this table is brand new and, on a database migrated straight
-- from 0001 (whether empty or already carrying the seed fixture — this
-- task's acceptance criteria name both), every row `search_fts_content`
-- selects predates every trigger below. The triggers only ever fire on a
-- write that happens *after* they exist, so without this one-time bulk
-- insert every pre-existing row would stay unsearchable until it was next
-- written to. This is the exact same statement `rebuildSearchIndex`
-- (search.ts) issues after emptying the table, run once here against an
-- index that starts empty rather than one being emptied first.
INSERT INTO search_fts(rowid, kind, source_id, text)
  SELECT content_rowid, kind, source_id, text FROM search_fts_content;

-- companies (kind code 0)

CREATE TRIGGER trg_companies_search_ai AFTER INSERT ON companies BEGIN
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
END;

CREATE TRIGGER trg_companies_search_ad AFTER DELETE ON companies BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 0, 'company', old.id, old.name);
END;

CREATE TRIGGER trg_companies_search_au AFTER UPDATE ON companies BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 0, 'company', old.id, old.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
END;

-- people (kind code 1)

CREATE TRIGGER trg_people_search_ai AFTER INSERT ON people BEGIN
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
END;

CREATE TRIGGER trg_people_search_ad AFTER DELETE ON people BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 1, 'person', old.id, old.name);
END;

CREATE TRIGGER trg_people_search_au AFTER UPDATE ON people BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 1, 'person', old.id, old.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
END;

-- engagements (kind code 2)

CREATE TRIGGER trg_engagements_search_ai AFTER INSERT ON engagements BEGIN
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
END;

CREATE TRIGGER trg_engagements_search_ad AFTER DELETE ON engagements BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 2, 'engagement', old.id, old.name);
END;

CREATE TRIGGER trg_engagements_search_au AFTER UPDATE ON engagements BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 2, 'engagement', old.id, old.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
END;

-- tasks (kind code 3)

CREATE TRIGGER trg_tasks_search_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
END;

CREATE TRIGGER trg_tasks_search_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 3, 'task', old.id, old.title);
END;

CREATE TRIGGER trg_tasks_search_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 3, 'task', old.id, old.title);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
END;

-- activity (kind code 4)

CREATE TRIGGER trg_activity_search_ai AFTER INSERT ON activity BEGIN
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
END;

CREATE TRIGGER trg_activity_search_ad AFTER DELETE ON activity BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 4, 'activity', old.id, old.body);
END;

CREATE TRIGGER trg_activity_search_au AFTER UPDATE ON activity BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 4, 'activity', old.id, old.body);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
END;
