import type Database from 'better-sqlite3'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from './connection'
import { MIGRATIONS, type MigrationDefinition } from './migrations'

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

/**
 * As `withMigratedDb`, but applies only migration 0001 — never the app's
 * full default migration set, which since T-260828-36 also includes 0002
 * (`search_fts`). The one test below asserting `search_fts`'s absence is
 * specifically about what 0001 alone produces (G6); it would be trivially
 * and wrongly broken by 0002 legitimately adding that table to every
 * *default* `openDatabase()` call, so it opens through this instead.
 */
// Looked up by version, not `MIGRATIONS[0]` — a migration inserted ahead of
// 0001 in the array would silently repoint an index-based reference at the
// wrong file while every assertion here stayed green.
const MIGRATION_0001: MigrationDefinition = (() => {
  const found = MIGRATIONS.find((m) => m.version === 1)
  if (!found) throw new Error('MIGRATIONS is missing migration version 1')
  return found
})()

function withMigration0001OnlyDb<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir('solo-crm-schema-0001-only-')
  try {
    openDatabase({ userDataDir: tmpDir, migrations: [MIGRATION_0001] })
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

/** Every `CREATE INDEX ...;` statement in a migration's text, one per entry, semicolon stripped. */
function createIndexStatements(sql: string): string[] {
  return sql
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.startsWith('CREATE INDEX'))
    .map((line) => line.slice(0, line.indexOf(';')))
}

/**
 * Every `CREATE TABLE …( … );` statement in a migration's text, whitespace
 * collapsed so a tab-vs-space difference between drizzle-kit's output and the
 * checked-in file is not read as drift. Multi-line, unlike an index — the
 * column list is the part that matters.
 */
function createTableStatements(sql: string): string[] {
  const normalised = sql.replace(/\r\n/g, '\n')
  const statements: string[] = []
  const pattern = /^CREATE TABLE [\s\S]*?^\);$/gm
  for (const match of normalised.matchAll(pattern)) {
    statements.push(match[0].replace(/\s+/g, ' ').trim())
  }
  return statements
}

/**
 * Every `ALTER TABLE … RENAME TO …` / `ALTER TABLE … RENAME COLUMN … TO …`
 * a checked-in migration performs, as `from`/`to` pairs — read out of the
 * migrations themselves rather than restated here, so a future rename cannot
 * land in a migration and be forgotten in this file.
 *
 * Backticks are optional in the pattern because a hand-written migration may
 * quote identifiers the way drizzle-kit does or not at all.
 */
function renamesInMigrations(migrations: readonly MigrationDefinition[]): { from: string; to: string }[] {
  const renames: { from: string; to: string }[] = []
  const renameTable = /ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+TO\s+`?(\w+)`?/gi
  const renameColumn = /ALTER\s+TABLE\s+`?\w+`?\s+RENAME\s+COLUMN\s+`?(\w+)`?\s+TO\s+`?(\w+)`?/gi
  for (const migration of migrations) {
    for (const pattern of [renameTable, renameColumn]) {
      pattern.lastIndex = 0
      for (const match of migration.sql.matchAll(pattern)) {
        renames.push({ from: match[1], to: match[2] })
      }
    }
  }
  return renames
}

/**
 * `text` with every rename applied, longest `from` first.
 *
 * Longest-first matters because these identifiers nest: `service_versions`
 * contains `service_version`, and drizzle's own foreign-key names concatenate
 * several of them (`service_versions_service_id_services_id_fk`). Substituting
 * `services` before `service_versions` would corrupt the longer name. Each
 * match is parked on a sentinel that cannot appear in JSON before any `to`
 * value is written back, so a rename whose target is another rename's source
 * cannot be applied twice.
 */
function applyRenames(text: string, renames: readonly { from: string; to: string }[]): string {
  // U+0000 cannot appear unescaped in JSON, so no snapshot can contain it.
  const sentinel = (i: number): string => `\u0000${i}\u0000`
  const ordered = [...renames].sort((a, b) => b.from.length - a.from.length)
  let result = text
  ordered.forEach((rename, i) => {
    result = result.split(rename.from).join(sentinel(i))
  })
  ordered.forEach((rename, i) => {
    result = result.split(sentinel(i)).join(rename.to)
  })
  return result
}

describe('schema.ts and the checked-in migrations cannot drift', () => {
  it(
    'regenerating from schema.ts against 0001 (plus 0006’s renames) produces exactly the indexes 0004 creates and the table 0005 creates',
    () => {
      // schema.ts is imported by no production module — the runtime applies
      // the checked-in SQL — so nothing else would catch a hand-edit of the
      // SQL or an unregenerated schema change, and a wrong migration
      // generated from a drifted snapshot is the expensive failure this
      // guards (T-260828-07 review, should-fix 2).
      //
      // Until T-260828-41 this compared a from-scratch regeneration against
      // `0001_init.sql`, which worked only while 0001 was the sole
      // schema.ts-derived migration. schema.ts is cumulative and migrations
      // are incremental, so once 0004 added the foreign-key indexes a
      // from-scratch generation could no longer equal 0001 by construction.
      // The incremental form below is the same guarantee, not a weaker one:
      // the temp folder is seeded with 0001's snapshot, so drizzle-kit emits
      // the *delta* between the snapshot and schema.ts — and this test
      // asserts that delta is exactly 0004's `CREATE INDEX` statements and
      // nothing else. Any drift in a table definition would appear in the
      // delta as a CREATE/ALTER statement and fail the "indexes only"
      // assertion below.
      //
      // 0002 and 0003 (search_fts, search_source) are hand-written and are
      // not in the journal; they add no object schema.ts declares, so the
      // snapshot staying at 0001 is correct rather than an oversight.
      //
      // T-260829-10 added one step to seeding that base. 0006 renames three
      // tables and two columns, and drizzle-kit cannot express a rename
      // without asking: seeing three tables gone and three arrived, it opens
      // an interactive "created or renamed?" prompt, which refuses to run
      // without a TTY and so produces no migration at all. Diffing schema.ts
      // against a base that still holds the *old* names is therefore not
      // possible, by construction rather than by configuration.
      //
      // So the base is 0001's snapshot with 0006's renames applied — the
      // state after 0001 and 0006, before 0004 and 0005 — and the delta is
      // once again exactly 0004's indexes and 0005's table, asserted below
      // unchanged. The renames come out of the registered migrations' own SQL
      // (`renamesInMigrations`), never a list restated here, so this base
      // cannot drift from what the runtime applies; a rename that reaches
      // schema.ts without reaching a migration still leaves a created/dropped
      // pair, still hits the prompt, and still fails this test.
      const here = dirname(fileURLToPath(import.meta.url))
      const repoRoot = resolve(here, '..', '..', '..')
      const migrationsDir = join(here, 'migrations')
      // The out folder must be *inside* the cwd drizzle-kit is spawned with:
      // its snapshot reader joins cwd with the `--out` value, so an absolute
      // path in a system temp directory is read back as
      // `<repoRoot>\C:\Users\...\meta\0001_snapshot.json` and fails ENOENT.
      // (The old from-scratch form never hit that code path — it seeded no
      // snapshot to read.)
      const outDirName = `.drizzle-regen-${process.pid}-${Date.now()}`
      const outDir = join(repoRoot, outDirName)
      try {
        mkdirSync(join(outDir, 'meta'), { recursive: true })
        cpSync(join(migrationsDir, 'meta', '_journal.json'), join(outDir, 'meta', '_journal.json'))
        cpSync(join(migrationsDir, 'meta', '0001_snapshot.json'), join(outDir, 'meta', '0001_snapshot.json'))
        cpSync(join(migrationsDir, '0001_init.sql'), join(outDir, '0001_init.sql'))

        // drizzle-kit takes the *last* file in `meta/` (excluding `_journal`,
        // sorted by name) as the previous snapshot — the journal only names
        // the migration it is about to write. `0001a_` sorts after
        // `0001_snapshot.json` ('_' < 'a') and cannot be clobbered by
        // drizzle's own `<tag>_snapshot.json` output. `prevId` chains it to
        // 0001 so drizzle's collision check sees one child, not two.
        const renames = renamesInMigrations(MIGRATIONS)
        expect(renames.length, 'renamesInMigrations found no renames to apply').toBeGreaterThan(0)
        const snapshot0001 = readFileSync(join(migrationsDir, 'meta', '0001_snapshot.json'), 'utf-8')
        const renamedBase = JSON.parse(applyRenames(snapshot0001, renames)) as Record<string, unknown>
        renamedBase.prevId = (JSON.parse(snapshot0001) as { id: string }).id
        renamedBase.id = '00000000-0000-0000-0000-0000000006ce'
        writeFileSync(join(outDir, 'meta', '0001a_renamed_snapshot.json'), JSON.stringify(renamedBase, null, 2))

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
            '--out', outDirName,
            '--name', 'regen'
          ],
          { cwd: repoRoot, encoding: 'utf-8', timeout: 60_000 }
        )
        expect(result.error).toBeUndefined()
        expect(result.status).toBe(0)

        const generated = readdirSync(outDir).filter((f) => f.endsWith('.sql') && f !== '0001_init.sql')
        expect(generated).toHaveLength(1)
        // Normalize line endings: git's autocrlf checks the committed file out
        // with CRLF on Windows while drizzle-kit always emits LF.
        const delta = readFileSync(join(outDir, generated[0]), 'utf-8').replace(/\r\n/g, '\n')

        // T-260829-04 widened this from "indexes only" to "indexes and the
        // tables schema.ts declares that 0001 did not". `branding` is the
        // first table added since 0001, so the delta legitimately carries a
        // CREATE TABLE now; the assertions below still pin every statement in
        // it to a checked-in migration, so an *undeclared* table or a drifted
        // column list fails exactly as before.
        //
        // Nothing but those two: strip every CREATE TABLE block, every CREATE
        // INDEX line, and drizzle's own statement separators, and what remains
        // must be blank. A dropped column or a renamed table shows up here.
        const withoutTables = delta.replace(/^CREATE TABLE [\s\S]*?^\);$/gm, '')
        const residue = withoutTables
          .split('\n')
          .filter((line) => !line.startsWith('CREATE INDEX'))
          .join('\n')
          .replace(/--> statement-breakpoint/g, '')
          .trim()
        expect(residue).toBe('')

        const checkedIn0004 = readFileSync(join(migrationsDir, '0004_fk_indexes_polymorphic_cascade.sql'), 'utf-8')
        expect(createIndexStatements(delta).sort()).toEqual(createIndexStatements(checkedIn0004).sort())
        // Belt and braces on the empty case: an accidentally-emptied 0004
        // would satisfy the equality above against an empty delta.
        expect(createIndexStatements(checkedIn0004).length).toBeGreaterThan(0)

        const checkedIn0005 = readFileSync(join(migrationsDir, '0005_branding.sql'), 'utf-8')
        expect(createTableStatements(delta).sort()).toEqual(createTableStatements(checkedIn0005).sort())
        expect(createTableStatements(checkedIn0005).length).toBeGreaterThan(0)
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
// search_fts excluded (G6 / P1-06) — under the names **0001 itself** creates.
// 0001 is history and is never edited, so the three catalogue tables stay
// spelled the old way here even though 0006 has since renamed them;
// `EXPECTED_TABLES` below carries the names a fully migrated database has.
// Doubling as the completeness check: a table added in schema.ts without a
// matching entry here (or vice versa) fails the "no more, no fewer" assertion
// below rather than passing silently.
const MIGRATION_0001_TABLES = [
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

/**
 * The same §5 tables under the names they carry once **every** checked-in
 * migration has run — what `withMigratedDb` opens. Derived from
 * `MIGRATION_0001_TABLES` by the renames the migrations themselves perform,
 * rather than restated: a rename spelled one way in a migration and another
 * way here would otherwise read as a passing test naming a table that does
 * not exist.
 *
 * `branding` (0005) is deliberately absent: this list drives the
 * UUID-primary-key assertion below, and branding sits in ADR-002's
 * natural-identity exemption class (ADR-012) alongside `settings` and
 * `favicons`. The search relations 0002/0003 add are absent for the reason
 * ADR-009 gives — `search_source` is not a table of records at all.
 */
const EXPECTED_TABLES = MIGRATION_0001_TABLES.map(
  (table) => applyRenames(table, renamesInMigrations(MIGRATIONS)) // a whole-name substitution: these are bare identifiers, not compound FK names
)

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
  it('creates every §5 table named in MIGRATION_0001_TABLES, no more and no fewer, and no search_fts', () => {
    withMigration0001OnlyDb((db) => {
      const actual = domainTableNames(db).sort()
      expect(actual).toEqual([...MIGRATION_0001_TABLES].sort())
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
