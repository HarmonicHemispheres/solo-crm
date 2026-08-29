-- P1-06 (T-260828-51): make `search_fts`'s content relation indexable.
--
-- 0002 pointed `content='search_source'` at a *view* whose `content_rowid`
-- was the computed expression `rowid * 8 + <kind code>`. FTS5 resolves that
-- rowid back to a row on every result it returns, and SQLite cannot index a
-- computed expression inside a view, so every such lookup was a full scan of
-- all five source tables -- once per returned row. Measured at the
-- requirements' own 10x reference volume (~31,000 indexed rows), against
-- §8's 100 ms budget: `"acme"*` 95 ms, `"engage"*` 488 ms, `"a"*` 581 ms.
-- `"a"*` is what the command palette issues after the first keystroke of
-- every search anyone ever types.
--
-- This migration keeps `search_fts` external-content and turns
-- `search_source` into a real table whose `content_rowid` is an
-- `INTEGER PRIMARY KEY` -- i.e. the table's own rowid, the one lookup key
-- SQLite resolves in O(log n) with no index to build. The alternative, a
-- self-contained FTS5 table, was rejected: SQLite can only detect that an
-- index has drifted from its source by reading the content relation, so a
-- self-contained table would have answered a query over a stale index
-- confidently and wrongly instead of raising SQLITE_CORRUPT_VTAB. The
-- reasoning, and the numbers this migration is measured against, are in
-- ADR-009 (.dev/decisions/ADR-009-search-content-table.md); ADR-008 records
-- the shape this replaces and the kind-code contract that survives it.
--
-- What does NOT change, deliberately:
--
--   * The kind codes and the `rowid * 8 + <code>` encoding. ADR-008 makes
--     the codes append-only and renumbering a full-rebuild change; nothing
--     here renumbers anything, so every rowid already in `search_fts` still
--     means what it meant.
--   * The name `search_source`. `search_fts`'s `content='search_source'` is
--     baked into its CREATE VIRTUAL TABLE statement in sqlite_master;
--     keeping the name means the virtual table itself -- and the inverted
--     index in its shadow tables -- needs no drop and recreate. The view
--     becomes a table under the same name.
--   * The prohibition on the name `search_fts_content` (ADR-008): still
--     reserved by FTS5 for a self-contained `search_fts`'s own shadow
--     table, and still unused here.
--
--   0 = company    (companies.name)      3 = task     (tasks.title)
--   1 = person     (people.name)         4 = activity (activity.body)
--   2 = engagement (engagements.name)

-- The union of the five source tables survives, renamed, as the *definition*
-- of what `search_source` should contain. It is no longer what FTS5 reads --
-- nothing on the query path touches it -- but it is still the single place
-- the five-table union and the rowid encoding are written down, so the
-- migration's own backfill below and `rebuildSearchIndex` (search.ts) both
-- re-derive the materialised table from it rather than each restating the
-- union. A sixth searchable table extends this view and the trigger set in
-- lockstep, exactly as before.
DROP VIEW search_source;

CREATE VIEW search_source_live AS
  SELECT rowid * 8 + 0 AS content_rowid, 'company'    AS kind, id AS source_id, name  AS text FROM companies
  UNION ALL
  SELECT rowid * 8 + 1,                  'person',           id,              name         FROM people
  UNION ALL
  SELECT rowid * 8 + 2,                  'engagement',       id,              name         FROM engagements
  UNION ALL
  SELECT rowid * 8 + 3,                  'task',             id,              title        FROM tasks
  UNION ALL
  SELECT rowid * 8 + 4,                  'activity',         id,              body         FROM activity;

-- `content_rowid INTEGER PRIMARY KEY` is the whole point: in SQLite that
-- declaration makes the column an alias for the table's own rowid, so
-- FTS5's per-result `WHERE content_rowid = ?` is a direct rowid seek rather
-- than the five-table scan the view forced. `text` is nullable because
-- `activity.body` is (the view has always been able to project NULL there);
-- `kind` and `source_id` are not, because every branch of the union
-- projects a literal and a primary key.
--
-- No UUID id, no created_at/updated_at, and that is deliberate rather than
-- an oversight of AGENTS.md's rule: this is not a table of records. It is
-- FTS5's content relation, addressed only by `content_rowid`, holding no
-- fact that is not already in one of the five source tables, and nothing
-- holds a foreign key to it.
CREATE TABLE search_source (
  content_rowid INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  text TEXT
);

INSERT INTO search_source(content_rowid, kind, source_id, text)
  SELECT content_rowid, kind, source_id, text FROM search_source_live;

-- Every trigger is dropped and recreated rather than added alongside: each
-- one now has to keep the materialised table in step with its source table
-- as well as feeding `search_fts`, and a trigger that updated only the index
-- would leave FTS5 pointing at a content row that does not exist -- the
-- SQLITE_CORRUPT_VTAB case, reached by writing rather than by tampering.
--
-- The order inside each body is deliberate. FTS5's `'delete'` command takes
-- the OLD column values as arguments and does not read the content table to
-- find them, so it must run *before* the content row is removed only in the
-- sense that it must be given the old values -- but keeping the delete first
-- and the content row's removal second means an interrupted trigger can
-- never leave the index holding a row whose content is gone. AFTER UPDATE is
-- delete-then-insert on both relations, never a bare UPDATE, for the same
-- reason 0002 gave: the source row already holds its NEW value by the time
-- the body runs, so FTS5 has no other way left to learn the OLD text. The
-- content row is deleted by OLD rowid and re-inserted at NEW rowid rather
-- than updated in place, so an UPDATE that moves a source row's rowid
-- relocates its content row instead of silently missing it.

-- companies (kind code 0)

DROP TRIGGER trg_companies_search_ai;
DROP TRIGGER trg_companies_search_ad;
DROP TRIGGER trg_companies_search_au;

CREATE TRIGGER trg_companies_search_ai AFTER INSERT ON companies BEGIN
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
END;

CREATE TRIGGER trg_companies_search_ad AFTER DELETE ON companies BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 0, 'company', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 0;
END;

CREATE TRIGGER trg_companies_search_au AFTER UPDATE ON companies BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 0, 'company', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 0;
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 0, 'company', new.id, new.name);
END;

-- people (kind code 1)

DROP TRIGGER trg_people_search_ai;
DROP TRIGGER trg_people_search_ad;
DROP TRIGGER trg_people_search_au;

CREATE TRIGGER trg_people_search_ai AFTER INSERT ON people BEGIN
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
END;

CREATE TRIGGER trg_people_search_ad AFTER DELETE ON people BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 1, 'person', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 1;
END;

CREATE TRIGGER trg_people_search_au AFTER UPDATE ON people BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 1, 'person', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 1;
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 1, 'person', new.id, new.name);
END;

-- engagements (kind code 2)

DROP TRIGGER trg_engagements_search_ai;
DROP TRIGGER trg_engagements_search_ad;
DROP TRIGGER trg_engagements_search_au;

CREATE TRIGGER trg_engagements_search_ai AFTER INSERT ON engagements BEGIN
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
END;

CREATE TRIGGER trg_engagements_search_ad AFTER DELETE ON engagements BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 2, 'engagement', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 2;
END;

CREATE TRIGGER trg_engagements_search_au AFTER UPDATE ON engagements BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 2, 'engagement', old.id, old.name);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 2;
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 2, 'engagement', new.id, new.name);
END;

-- tasks (kind code 3)

DROP TRIGGER trg_tasks_search_ai;
DROP TRIGGER trg_tasks_search_ad;
DROP TRIGGER trg_tasks_search_au;

CREATE TRIGGER trg_tasks_search_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
END;

CREATE TRIGGER trg_tasks_search_ad AFTER DELETE ON tasks BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 3, 'task', old.id, old.title);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 3;
END;

CREATE TRIGGER trg_tasks_search_au AFTER UPDATE ON tasks BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 3, 'task', old.id, old.title);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 3;
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 3, 'task', new.id, new.title);
END;

-- activity (kind code 4)

DROP TRIGGER trg_activity_search_ai;
DROP TRIGGER trg_activity_search_ad;
DROP TRIGGER trg_activity_search_au;

CREATE TRIGGER trg_activity_search_ai AFTER INSERT ON activity BEGIN
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
END;

CREATE TRIGGER trg_activity_search_ad AFTER DELETE ON activity BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 4, 'activity', old.id, old.body);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 4;
END;

CREATE TRIGGER trg_activity_search_au AFTER UPDATE ON activity BEGIN
  INSERT INTO search_fts(search_fts, rowid, kind, source_id, text)
  VALUES ('delete', old.rowid * 8 + 4, 'activity', old.id, old.body);
  DELETE FROM search_source WHERE content_rowid = old.rowid * 8 + 4;
  INSERT INTO search_source(content_rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
  INSERT INTO search_fts(rowid, kind, source_id, text)
  VALUES (new.rowid * 8 + 4, 'activity', new.id, new.body);
END;

-- The index's own rows are rebuilt rather than left in place. The rowid
-- encoding is byte-for-byte 0002's, so every already-indexed row would still
-- resolve against the new table -- but ADR-008's rule is that any change to
-- what `content=` resolves to is a full-rebuild change, and one pass over a
-- single-user database costs this exactly once. It also proves at migration
-- time, rather than at the user's first query, that the materialised table
-- answers every rowid the view used to.
INSERT INTO search_fts(search_fts) VALUES ('delete-all');
INSERT INTO search_fts(rowid, kind, source_id, text)
  SELECT content_rowid, kind, source_id, text FROM search_source;
