import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { timestampSchema } from '../../../shared/types'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { listCompanies } from '../repositories/companies'
import { listPeople } from '../repositories/people'
import { listEngagements } from '../repositories/engagements'
import { listTasks } from '../repositories/tasks'
import { listActivity } from '../repositories/activity'
import { companySchema } from '../../../shared/companies'
import { personSchema } from '../../../shared/people'
import { engagementSchema } from '../../../shared/engagements'
import { taskSchema } from '../../../shared/tasks'
import { activitySchema } from '../../../shared/activity'
import type { CompanySeed } from './fixture'
import { MOCKUP_TODAY, companies as companiesFixture } from './fixture'
import { FixtureIntegrityError, SeedGuardError, orderCompaniesForInsert, seedFixture } from './index'

/**
 * Covers T-260828-13's acceptance criteria directly against `seedFixture`,
 * through `openDatabase`/`getDatabase` the same as every other db test —
 * `connection.test.ts`'s "single owner of the SQLite connection" test walks
 * every `.ts` file under `electron/` for a direct better-sqlite3 constructor
 * call (a different spelling here on purpose, so this sentence does not
 * itself trip that check), this file included. `cli.ts` (the real
 * `npm run seed` entry point) is not
 * exercised here: it exists only to get a genuine `app.getPath('userData')`
 * inside a real, booted Electron process, which is exactly what
 * `connection.test.ts`'s own default-path test already proves works for
 * `openDatabase()`; this file's job is the fixture's *content*.
 */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

afterEach(() => {
  closeDatabase()
})

function withFreshDb<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir('solo-crm-seed-')
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

function count(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c
}

describe('seedFixture: row counts', () => {
  it('matches the mockup exactly: 10 companies, 7 people, 11 engagements, 11 tasks, 10 activity rows, 5 categories, 9 offerings', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(count(db, 'companies')).toBe(10)
      expect(count(db, 'people')).toBe(7)
      expect(count(db, 'engagements')).toBe(11)
      expect(count(db, 'tasks')).toBe(11)
      expect(count(db, 'activity')).toBe(10)
      expect(count(db, 'offering_categories')).toBe(5)
      expect(count(db, 'offerings')).toBe(9)
    })
  })

  it('also seeds the affiliations (one per person with a company) and the 22 links attached across all 10 companies', () => {
    withFreshDb((db) => {
      seedFixture(db)
      // don, dave, ben — the only three people with a `co` in the mockup.
      expect(count(db, 'affiliations')).toBe(3)
      // Exact per Scope's link counts by company: rinvii 4, sandsage 4,
      // ezdeploy 3, wk 3, programetrix 1, radial 2, naslund 2, theroute 1,
      // northbank 1, thompson 1 = 22, spread across all 10 companies.
      expect(count(db, 'links')).toBe(22)
      const distinctCompaniesWithLinks = db
        .prepare('SELECT COUNT(DISTINCT entity_id) AS c FROM links WHERE entity_type = ?')
        .get('company') as { c: number }
      expect(distinctCompaniesWithLinks.c).toBe(10)
    })
  })
})

describe('seedFixture: the mapping the task exists to prove', () => {
  it('W+K and Programetrix are bills_directly=false, billed via EZDeploy', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const ezdeploy = db.prepare('SELECT id FROM companies WHERE name = ?').get('EZDeploy') as { id: string }
      for (const name of ['W+K', 'Programetrix']) {
        const row = db
          .prepare('SELECT bills_directly, billed_via_company_id FROM companies WHERE name = ?')
          .get(name) as { bills_directly: number; billed_via_company_id: string | null }
        expect(row.bills_directly).toBe(0)
        expect(row.billed_via_company_id).toBe(ezdeploy.id)
      }
    })
  })

  it('the Samay engagement bills EZDeploy for work delivered to W+K', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const row = db
        .prepare(
          `SELECT bc.name AS billing, cc.name AS client
           FROM engagements e
           JOIN companies bc ON bc.id = e.billing_company_id
           JOIN companies cc ON cc.id = e.client_company_id
           WHERE e.name LIKE 'Samay%'`
        )
        .get() as { billing: string; client: string }
      expect(row).toEqual({ billing: 'EZDeploy', client: 'W+K' })
    })
  })

  it("Sand & Sage's equity engagement carries billing_model='equity' and no rate of any kind", () => {
    withFreshDb((db) => {
      seedFixture(db)
      const row = db
        .prepare(
          `SELECT billing_model, agreed_rate_cents, contract_value_cents, hourly_rate_cents, hours_included
           FROM engagements WHERE name = 'SiteFacts equity position'`
        )
        .get() as {
        billing_model: string
        agreed_rate_cents: number | null
        contract_value_cents: number | null
        hourly_rate_cents: number | null
        hours_included: number | null
      }
      expect(row.billing_model).toBe('equity')
      expect(row.agreed_rate_cents).toBeNull()
      expect(row.contract_value_cents).toBeNull()
      expect(row.hourly_rate_cents).toBeNull()
      expect(row.hours_included).toBeNull()
    })
  })

  it('every enum column is lowercase — no Title Case survives the port (company kind, engagement status/model, activity kind, task status)', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const isLower = (value: string) => value === value.toLowerCase()
      for (const row of db.prepare('SELECT kind FROM companies').all() as { kind: string }[]) {
        expect(isLower(row.kind)).toBe(true)
      }
      for (const row of db.prepare('SELECT status, billing_model FROM engagements').all() as {
        status: string
        billing_model: string
      }[]) {
        expect(isLower(row.status)).toBe(true)
        expect(isLower(row.billing_model)).toBe(true)
      }
      for (const row of db.prepare('SELECT kind FROM activity').all() as { kind: string }[]) {
        expect(isLower(row.kind)).toBe(true)
      }
      for (const row of db.prepare('SELECT status FROM tasks').all() as { status: string }[]) {
        expect(isLower(row.status)).toBe(true)
      }
    })
  })
})

describe('seedFixture: offerings versions', () => {
  it('carries at least two offerings with exactly two non-overlapping offering_versions each', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const twoVersionOfferings = db
        .prepare(
          `SELECT offering_id FROM offering_versions GROUP BY offering_id HAVING COUNT(*) = 2`
        )
        .all() as { offering_id: string }[]
      expect(twoVersionOfferings.length).toBeGreaterThanOrEqual(2)

      for (const { offering_id: offeringId } of twoVersionOfferings) {
        const versions = db
          .prepare(
            `SELECT version, effective_from, effective_to FROM offering_versions WHERE offering_id = ? ORDER BY version`
          )
          .all(offeringId) as { version: number; effective_from: string; effective_to: string | null }[]
        expect(versions).toHaveLength(2)
        const [first, second] = versions
        // Non-overlapping: the earlier version's range ends strictly before
        // the later version's range begins (or is open-ended, which none of
        // the first-of-two ever are in this fixture).
        expect(first.effective_to).not.toBeNull()
        expect(first.effective_to! < second.effective_from).toBe(true)
      }
    })
  })
})

describe("seedFixture: this fixture's last_touch_at values do not disagree with its own activity rows", () => {
  // Not a standing app invariant — ADR-001 rule 6 is explicit that
  // companies.last_touch_at and activity answer different questions
  // (cadence vs. what happened) and are ALLOWED to differ; the real Gmail
  // adapter writes last_touch_at with no activity row at all. What this
  // test proves is narrower and specific to how THIS fixture happens to be
  // built: index.ts computes last_touch_at from the fixture's own activity
  // rows (see its header comment), so for this particular seed, the two
  // never disagree by construction. A future fixture row seeded with a
  // last_touch_at that has no matching activity (a simulated Gmail touch)
  // would correctly fail this test and would need its own, separate one.
  it("every company's last_touch_at equals MAX(activity.occurred_at) for that company, in this seed", () => {
    withFreshDb((db) => {
      seedFixture(db)
      const companies = db.prepare('SELECT id, last_touch_at FROM companies').all() as {
        id: string
        last_touch_at: string | null
      }[]
      for (const company of companies) {
        const maxRow = db
          .prepare('SELECT MAX(occurred_at) AS max_occurred_at FROM activity WHERE company_id = ?')
          .get(company.id) as { max_occurred_at: string | null }
        expect(company.last_touch_at).toBe(maxRow.max_occurred_at)
        // In this fixture every company has exactly one activity row, so the
        // computed value is never null.
        expect(company.last_touch_at).not.toBeNull()
      }
    })
  })
})

describe('seedFixture: timestamps are written via the shared helpers, never a SQL default', () => {
  it('every created_at/updated_at is a valid CONVENTIONS.md timestamp, not a SQLite CURRENT_TIMESTAMP-shaped string', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const rows = db.prepare('SELECT created_at, updated_at FROM companies').all() as {
        created_at: string
        updated_at: string
      }[]
      for (const row of rows) {
        expect(() => timestampSchema.parse(row.created_at)).not.toThrow()
        expect(() => timestampSchema.parse(row.updated_at)).not.toThrow()
        expect(row.created_at).toBe(row.updated_at)
      }
    })
  })

  it('activity.occurred_at and companies.last_touch_at are valid timestamps too, not bare dates', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const activityRows = db.prepare('SELECT occurred_at FROM activity').all() as { occurred_at: string }[]
      expect(activityRows.length).toBeGreaterThan(0)
      for (const row of activityRows) {
        expect(() => timestampSchema.parse(row.occurred_at)).not.toThrow()
      }

      // `companies.last_touch_at` is named in this test's title and was not
      // actually queried — the assertion existed only in the name. Added
      // alongside the `waiting_since` fix (T-260828-15's real-window pass),
      // because a test that reads as covering a column while checking a
      // different one is worse than no test: it answers the question wrong
      // when someone greps for it. `people.last_contact_at` is the same
      // column by ADR-001 and gets the same check.
      const touched = db
        .prepare('SELECT last_touch_at FROM companies WHERE last_touch_at IS NOT NULL')
        .all() as { last_touch_at: string }[]
      expect(touched.length).toBeGreaterThan(0)
      for (const row of touched) {
        expect(() => timestampSchema.parse(row.last_touch_at)).not.toThrow()
      }

      const contacted = db
        .prepare('SELECT last_contact_at FROM people WHERE last_contact_at IS NOT NULL')
        .all() as { last_contact_at: string }[]
      expect(contacted.length).toBeGreaterThan(0)
      for (const row of contacted) {
        expect(() => timestampSchema.parse(row.last_contact_at)).not.toThrow()
      }
    })
  })
})

describe('seedFixture: the date-basis decision (offset from today, not absolute)', () => {
  it('shifts every mockup-relative date by the same number of days between MOCKUP_TODAY and the reference "now"', () => {
    withFreshDb((db) => {
      // 5 days after the mockup's own frozen TODAY.
      const referenceNow = new Date(`${MOCKUP_TODAY}T12:00:00.000Z`)
      referenceNow.setUTCDate(referenceNow.getUTCDate() + 5)

      seedFixture(db, { referenceNow })

      // Rinvii's `since` in the fixture is mockup-relative '2026-03-01' —
      // shifted +5 days it must land on '2026-03-06'.
      const rinvii = db.prepare("SELECT since FROM companies WHERE name = 'Rinvii'").get() as { since: string }
      expect(rinvii.since).toBe('2026-03-06')

      // The Rinvii activity row (a1) is mockup-relative '2026-08-26' —
      // shifted +5 days it must land on 2026-08-31, on the same calendar
      // day company.last_touch_at is derived from.
      const activityDate = (
        db.prepare("SELECT occurred_at FROM activity WHERE title = 'Weekly sync'").get() as {
          occurred_at: string
        }
      ).occurred_at
      expect(activityDate.startsWith('2026-08-31')).toBe(true)
    })
  })

  it('a NULL date (e.g. a rolling engagement\'s ends_on) is never shifted into a fabricated value', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const row = db
        .prepare("SELECT ends_on FROM engagements WHERE name LIKE 'Advisory + development%'")
        .get() as { ends_on: string | null }
      expect(row.ends_on).toBeNull()
    })
  })
})

describe('seedFixture: computeOffsetDays reads the operator\'s local calendar day, not UTC', () => {
  const originalTz = process.env.TZ

  afterEach(() => {
    if (originalTz === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTz
    }
  })

  it('does not roll the seed a day ahead for a timezone behind UTC in the evening', () => {
    process.env.TZ = 'Pacific/Niue' // UTC-11, no DST — same zone shared-conventions.test.ts uses.
    withFreshDb((db) => {
      // 2026-09-01T05:00:00Z is already 2026-09-01 in UTC, but still
      // 2026-08-31 in Niue (05:00 minus 11h lands on the previous day's
      // 18:00) — exactly the evening-rollover case a UTC read of "today"
      // gets wrong by one day.
      const referenceNow = new Date('2026-09-01T05:00:00.000Z')
      seedFixture(db, { referenceNow })

      // Niue's local calendar day is 2026-08-31 — 4 days after
      // MOCKUP_TODAY (2026-08-27) — so Rinvii's since ('2026-03-01') must
      // land on 2026-03-05. A UTC-based read of "today" (2026-09-01, 5
      // days out) would have produced 2026-03-06 instead.
      const rinvii = db.prepare("SELECT since FROM companies WHERE name = 'Rinvii'").get() as { since: string }
      expect(rinvii.since).toBe('2026-03-05')
    })
  })
})

describe('orderCompaniesForInsert', () => {
  it("does not change the real fixture's order (already dependency-respecting)", () => {
    const ordered = orderCompaniesForInsert(companiesFixture)
    expect(ordered.map((c) => c.key)).toEqual(companiesFixture.map((c) => c.key))
  })

  it('reorders a billing parent ahead of its dependents even when the input lists them first', () => {
    // The real hazard the review flagged: EZDeploy happens to precede W+K
    // and Programetrix in fixture.ts today, and insertion order used to
    // depend on that silently. Feeding this a reversed copy proves the
    // function itself is what makes order correct now, not the array.
    const reversed = [...companiesFixture].reverse()
    const ordered = orderCompaniesForInsert(reversed)
    const indexOf = (key: string) => ordered.findIndex((c) => c.key === key)
    expect(indexOf('ezdeploy')).toBeLessThan(indexOf('wk'))
    expect(indexOf('ezdeploy')).toBeLessThan(indexOf('programetrix'))
    expect(ordered).toHaveLength(companiesFixture.length)
  })

  it('throws FixtureIntegrityError on a billed-via cycle instead of leaving it to a raw FK failure at INSERT time', () => {
    const a: CompanySeed = { ...companiesFixture[0], key: 'cycle-a', billedViaCompanyKey: 'cycle-b' }
    const b: CompanySeed = { ...companiesFixture[0], key: 'cycle-b', billedViaCompanyKey: 'cycle-a' }
    expect(() => orderCompaniesForInsert([a, b])).toThrow(FixtureIntegrityError)
  })

  it('throws FixtureIntegrityError when billedViaCompanyKey names a key that does not exist', () => {
    const dangling: CompanySeed = { ...companiesFixture[0], key: 'dangling', billedViaCompanyKey: 'no-such-company' }
    expect(() => orderCompaniesForInsert([dangling])).toThrow(FixtureIntegrityError)
  })
})

describe('seedFixture: the non-empty-database guard', () => {
  it('refuses to seed a database that already has rows, without deleting anything', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(() => seedFixture(db)).toThrow(SeedGuardError)
      // Refusal must not have touched what was already there.
      expect(count(db, 'companies')).toBe(10)
    })
  })

  it('the refusal message states the actual consequence of --force, not just the flag', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(() => seedFixture(db)).toThrow(/another copy of the fixture alongside/)
    })
  })

  it('force bypasses the guard but still never deletes — it adds a second full copy of the fixture', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(() => seedFixture(db, { force: true })).not.toThrow()
      // Doubles every table's count — the guard message's claim, verified.
      expect(count(db, 'companies')).toBe(20)
      expect(count(db, 'links')).toBe(44)
    })
  })

  it('a database with rows in only one seeded table is still refused', () => {
    withFreshDb((db) => {
      db.prepare(
        `INSERT INTO offering_categories (id, name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('preexisting', 'Preexisting', '#000000', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
      expect(() => seedFixture(db)).toThrow(SeedGuardError)
    })
  })

  it('an empty database seeds without needing --force', () => {
    withFreshDb((db) => {
      expect(() => seedFixture(db)).not.toThrow()
    })
  })
})

/**
 * The guard that would have caught the `waiting_since` defect, and the one
 * that catches the next one of its kind without anybody remembering to add
 * a column to a list.
 *
 * The block above this one checks named timestamp columns one at a time,
 * and that is exactly how the bug got through: `waiting_since` was written
 * with `shiftDateOnlyOrNull` (bare `YYYY-MM-DD`) while
 * `tasks.waitingSince` is declared `timestampSchema.nullable()`, and no
 * assertion named that column. Every `tasks:list` against a seeded database
 * failed its response schema, so Today, Todos and every other task-listing
 * view rendered "the response was not in the expected shape" — a completely
 * broken `npm run seed` with a green suite. It was found by driving the
 * built app against a seeded profile (T-260828-15's real-window pass), which
 * is far too late and far too manual for a wrong string in a column.
 *
 * So this reads every seeded row back through the repository the app
 * actually calls, and parses it with the same wire schema the IPC layer
 * validates responses against. It is exhaustive by construction: a field
 * added to any of these five schemas, or a column whose written format
 * stops matching its declared one, fails here without this file changing.
 * That is the difference between a checklist and a contract.
 */
describe('seedFixture: every seeded row satisfies the wire schema the IPC layer validates against', () => {
  it('tasks — including waiting_since, the column that shipped as a bare date', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const tasks = listTasks(db)
      expect(tasks.length).toBeGreaterThan(0)
      for (const task of tasks) expect(() => taskSchema.parse(task)).not.toThrow()

      // Named explicitly as well as covered by the parse above, because this
      // is the specific regression: at least one seeded task must actually
      // be `waiting` with a stamped `waiting_since`, or the parse proves
      // nothing about the column that broke.
      const waiting = tasks.filter((task) => task.status === 'waiting')
      expect(waiting.length).toBeGreaterThan(0)
      for (const task of waiting) {
        expect(task.waitingSince).not.toBeNull()
        expect(() => timestampSchema.parse(task.waitingSince)).not.toThrow()
      }
    })
  })

  it('companies, people, engagements and activity', () => {
    withFreshDb((db) => {
      seedFixture(db)

      const companies = listCompanies(db)
      const people = listPeople(db)
      const engagements = listEngagements(db)
      const activity = listActivity(db)

      // Each list must be non-empty or its loop below asserts nothing — the
      // vacuous-pass failure mode this project has hit before.
      expect(companies.length).toBeGreaterThan(0)
      expect(people.length).toBeGreaterThan(0)
      expect(engagements.length).toBeGreaterThan(0)
      expect(activity.length).toBeGreaterThan(0)

      for (const row of companies) expect(() => companySchema.parse(row)).not.toThrow()
      for (const row of people) expect(() => personSchema.parse(row)).not.toThrow()
      for (const row of engagements) expect(() => engagementSchema.parse(row)).not.toThrow()
      for (const row of activity) expect(() => activitySchema.parse(row)).not.toThrow()
    })
  })
})
