import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { searchAll } from './search'

/**
 * The §8 latency budget for search, as a check rather than a claim
 * (T-260828-51). `search.test.ts` owns correctness; this file owns the one
 * number the requirements name.
 *
 * §8 asks for under 100 ms at 10x the requirements' own reference volume,
 * and T-260828-37's palette asks for a result "within one frame of a
 * keystroke". T-260828-36's review found the original shape — an
 * external-content FTS5 table over a *view* whose `content_rowid` was a
 * computed expression — missing that budget by 5-6x, because no index can
 * serve a computed expression and FTS5 therefore rescanned all five source
 * tables for every row it returned. `0003_search_content_table.sql`
 * materialises that view as a real table with an `INTEGER PRIMARY KEY`
 * content rowid; ADR-009 records the decision.
 *
 * Two assertions, for two different failure modes:
 *
 * - The **plan** assertion is structural and cannot flake. It checks the
 *   exact lookup FTS5 issues once per returned row, and it is what would
 *   catch a future change quietly putting a view, a join or an expression
 *   back in front of `search_source`.
 * - The **latency** assertion is the budget itself. It is the median of
 *   several runs rather than a single timing, and it is measured against a
 *   budget it currently clears by roughly 8x (see the numbers below), so a
 *   machine loaded enough to fail it is a machine on which the rest of the
 *   suite is already failing.
 *
 * Measured on this fixture, median of 7 warm runs, 31,000 indexed rows,
 * `LIMIT 25` (an idle 8-core Windows machine):
 *
 * | Query        | view (0002) | table (0003) |
 * |--------------|-------------|--------------|
 * | `"acme"*`    | 7.7-8.1 ms  | 2.9 ms       |
 * | `"engage"*`  | 18.7-20.2 ms| 9.3-9.8 ms   |
 * | `"a"*`       | 33.8-37.3 ms| 12.4-14.1 ms |
 *
 * Those absolutes are lower than the 95/488/581 ms T-260828-36's review
 * recorded — a different harness on a different machine — so the ratio and
 * the plan, not the absolute baseline, are what carry over. The direction
 * and the margin against the budget are unambiguous either way.
 *
 * Said plainly, because it decides which assertion is load-bearing: on
 * *this* harness the old union-view shape would still have passed the 100 ms
 * budget (33.8-37.3 ms for `"a"*`). The latency assertion is the
 * requirement; the plan assertion is what actually catches a return to the
 * shape this task removed. Neither alone is enough, which is why both are
 * here.
 */

// 10x the requirements' reference volume, the figure §8's budget is stated
// against: ~31,000 indexed rows, spread evenly over the five indexed tables.
const ROWS_PER_TABLE = 6_200
const TOTAL_INDEXED_ROWS = ROWS_PER_TABLE * 5

/** §8's budget, in milliseconds, for one search at 10x volume. */
const LATENCY_BUDGET_MS = 100

/**
 * `"a"*` is not a pathological input: it is what the command palette issues
 * after the first keystroke of every search anyone ever types, and it was
 * the worst of the three in the original measurement.
 */
const BUDGETED_QUERIES = ['acme', 'engage', 'a'] as const

// Measured: the whole file, fixture build and all five cases, runs in under
// 1.5s on an idle machine. `beforeAll` builds the 31,000 rows once for every
// case in the file. The 60s budget is deliberately far above that — it is a
// hang guard, not a performance assertion, so a loaded machine cannot turn
// fixture setup into a failure. The assertions that matter are on query time
// and query plan, not on setup.
const FIXTURE_TIMEOUT_MS = 60_000

let tmpDir: string
let db: Database.Database

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-search-latency-'))
  openDatabase({ userDataDir: tmpDir })
  db = getDatabase()

  const now = '2026-08-29T00:00:00.000Z'
  const words = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Nimbus', 'Apex', 'Vertex', 'Orbit']
  const insertCompany = db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  const insertPerson = db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  const insertEngagement = db.prepare(
    'INSERT INTO engagements (id, name, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  )
  const insertTask = db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
  const insertActivity = db.prepare(
    'INSERT INTO activity (id, occurred_at, kind, title, body, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )

  db.transaction(() => {
    for (let i = 0; i < ROWS_PER_TABLE; i++) {
      const word = words[i % words.length]
      insertCompany.run(randomUUID(), `${word} Company ${i}`, now, now)
      insertPerson.run(randomUUID(), `${word} Person ${i}`, now, now)
      insertEngagement.run(randomUUID(), `${word} Engagement ${i}`, '2026-01-01', now, now)
      insertTask.run(randomUUID(), `${word} Task ${i} follow up`, now, now)
      insertActivity.run(
        randomUUID(),
        now,
        'note',
        'Note',
        `${word} activity note ${i} about an engagement`,
        'manual',
        now,
        now
      )
    }
  })()
}, FIXTURE_TIMEOUT_MS)

afterAll(() => {
  closeDatabase()
  rmSync(tmpDir, { recursive: true, force: true })
})

/** Median of `runs` timings of `fn`, in milliseconds, after three warm-ups. */
function medianMs(fn: () => void, runs = 7): number {
  for (let i = 0; i < 3; i++) fn()
  const timings: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint()
    fn()
    timings.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  timings.sort((a, b) => a - b)
  return timings[Math.floor(timings.length / 2)]
}

describe('search latency at 10x volume (§8)', () => {
  it('indexes the full 10x fixture', () => {
    const indexed = (db.prepare('SELECT COUNT(*) AS c FROM search_fts').get() as { c: number }).c
    expect(indexed).toBe(TOTAL_INDEXED_ROWS)
  })

  it("resolves a result's columns by rowid seek, not by scanning the five source tables", () => {
    // Exactly the lookup FTS5 performs once per row it returns. Under 0002's
    // union view this planned as five SCANs (companies, people, engagements,
    // tasks, activity) and there was no index that could have served it,
    // because `content_rowid` was a computed expression rather than a column.
    const plan = db
      .prepare('EXPLAIN QUERY PLAN SELECT content_rowid, kind, source_id, text FROM search_source WHERE content_rowid = ?')
      .all(8) as { detail: string }[]
    const details = plan.map((row) => row.detail)

    expect(details).toEqual(['SEARCH search_source USING INTEGER PRIMARY KEY (rowid=?)'])
    for (const table of ['companies', 'people', 'engagements', 'tasks', 'activity']) {
      expect(details.join(' | ')).not.toContain(`SCAN ${table}`)
    }
  })

  for (const query of BUDGETED_QUERIES) {
    it(`answers ${JSON.stringify(query)} within ${LATENCY_BUDGET_MS}ms at ${TOTAL_INDEXED_ROWS} indexed rows`, () => {
      // A real result set, not an empty one — a query that matched nothing
      // would clear any budget while proving nothing about the lookup path.
      expect(searchAll(db, { query }).length).toBeGreaterThan(0)

      const median = medianMs(() => {
        searchAll(db, { query })
      })
      expect(median).toBeLessThan(LATENCY_BUDGET_MS)
    })
  }
})
