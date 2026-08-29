import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { MIGRATIONS, type MigrationDefinition } from '../migrations'
import { ValidationError } from './errors'
import { DEFAULT_SEARCH_LIMIT, rebuildSearchIndex, searchAll } from './search'

/**
 * `0002_search_fts.sql`'s own header carries the design (the union view,
 * the `rowid * 8 + kind code` encoding, why `AFTER UPDATE` is
 * delete-then-insert); this file exercises the result against a real,
 * migrated database opened through `openDatabase`/`getDatabase` — the same
 * discipline every other repository test in this directory follows
 * (`companies.test.ts`'s header) — rather than a mock.
 *
 * `insertX` helpers below are raw `db.prepare(...).run(...)` against the
 * five source tables, the same pattern `companies.test.ts`'s
 * `insertActivity`/`insertEngagement`/`insertTask`/`insertAffiliation`/
 * `insertTimeEntry` use for fixture rows outside the module under test —
 * this file is not the place to depend on the other five repositories'
 * create functions for fixture setup.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

// Looked up by version, not `MIGRATIONS[0]` — a migration inserted ahead of
// 0001 in the array would silently repoint an index-based reference at the
// wrong file while every assertion here stayed green.
const MIGRATION_0001: MigrationDefinition = (() => {
  const found = MIGRATIONS.find((m) => m.version === 1)
  if (!found) throw new Error('MIGRATIONS is missing migration version 1')
  return found
})()

afterEach(() => {
  closeDatabase()
})

/** A fully migrated database (0001 + 0002) — every ordinary test's starting point. */
function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir('solo-crm-search-repo-')
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function insertCompany(db: Database.Database, name: string, id: string = randomUUID()): string {
  const now = nowTimestamp()
  db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
  return id
}

function renameCompany(db: Database.Database, id: string, name: string): void {
  db.prepare('UPDATE companies SET name = ?, updated_at = ? WHERE id = ?').run(name, nowTimestamp(), id)
}

function deleteCompany(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM companies WHERE id = ?').run(id)
}

function deletePerson(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM people WHERE id = ?').run(id)
}

function deleteEngagement(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM engagements WHERE id = ?').run(id)
}

function deleteTask(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

function deleteActivity(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM activity WHERE id = ?').run(id)
}

function insertPerson(db: Database.Database, name: string, id: string = randomUUID()): string {
  const now = nowTimestamp()
  db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, now, now)
  return id
}

function insertEngagement(db: Database.Database, name: string, id: string = randomUUID()): string {
  const now = nowTimestamp()
  db.prepare('INSERT INTO engagements (id, name, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    id,
    name,
    '2026-01-01',
    now,
    now
  )
  return id
}

function insertTask(db: Database.Database, title: string, id: string = randomUUID()): string {
  const now = nowTimestamp()
  db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now)
  return id
}

function insertActivity(db: Database.Database, body: string, id: string = randomUUID()): string {
  const now = nowTimestamp()
  db.prepare(
    'INSERT INTO activity (id, occurred_at, kind, title, body, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, now, 'note', 'Note', body, 'manual', now, now)
  return id
}

function ftsCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM search_fts').get() as { c: number }).c
}

function sourceRowCount(db: Database.Database): number {
  const counts = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM companies) + (SELECT COUNT(*) FROM people) + (SELECT COUNT(*) FROM engagements) +
              (SELECT COUNT(*) FROM tasks) + (SELECT COUNT(*) FROM activity) AS c`
    )
    .get() as { c: number }
  return counts.c
}

function allFtsRows(db: Database.Database): unknown[] {
  return db.prepare('SELECT rowid, kind, source_id, text FROM search_fts ORDER BY rowid').all()
}

// ---------------------------------------------------------------------------
// Migration: creates the table and triggers, applies cleanly on 0001
// ---------------------------------------------------------------------------

describe('0002_search_fts: applies cleanly on a database already migrated by 0001', () => {
  it('creates search_fts and its five per-table trigger sets on an empty, freshly-migrated-by-0001 database', () => {
    const tmpDir = makeTmpDir('solo-crm-search-migrate-empty-')
    try {
      openDatabase({ userDataDir: tmpDir, migrations: [MIGRATION_0001] })
      closeDatabase()

      expect(() => openDatabase({ userDataDir: tmpDir })).not.toThrow()
      const db = getDatabase()

      const ftsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_fts'").get()
      expect(ftsTable).toBeDefined()

      // Scoped to the search trigger set rather than counting every trigger
      // in the database: T-260828-41's migration 0004 installs five triggers
      // of its own (the polymorphic attachment cascade, ADR-011), which have
      // nothing to do with this migration. The assertion is unchanged in
      // strength — still exactly fifteen, still one per (table, event), and
      // still named individually below.
      const triggers = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg%search%' ORDER BY name")
        .all() as { name: string }[]
      expect(triggers).toHaveLength(15)
      for (const table of ['companies', 'people', 'engagements', 'tasks', 'activity']) {
        for (const suffix of ['ai', 'ad', 'au']) {
          expect(triggers.map((t) => t.name)).toContain(`trg_${table}_search_${suffix}`)
        }
      }
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('applies cleanly on a database that already contains rows, and indexes every pre-existing row via the migration\'s own backfill', () => {
    const tmpDir = makeTmpDir('solo-crm-search-migrate-populated-')
    try {
      openDatabase({ userDataDir: tmpDir, migrations: [MIGRATION_0001] })
      const seedDb = getDatabase()
      const companyId = insertCompany(seedDb, 'Pre-Existing Co')
      const personId = insertPerson(seedDb, 'Pre-Existing Person')
      const engagementId = insertEngagement(seedDb, 'Pre-Existing Engagement')
      const taskId = insertTask(seedDb, 'Pre-Existing Task')
      const activityId = insertActivity(seedDb, 'Pre-Existing Activity Note')
      closeDatabase()

      expect(() => openDatabase({ userDataDir: tmpDir })).not.toThrow()
      const db = getDatabase()

      // Every row that existed before 0002 ran is indexed, not just rows
      // written after — the migration's own backfill INSERT, not a gap the
      // triggers alone would have left.
      expect(ftsCount(db)).toBe(5)
      const rows = allFtsRows(db) as { kind: string; source_id: string }[]
      const bySourceId = new Map(rows.map((r) => [r.source_id, r.kind]))
      expect(bySourceId.get(companyId)).toBe('company')
      expect(bySourceId.get(personId)).toBe('person')
      expect(bySourceId.get(engagementId)).toBe('engagement')
      expect(bySourceId.get(taskId)).toBe('task')
      expect(bySourceId.get(activityId)).toBe('activity')

      expect(searchAll(db, { query: 'Pre-Existing' })).toHaveLength(5)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// Rename updates the index with no rebuild step
// ---------------------------------------------------------------------------

describe('renaming a company changes its search result with no rebuild step', () => {
  it('a renamed company stops matching its old name and starts matching its new one, immediately', () => {
    withDatabase((db) => {
      const id = insertCompany(db, 'Acme Corp')
      expect(searchAll(db, { query: 'Acme' }).map((r) => r.id)).toContain(id)

      renameCompany(db, id, 'Globex Corp')

      expect(searchAll(db, { query: 'Acme' }).map((r) => r.id)).not.toContain(id)
      const renamed = searchAll(db, { query: 'Globex' })
      expect(renamed).toHaveLength(1)
      expect(renamed[0]).toEqual({ kind: 'company', id, text: 'Globex Corp' })

      // Still exactly one row for this company in the index — the AFTER
      // UPDATE trigger's delete-then-insert did not leave a stale copy
      // behind alongside the fresh one.
      expect(ftsCount(db)).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// Insert / delete / insert leaves no orphan rows, across all five tables
// ---------------------------------------------------------------------------

describe('INSERT … DELETE … INSERT across all five tables leaves no orphan rows', () => {
  it('the FTS row count matches the summed source row count after a full insert/delete/insert cycle on every table', () => {
    withDatabase((db) => {
      const cycle = (insert: (db: Database.Database, text: string) => string, remove: (db: Database.Database, id: string) => void, label: string): void => {
        const first = insert(db, `${label} First`)
        remove(db, first)
        insert(db, `${label} Second`)
      }

      cycle(insertCompany, deleteCompany, 'Cycle Company')
      cycle(insertPerson, deletePerson, 'Cycle Person')
      cycle(insertEngagement, deleteEngagement, 'Cycle Engagement')
      cycle(insertTask, deleteTask, 'Cycle Task')
      cycle(insertActivity, deleteActivity, 'Cycle Activity')

      expect(ftsCount(db)).toBe(sourceRowCount(db))
      expect(sourceRowCount(db)).toBe(5)

      // The deleted "First" rows are gone from the index, not just
      // outnumbered by the "Second" rows.
      expect(searchAll(db, { query: 'First' })).toHaveLength(0)
      expect(searchAll(db, { query: 'Second' })).toHaveLength(5)
    })
  })
})

// ---------------------------------------------------------------------------
// Delete removes the index entry
// ---------------------------------------------------------------------------

describe('deleting a source row removes its index entry', () => {
  it('a deleted company no longer appears in a search that used to find it, for every one of the five tables', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Deletable Company Unique Term')
      const personId = insertPerson(db, 'Deletable Person Unique Term')
      const engagementId = insertEngagement(db, 'Deletable Engagement Unique Term')
      const taskId = insertTask(db, 'Deletable Task Unique Term')
      const activityId = insertActivity(db, 'Deletable Activity Unique Term')
      expect(ftsCount(db)).toBe(5)

      deleteCompany(db, companyId)
      deletePerson(db, personId)
      deleteEngagement(db, engagementId)
      deleteTask(db, taskId)
      deleteActivity(db, activityId)

      expect(ftsCount(db)).toBe(0)
      expect(searchAll(db, { query: 'Unique' })).toEqual([])
    })
  })
})

// ---------------------------------------------------------------------------
// Rebuild produces an index identical to the incrementally maintained one
// ---------------------------------------------------------------------------

describe('rebuildSearchIndex: identical to the incrementally maintained index', () => {
  it('rebuilding after a mix of inserts, a rename and a delete reproduces the exact same rows', () => {
    withDatabase((db) => {
      insertCompany(db, 'Rebuild Company One')
      const renamedId = insertCompany(db, 'Rebuild Company Two')
      insertPerson(db, 'Rebuild Person')
      const deletedEngagementId = insertEngagement(db, 'Rebuild Engagement Gone')
      insertTask(db, 'Rebuild Task')
      insertActivity(db, 'Rebuild Activity Note')

      renameCompany(db, renamedId, 'Rebuild Company Two Renamed')
      deleteEngagement(db, deletedEngagementId)

      const incremental = allFtsRows(db)
      expect(incremental).not.toEqual([])

      rebuildSearchIndex(db)
      const rebuilt = allFtsRows(db)

      expect(rebuilt).toEqual(incremental)
      expect(ftsCount(db)).toBe(sourceRowCount(db))
    })
  })

  it('a database migrated straight from 0001 with pre-existing rows still equals its own rebuild', () => {
    const tmpDir = makeTmpDir('solo-crm-search-rebuild-migrate-')
    try {
      openDatabase({ userDataDir: tmpDir, migrations: [MIGRATION_0001] })
      insertCompany(getDatabase(), 'Backfilled Co')
      insertActivity(getDatabase(), 'Backfilled Activity')
      closeDatabase()

      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      const afterMigration = allFtsRows(db)

      rebuildSearchIndex(db)
      expect(allFtsRows(db)).toEqual(afterMigration)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// rebuildSearchIndex: recovers from a corrupted / drifted index
// ---------------------------------------------------------------------------
//
// Mutation-proven: deleting the `INSERT INTO search_fts(search_fts) VALUES
// ('delete-all')` line out of `rebuildSearchIndex` leaves every other test in
// this file green, because the rest of the suite only ever rebuilds an
// index that is already correct — re-inserting identical rowids over
// themselves is a silent no-op, so nothing catches the delete-all being
// skipped. Recovering from drift (an orphan row with no matching source
// row) is the function's entire reason to exist, so it needs a fixture that
// is actually broken before rebuild runs.

describe('rebuildSearchIndex: recovers from an orphaned index row', () => {
  it('an orphan row makes a matching query throw SQLITE_CORRUPT_VTAB, and rebuildSearchIndex clears it', () => {
    withDatabase((db) => {
      insertCompany(db, 'Acme Corp')

      // Planted directly, bypassing every trigger and the union view: a row
      // in `search_fts` with no corresponding row in `search_source`. FTS5
      // detects this itself on the next query that touches it.
      db.prepare(
        "INSERT INTO search_fts(rowid, kind, source_id, text) VALUES (9999, 'company', 'ghost', 'Ghostly')"
      ).run()

      let caught: unknown
      try {
        searchAll(db, { query: 'Ghostly' })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeDefined()
      expect((caught as { code?: string }).code).toBe('SQLITE_CORRUPT_VTAB')

      // A query that never touches the orphan rowid is unaffected — the
      // corruption is confined to that one FTS5 row until rebuild runs.
      expect(searchAll(db, { query: 'Acme' })).toHaveLength(1)

      rebuildSearchIndex(db)

      // Rebuild throws away every existing row (including the orphan) before
      // repopulating straight from `search_source` — the orphan cannot
      // survive because it was never a source row to begin with.
      expect(searchAll(db, { query: 'Ghostly' })).toEqual([])
      expect(searchAll(db, { query: 'Acme' })).toHaveLength(1)
      expect(ftsCount(db)).toBe(1)
    })
  })
})

// ---------------------------------------------------------------------------
// searchAll: no match, empty query, validation, limit
// ---------------------------------------------------------------------------

describe('searchAll: a query matching nothing returns an empty list, not an error', () => {
  it('a well-formed query with no matches returns []', () => {
    withDatabase((db) => {
      insertCompany(db, 'Something Entirely Different')
      expect(searchAll(db, { query: 'zzzznomatch' })).toEqual([])
    })
  })

  it('a blank query returns [] without touching search_fts (no FTS5 syntax error)', () => {
    withDatabase((db) => {
      insertCompany(db, 'Acme Corp')
      expect(searchAll(db, { query: '' })).toEqual([])
      expect(searchAll(db, { query: '   ' })).toEqual([])
    })
  })

  it('a punctuation-only query returns [] rather than throwing an FTS5 syntax error', () => {
    withDatabase((db) => {
      insertCompany(db, 'Acme Corp')
      expect(searchAll(db, { query: '***"()' })).toEqual([])
    })
  })
})

describe('searchAll: prefix matching, kind labelling, and limit', () => {
  it('a prefix matches a longer word in an indexed column, across every kind', () => {
    withDatabase((db) => {
      insertCompany(db, 'Consultancy Partners')
      insertPerson(db, 'Constance Consultant')
      insertEngagement(db, 'Consulting Engagement')
      insertTask(db, 'Consult with client')
      insertActivity(db, 'Had a consultation call')

      const results = searchAll(db, { query: 'consul' })
      const kinds = results.map((r) => r.kind).sort()
      expect(kinds).toEqual(['activity', 'company', 'engagement', 'person', 'task'])
    })
  })

  it('a multi-token query requires every token to prefix-match (implicit AND)', () => {
    withDatabase((db) => {
      insertCompany(db, 'Acme Consulting')
      insertCompany(db, 'Acme Logistics')
      const results = searchAll(db, { query: 'acme consul' })
      expect(results).toHaveLength(1)
      expect(results[0].text).toBe('Acme Consulting')
    })
  })

  it('ranks a short, exact-match row ahead of a longer row that only dilutes the same term', () => {
    withDatabase((db) => {
      // Inserted in this order deliberately: with `ORDER BY rank` removed
      // from searchAll's query, FTS5 falls back to rowid order, which would
      // put the long, worse-matching row first — the opposite of what this
      // test asserts. Confirmed by hand against a standalone fixture.
      insertCompany(db, 'Nimbus Global Consulting Partners Alliance Holdings International Group')
      insertCompany(db, 'Nimbus')

      const results = searchAll(db, { query: 'Nimbus' })
      expect(results.map((r) => r.text)).toEqual([
        'Nimbus',
        'Nimbus Global Consulting Partners Alliance Holdings International Group'
      ])
    })
  })

  it('an explicit limit is respected and caps at DEFAULT_SEARCH_LIMIT worth of behaviour when omitted', () => {
    withDatabase((db) => {
      for (let i = 0; i < 30; i++) {
        insertCompany(db, `Limit Test Company ${i}`)
      }
      expect(searchAll(db, { query: 'Limit', limit: 5 })).toHaveLength(5)
      expect(searchAll(db, { query: 'Limit' })).toHaveLength(DEFAULT_SEARCH_LIMIT)
    })
  })
})

describe('searchAll: input validation', () => {
  it('rejects a non-object input', () => {
    withDatabase((db) => {
      expect(() => searchAll(db, 'not an object')).toThrow(ValidationError)
    })
  })

  it('rejects a missing query field', () => {
    withDatabase((db) => {
      expect(() => searchAll(db, {})).toThrow(ValidationError)
    })
  })

  it('rejects an unknown field', () => {
    withDatabase((db) => {
      expect(() => searchAll(db, { query: 'acme', typo: true })).toThrow(ValidationError)
    })
  })
})

// ---------------------------------------------------------------------------
// Ids round-trip
// ---------------------------------------------------------------------------

describe('a result carries the source row\'s real id', () => {
  it('id is the UUID of the underlying companies row, not a synthetic FTS rowid', () => {
    withDatabase((db) => {
      const id = insertCompany(db, 'Real Id Co')
      const [result] = searchAll(db, { query: 'Real Id' })
      expect(result.id).toBe(id)
      expect(result.id).toMatch(UUID_PATTERN)
    })
  })
})
