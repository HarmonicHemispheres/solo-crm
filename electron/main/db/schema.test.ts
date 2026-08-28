import type Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from './connection'

/**
 * Asserts the *shape* migration 0001 produces — every table requirements §5
 * (as amended by ADR-001 through ADR-003) names, minus `search_fts` (P1-06's
 * migration, not this one) — via `pragma_table_info`/`sqlite_master`, which
 * is what this task's acceptance criteria ask for ("a query... asserts it
 * rather than a reviewer checking by eye").
 *
 * Every connection here goes through `openDatabase`/`getDatabase`, never a
 * directly-constructed better-sqlite3 handle: `connection.test.ts`'s
 * "single owner of the SQLite connection" test walks every `.ts` file
 * under `electron/` for that literal construction, this file included.
 */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Opens a freshly migrated database in its own temp directory, runs `fn` against it, and cleans up. */
function withMigratedDb<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir('solo-crm-schema-')
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: unknown
  pk: number
}

function tableInfo(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[]
}

describe('schema.ts and 0001_init.sql cannot drift', () => {
  it(
    'regenerating the migration from schema.ts reproduces the checked-in SQL exactly',
    () => {
      // schema.ts is imported by no production module — the runtime applies
      // the checked-in SQL — so nothing else would catch a hand-edit of the
      // SQL or an unregenerated schema change, and a wrong 0002 generated
      // from a drifted snapshot is the expensive failure this guards
      // (T-260828-07 review, should-fix 2).
      const here = dirname(fileURLToPath(import.meta.url))
      const repoRoot = resolve(here, '..', '..', '..')
      const outDir = makeTmpDir('solo-crm-drizzle-regen-')
      try {
        // drizzle-kit treats --schema as a glob, and its globber only
        // understands forward slashes — a Windows backslash path matches
        // nothing ("No schema files found").
        const toPosix = (p: string): string => p.replace(/\\/g, '/')
        const result = spawnSync(
          process.execPath,
          [
            join(repoRoot, 'node_modules', 'drizzle-kit', 'bin.cjs'),
            'generate',
            '--dialect', 'sqlite',
            '--schema', toPosix(join(here, 'schema.ts')),
            '--out', toPosix(outDir),
            '--name', 'init'
          ],
          { cwd: repoRoot, encoding: 'utf-8', timeout: 60_000 }
        )
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(0)

        const generated = readdirSync(outDir).filter((f) => f.endsWith('.sql'))
        expect(generated).toHaveLength(1)
        // Normalize line endings: git's autocrlf checks the committed file out
        // with CRLF on Windows while drizzle-kit always emits LF.
        const normalize = (sql: string): string => sql.replace(/\r\n/g, '\n')
        const regenerated = normalize(readFileSync(join(outDir, generated[0]), 'utf-8'))
        const checkedIn = normalize(readFileSync(join(here, 'migrations', '0001_init.sql'), 'utf-8'))
        expect(regenerated).toBe(checkedIn)
      } finally {
        rmSync(outDir, { recursive: true, force: true })
      }
    },
    // T-260828-47: this spawns a real `drizzle-kit generate` child process,
    // itself allowed up to 60_000ms (the spawnSync `timeout` above) — an
    // outer test timeout below that fires first regardless of how the child
    // is doing, which is exactly the mis-set 5000ms default that made this
    // file flaky. Measured wall time for this test alone: 5.1-6.4s idle,
    // 6.3-11.2s with all 8 cores kept busy by a separate CPU-saturating
    // process (see that task's Acceptance criterion). 65_000ms is the
    // child's own 60s budget plus headroom for the harness around it, not a
    // guess: this test now also runs in the serial `runtime-boot-node`
    // project (vitest.config.ts), so it no longer competes with the rest of
    // the suite for that CPU either.
    65_000
  )
})

function column(columns: ColumnInfo[], name: string): ColumnInfo | undefined {
  return columns.find((c) => c.name === name)
}

// Every table requirements §5 names, exactly, that migration 0001 owns —
// search_fts excluded (G6 / P1-06). Doubling as the completeness check: a
// table added or renamed in schema.ts without a matching entry here (or
// vice versa) fails the "no more, no fewer" assertion below rather than
// passing silently.
const EXPECTED_TABLES = [
  'companies',
  'people',
  'affiliations',
  'service_categories',
  'services',
  'service_versions',
  'engagements',
  'milestones',
  'revenue_lines',
  'time_entries',
  'tasks',
  'activity',
  'links',
  'favicons',
  'external_refs',
  'tags',
  'taggings',
  'settings'
]

// ADR-002's exemption class: keyed by natural identity, no UUID primary key,
// no `created_at`. Every other table in EXPECTED_TABLES gets both.
const NATURAL_KEY_EXEMPT_TABLES = new Set(['favicons', 'settings'])

function domainTableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]
  // schema_migrations is the runner's own bookkeeping (migrate.ts), not a
  // §5 domain table — excluded the same way from every assertion below.
  return rows.map((r) => r.name).filter((name) => name !== 'schema_migrations')
}

describe('migration 0001: the exact set of domain tables', () => {
  it('creates every §5 table named in EXPECTED_TABLES, no more and no fewer, and no search_fts', () => {
    withMigratedDb((db) => {
      const actual = domainTableNames(db).sort()
      expect(actual).toEqual([...EXPECTED_TABLES].sort())
      expect(actual).not.toContain('search_fts')
    })
  })
})

describe('every non-exempt table: UUID text primary key + created_at + updated_at', () => {
  const nonExempt = EXPECTED_TABLES.filter((t) => !NATURAL_KEY_EXEMPT_TABLES.has(t))

  it.each(nonExempt)('%s has an `id` TEXT NOT NULL primary key, plus created_at/updated_at TEXT NOT NULL', (table) => {
    withMigratedDb((db) => {
      const columns = tableInfo(db, table)

      const id = column(columns, 'id')
      expect(id, `${table}.id`).toBeDefined()
      expect(id?.type.toUpperCase()).toBe('TEXT')
      expect(id?.notnull).toBe(1)
      expect(id?.pk).toBe(1)

      for (const field of ['created_at', 'updated_at']) {
        const col = column(columns, field)
        expect(col, `${table}.${field}`).toBeDefined()
        expect(col?.type.toUpperCase()).toBe('TEXT')
        expect(col?.notnull, `${table}.${field} NOT NULL`).toBe(1)
        // Never a SQL-side default — CONVENTIONS.md: timestamps are written
        // from JS via nowTimestamp(), never CURRENT_TIMESTAMP.
        expect(col?.dflt_value, `${table}.${field} has no SQL-side default`).toBeNull()
      }
    })
  })
})

describe('the natural-identity exemption (ADR-002): settings and favicons', () => {
  it('settings is keyed by `key`, has no `id` and no `created_at`, and `updated_at` is NOT NULL', () => {
    withMigratedDb((db) => {
      const columns = tableInfo(db, 'settings')

      expect(column(columns, 'id')).toBeUndefined()
      expect(column(columns, 'created_at')).toBeUndefined()

      const key = column(columns, 'key')
      expect(key?.type.toUpperCase()).toBe('TEXT')
      expect(key?.pk).toBe(1)
      expect(key?.notnull).toBe(1)

      const updatedAt = column(columns, 'updated_at')
      expect(updatedAt).toBeDefined()
      expect(updatedAt?.notnull).toBe(1)

      const value = column(columns, 'value')
      expect(value?.notnull).toBe(1)
    })
  })

  it('favicons is keyed by `host`, has no `id`, no `created_at`, no `updated_at`', () => {
    withMigratedDb((db) => {
      const columns = tableInfo(db, 'favicons')

      expect(column(columns, 'id')).toBeUndefined()
      expect(column(columns, 'created_at')).toBeUndefined()
      expect(column(columns, 'updated_at')).toBeUndefined()

      const host = column(columns, 'host')
      expect(host?.type.toUpperCase()).toBe('TEXT')
      expect(host?.pk).toBe(1)
      expect(host?.notnull).toBe(1)

      expect(column(columns, 'fetched_at')).toBeDefined()
    })
  })
})

describe("companies.billed_via_company_id != id (taskplan P1-01 acceptance, this task's binding constraint)", () => {
  const now = '2026-08-28T10:15:00.000Z'

  it("rejects an INSERT where billed_via_company_id equals the row's own id", () => {
    withMigratedDb((db) => {
      expect(() =>
        db
          .prepare(
            'INSERT INTO companies (id, name, billed_via_company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run('self-billed', 'Self Billed Co', 'self-billed', now, now)
      ).toThrow(/CHECK constraint failed/i)
    })
  })

  it('accepts NULL billed_via_company_id (the ordinary "bills directly" case)', () => {
    withMigratedDb((db) => {
      expect(() =>
        db
          .prepare(
            'INSERT INTO companies (id, name, billed_via_company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run('direct-co', 'Direct Co', null, now, now)
      ).not.toThrow()
    })
  })

  it('accepts billed_via_company_id pointing at a different, existing company', () => {
    withMigratedDb((db) => {
      db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        'parent-co',
        'Parent Co',
        now,
        now
      )
      expect(() =>
        db
          .prepare(
            'INSERT INTO companies (id, name, billed_via_company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
          )
          .run('child-co', 'Child Co', 'parent-co', now, now)
      ).not.toThrow()
    })
  })
})

describe('engagements.ends_on: nullable, no sentinel default', () => {
  const now = '2026-08-28T10:15:00.000Z'

  it('accepts an INSERT with ends_on omitted and reads back exactly NULL', () => {
    withMigratedDb((db) => {
      db.prepare(
        'INSERT INTO engagements (id, name, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run('rolling-engagement', 'Rolling retainer', '2026-01-01', now, now)
      const row = db.prepare('SELECT ends_on FROM engagements WHERE id = ?').get('rolling-engagement') as {
        ends_on: unknown
      }
      expect(row.ends_on).toBeNull()
    })
  })

  it('has no default clause on ends_on at the schema level', () => {
    withMigratedDb((db) => {
      const columns = tableInfo(db, 'engagements')
      const endsOn = column(columns, 'ends_on')
      expect(endsOn).toBeDefined()
      expect(endsOn?.notnull).toBe(0)
      expect(endsOn?.dflt_value).toBeNull()
    })
  })
})

describe("indexes named in this task's Risks (§8: 20k time entries)", () => {
  it('revenue_lines.period_month is indexed', () => {
    withMigratedDb((db) => {
      const indexes = db.prepare('PRAGMA index_list(revenue_lines)').all() as { name: string }[]
      const indexed = indexes.some((idx) => {
        const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[]
        return cols.some((c) => c.name === 'period_month')
      })
      expect(indexed).toBe(true)
    })
  })

  it('time_entries.worked_on is indexed', () => {
    withMigratedDb((db) => {
      const indexes = db.prepare('PRAGMA index_list(time_entries)').all() as { name: string }[]
      const indexed = indexes.some((idx) => {
        const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[]
        return cols.some((c) => c.name === 'worked_on')
      })
      expect(indexed).toBe(true)
    })
  })
})
