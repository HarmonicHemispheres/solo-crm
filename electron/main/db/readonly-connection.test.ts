import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SyncFolderGuardError } from './sync-folder-guard'

// `./connection` imports `app` from 'electron' at its own top level (for the
// no-override `resolveDatabasePath` path, unused here since every test passes
// an explicit `userDataDir`). Mocking the module keeps this file an ordinary
// vitest/Node test — the same technique, and the same reasoning, as
// `ipc/registry.test.ts`. `getPath` throws rather than returning a directory:
// a test that forgot its override must fail loudly, not quietly write into a
// real user-data folder.
vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.1.0-test',
    getPath: () => {
      throw new Error('app.getPath should not be called — every test here overrides userDataDir')
    }
  }
}))

const { closeDatabase, getDatabase, openDatabase } = await import('./connection')
const {
  closeReadOnlyDatabase,
  getReadOnlyDatabase,
  openReadOnlyDatabase,
  runReadOnlyQuery
} = await import('./readonly-connection')

const here = dirname(fileURLToPath(import.meta.url))
const READONLY_CONNECTION_SOURCE = readFileSync(join(here, 'readonly-connection.ts'), 'utf8')
const REGISTRY_SOURCE = readFileSync(join(here, '..', 'ipc', 'registry.ts'), 'utf8')

const tmpDirs: string[] = []

/**
 * Opens the write connection (migrations and all) against a throwaway
 * directory and seeds enough rows for a real four-table join, then returns
 * the directory so the read-only connection can be pointed at the same
 * file. The read-only connection is `fileMustExist: true`, so this has to
 * happen first — which is exactly the production ordering too.
 */
function seedDatabase(): string {
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-readonly-'))
  tmpDirs.push(dir)
  const db = openDatabase({ userDataDir: dir })
  const now = '2026-08-28T12:00:00.000Z'
  db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('c1', 'Acme', now, now)
  db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run('p1', 'Ada', now, now)
  db.prepare(
    'INSERT INTO affiliations (id, person_id, company_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('a1', 'p1', 'c1', 'Principal', now, now)
  db.prepare(
    'INSERT INTO engagements (id, name, client_company_id, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('e1', 'Retainer', 'c1', '2026-01-01', now, now)
  db.prepare(
    'INSERT INTO milestones (id, engagement_id, name, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('m1', 'e1', 'Kickoff', 250_000, now, now)
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run('theme', '"dark"', now)
  return dir
}

afterEach(() => {
  closeReadOnlyDatabase()
  closeDatabase()
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Mechanism (1): the connection itself.
// ---------------------------------------------------------------------------

describe('the second connection is genuinely read-only', () => {
  it('opens readonly against the same file as the write connection, and is a different handle', () => {
    const dir = seedDatabase()
    const readOnly = openReadOnlyDatabase({ userDataDir: dir })

    expect(readOnly.readonly).toBe(true)
    expect(readOnly.name).toBe(getDatabase().name)
    // The whole point: two handles, not one. An implementation that quietly
    // returned the write connection would satisfy every query test below.
    expect(readOnly).not.toBe(getDatabase())
    expect(getDatabase().readonly).toBe(false)
  })

  it('refuses a write at step time even when every check above it is bypassed', () => {
    // This task's Risks note: "verify the connection genuinely refuses writes
    // rather than assuming the flag did it." So this goes around
    // `runReadOnlyQuery` entirely and drives the raw handle — if the
    // statement-level checks were deleted tomorrow, SQLite would still be
    // holding the line, and this test is what proves it.
    const dir = seedDatabase()
    const readOnly = openReadOnlyDatabase({ userDataDir: dir })

    expect(() => readOnly.prepare('DELETE FROM companies').run()).toThrow(/readonly/i)
    expect(getDatabase().prepare('SELECT count(*) AS n FROM companies').get()).toEqual({ n: 1 })
  })

  it('refuses to create the database file it is pointed at', () => {
    const empty = mkdtempSync(join(tmpdir(), 'solo-crm-readonly-missing-'))
    tmpDirs.push(empty)
    // `fileMustExist: true`. A read-only connection that could bring
    // `solocrm.db` into existence would be a second, unguarded way to open
    // the database — the AGENTS.md sync-folder gotcha's exact failure mode.
    expect(() => openReadOnlyDatabase({ userDataDir: empty })).toThrow()
  })

  it('reopens lazily after close, and refuses a second simultaneous open', () => {
    const dir = seedDatabase()
    const first = getReadOnlyDatabase({ userDataDir: dir })
    expect(getReadOnlyDatabase({ userDataDir: dir })).toBe(first)
    expect(() => openReadOnlyDatabase({ userDataDir: dir })).toThrow(/already open/)

    closeReadOnlyDatabase()
    const second = getReadOnlyDatabase({ userDataDir: dir })
    expect(second).not.toBe(first)
    expect(second.readonly).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The write connection is out of reach — asserted, not argued (Acceptance).
// ---------------------------------------------------------------------------

/**
 * Strips comments so a structural check reads the *code*, not the prose
 * about it — this module's own header discusses `getDatabase()` at length,
 * and a substring search over the raw file would match that and prove
 * nothing. No string literal in either file contains `//` or `/*`, so this
 * is safe for the two files it is used on.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

describe('the write connection is not reachable from the query channel', () => {
  it('readonly-connection.ts imports nothing from ./connection but the pure path function', () => {
    const imports = [...READONLY_CONNECTION_SOURCE.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/connection'/g)].map(
      (match) => match[1].split(',').map((name) => name.trim()).filter(Boolean)
    )
    // Exactly one import statement, naming exactly one binding.
    // `resolveDatabasePath` opens nothing; it joins a filename onto a
    // resolved data root. Widening this list is how the write handle would
    // get in, so widening it has to fail here first.
    expect(imports).toEqual([['resolveDatabasePath']])
  })

  it('readonly-connection.ts never names the write handle in code', () => {
    expect(stripComments(READONLY_CONNECTION_SOURCE)).not.toMatch(/\bgetDatabase\b/)
    expect(stripComments(READONLY_CONNECTION_SOURCE)).not.toMatch(/\bopenDatabase\b/)
  })

  it("registry.ts's db:query handler never calls getDatabase(), unlike every other handler in the file", () => {
    const start = REGISTRY_SOURCE.indexOf("'db:query': defineChannel({")
    expect(start).toBeGreaterThan(-1)
    const end = REGISTRY_SOURCE.indexOf('\n  }),', start)
    expect(end).toBeGreaterThan(start)
    const handlerBlock = stripComments(REGISTRY_SOURCE.slice(start, end))

    expect(handlerBlock).not.toMatch(/\bgetDatabase\b/)
    // Control: the assertion above would pass on an empty string, so prove
    // the slice really is the handler, and prove the same search does find
    // `getDatabase` in a neighbouring channel.
    expect(handlerBlock).toContain('runReadOnlyQuery')
    expect(stripComments(REGISTRY_SOURCE)).toMatch(/\bgetDatabase\b/)
  })
})

// ---------------------------------------------------------------------------
// Refusals — one assertion per statement the Acceptance names.
// ---------------------------------------------------------------------------

describe('refusals are explicit and name why', () => {
  it('refuses DELETE FROM companies, naming that it modifies the database', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('DELETE FROM companies', undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('writes-data')
    expect(outcome.error.message).toMatch(/modifies the database/)
    // Not accepted-and-no-opped (§6.12): the row is still there.
    expect(getDatabase().prepare('SELECT count(*) AS n FROM companies').get()).toEqual({ n: 1 })
  })

  it('refuses UPDATE settings SET value = …, naming that it modifies the database', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery("UPDATE settings SET value = '\"light\"' WHERE key = 'theme'", undefined, {
      userDataDir: dir
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('writes-data')
    expect(outcome.error.message).toMatch(/modifies the database/)
    expect(getDatabase().prepare("SELECT value AS v FROM settings WHERE key = 'theme'").get()).toEqual({ v: '"dark"' })
  })

  it('refuses PRAGMA writable_schema = 1, which SQLite itself reports as read-only', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('PRAGMA writable_schema = 1', undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    // The mechanism matters as much as the refusal: `stmt.readonly` is TRUE
    // for this statement (X-02's whole point — a `^SELECT` check and a
    // readonly check both wave it through), so the code below has to be the
    // result-set one, not `writes-data`.
    expect(outcome.error.code).toBe('no-result-set')
    expect(outcome.error.message).toMatch(/PRAGMA writable_schema/)
    // And it did not take effect on the connection either.
    expect(getReadOnlyDatabase({ userDataDir: dir }).pragma('writable_schema', { simple: true })).toBe(0)
  })

  it("refuses ATTACH DATABASE ':memory:' AS x, which SQLite also reports as read-only", () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery("ATTACH DATABASE ':memory:' AS x", undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('no-result-set')
    expect(outcome.error.message).toMatch(/ATTACH/)
    // Nothing was attached: `x` does not resolve.
    const after = runReadOnlyQuery('SELECT * FROM x.sqlite_master', undefined, { userDataDir: dir })
    expect(after.ok).toBe(false)
  })

  it('refuses a write smuggled in behind a harmless first statement', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('SELECT 1 AS ok; DELETE FROM companies', undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('invalid-statement')
    expect(outcome.error.message).toMatch(/more than one statement/)
    expect(getDatabase().prepare('SELECT count(*) AS n FROM companies').get()).toEqual({ n: 1 })
  })

  it('refuses VACUUM and ANALYZE — X-05 maintenance, not queries', () => {
    const dir = seedDatabase()
    for (const statement of ['VACUUM', 'ANALYZE']) {
      const outcome = runReadOnlyQuery(statement, undefined, { userDataDir: dir })
      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error('unreachable')
      expect(outcome.error.code).toBe('writes-data')
    }
  })

  it('refuses a blank statement rather than running nothing and reporting success', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('   \n\t ', undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('empty-statement')
  })

  it('refuses a statement whose bound parameters do not match', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('SELECT name FROM companies WHERE id = ?', ['c1', 'c2'], { userDataDir: dir })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('bad-parameters')
  })

  it('carries no filesystem path and no stack trace in any refusal', () => {
    const dir = seedDatabase()
    const statements = [
      'DELETE FROM companies',
      'PRAGMA writable_schema = 1',
      "ATTACH DATABASE ':memory:' AS x",
      'SELECT * FROM no_such_table',
      'SELECT FROM'
    ]

    for (const statement of statements) {
      const outcome = runReadOnlyQuery(statement, undefined, { userDataDir: dir })
      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error('unreachable')
      // T-260828-09's boundary.
      expect(outcome.error.message).not.toContain(dir)
      expect(outcome.error.message).not.toContain('solocrm.db')
      expect(outcome.error.message).not.toMatch(/\bat\s+\S+\s+\(.*:\d+:\d+\)/)
      expect(outcome.error.message).not.toMatch(/\.ts:\d+/)
    }
  })
})

// ---------------------------------------------------------------------------
// The queries that are supposed to work.
// ---------------------------------------------------------------------------

describe('legitimate reads', () => {
  it('runs a four-table join and returns rows, columns and a duration', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery(
      `SELECT c.name, p.name, e.name, m.amount_cents
         FROM companies c
         JOIN affiliations a ON a.company_id = c.id
         JOIN people p ON p.id = a.person_id
         JOIN engagements e ON e.client_company_id = c.id
         JOIN milestones m ON m.engagement_id = e.id
        ORDER BY c.name`,
      undefined,
      { userDataDir: dir }
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.data.rows).toEqual([['Acme', 'Ada', 'Retainer', 250_000]])
    expect(outcome.data.rowCount).toBe(1)
    expect(outcome.data.truncated).toBe(false)
    expect(outcome.data.durationMs).toBeGreaterThanOrEqual(0)
    // Positional rows, not objects: the join names `name` three times and
    // all three survive. An object row would have kept one.
    expect(outcome.data.columns).toHaveLength(4)
  })

  it('binds positional and named parameters', () => {
    const dir = seedDatabase()
    const positional = runReadOnlyQuery('SELECT name FROM companies WHERE id = ?', ['c1'], { userDataDir: dir })
    expect(positional.ok).toBe(true)
    if (!positional.ok) throw new Error(positional.error.message)
    expect(positional.data.rows).toEqual([['Acme']])

    const named = runReadOnlyQuery('SELECT name FROM companies WHERE id = :id', { id: 'c1' }, { userDataDir: dir })
    expect(named.ok).toBe(true)
    if (!named.ok) throw new Error(named.error.message)
    expect(named.data.rows).toEqual([['Acme']])
  })

  it('allows a read-only pragma that actually returns rows', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery('PRAGMA table_info(companies)', undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.data.rowCount).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// The cap and the timeout — nothing freezes, nothing truncates silently.
// ---------------------------------------------------------------------------

/** Streams `count` rows without touching a table — a stand-in for the cartesian join this is here to survive. */
function rowGenerator(count: number): string {
  return `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < ${count}) SELECT x FROM n`
}

describe('the row cap and the statement timeout', () => {
  it('truncates at the row cap and says so', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery(rowGenerator(10_000), undefined, { userDataDir: dir, rowLimit: 5 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.data.rowCount).toBe(5)
    expect(outcome.data.rows).toHaveLength(5)
    // Stated, not silent (Acceptance).
    expect(outcome.data.truncated).toBe(true)
    expect(outcome.data.rowLimit).toBe(5)
  })

  it('does not report truncation when the result fits', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery(rowGenerator(5), undefined, { userDataDir: dir, rowLimit: 5 })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.data.rowCount).toBe(5)
    expect(outcome.data.truncated).toBe(false)
  })

  it('abandons a statement that outruns the timeout, with a stated reason', () => {
    const dir = seedDatabase()
    // 2,000,000 rows against a 1ms budget: the deadline is checked after
    // every row, so this stops within a few milliseconds rather than
    // materialising two million rows. The row cap is set far above the
    // generator's output so it is unambiguously the timeout that fires.
    const outcome = runReadOnlyQuery(rowGenerator(2_000_000), undefined, {
      userDataDir: dir,
      timeoutMs: 1,
      rowLimit: 5_000_000
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) throw new Error('unreachable')
    expect(outcome.error.code).toBe('timeout')
    expect(outcome.error.message).toMatch(/1ms/)

    // And the process is still usable afterwards — the abandoned statement
    // released its iterator rather than leaving a read transaction open.
    const after = runReadOnlyQuery('SELECT name FROM companies', undefined, { userDataDir: dir })
    expect(after.ok).toBe(true)
  })

  it('leaves a fast query well inside the default budget alone', () => {
    const dir = seedDatabase()
    const outcome = runReadOnlyQuery(rowGenerator(100), undefined, { userDataDir: dir })

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) throw new Error(outcome.error.message)
    expect(outcome.data.rowCount).toBe(100)
  })
})

describe('the sync-folder guard covers this connection too (T-260828-39 review)', () => {
  // AGENTS.md: the database must never live in a Drive, Dropbox or iCloud
  // folder, and no path may reach the better-sqlite3 constructor without
  // passing the guard. `openDatabase()` runs it; `resolveDatabasePath()`
  // does not — it only joins a filename onto the resolved data root — so a
  // second opener calling the path helper alone would be an unchecked way in.
  //
  // In production the write connection opens at boot and would already have
  // refused such a path, so this is belt to that braces. But that is an
  // ordering invariant, not a guarantee: anything opening this connection
  // earlier would have bypassed the guard silently. This asserts the
  // guarantee instead of the ordering.
  it('refuses to open a read-only connection inside a sync folder', () => {
    const parent = mkdtempSync(join(tmpdir(), 'solo-crm-readonly-sync-'))
    tmpDirs.push(parent)
    const syncedUserDataDir = join(parent, 'Dropbox', 'userData')

    let thrown: unknown
    try {
      openReadOnlyDatabase({ userDataDir: syncedUserDataDir })
    } catch (error) {
      thrown = error
    }

    // Not merely "it threw": `fileMustExist: true` would also throw here, for
    // an entirely different and much weaker reason. The guard is what must
    // have refused it, and it must have refused before better-sqlite3 got a
    // chance to create anything.
    expect(thrown).toBeInstanceOf(SyncFolderGuardError)
    expect((thrown as SyncFolderGuardError).message).toContain('Dropbox')
  })
})
