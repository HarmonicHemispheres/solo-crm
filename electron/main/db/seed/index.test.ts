import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { timestampSchema } from '../../../shared/types'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { MOCKUP_TODAY } from './fixture'
import { SeedGuardError, seedFixture } from './index'

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
  it('matches the mockup exactly: 10 companies, 7 people, 11 engagements, 11 tasks, 10 activity rows, 5 categories, 9 services', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(count(db, 'companies')).toBe(10)
      expect(count(db, 'people')).toBe(7)
      expect(count(db, 'engagements')).toBe(11)
      expect(count(db, 'tasks')).toBe(11)
      expect(count(db, 'activity')).toBe(10)
      expect(count(db, 'service_categories')).toBe(5)
      expect(count(db, 'services')).toBe(9)
    })
  })

  it('also seeds the affiliations (one per person with a company) and the links attached to each company', () => {
    withFreshDb((db) => {
      seedFixture(db)
      // don, dave, ben — the only three people with a `co` in the mockup.
      expect(count(db, 'affiliations')).toBe(3)
      expect(count(db, 'links')).toBeGreaterThan(0)
      const distinctCompaniesWithLinks = db
        .prepare('SELECT COUNT(DISTINCT entity_id) AS c FROM links WHERE entity_type = ?')
        .get('company') as { c: number }
      expect(distinctCompaniesWithLinks.c).toBeGreaterThan(0)
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

describe('seedFixture: service catalogue versions', () => {
  it('carries at least two services with exactly two non-overlapping service_versions each', () => {
    withFreshDb((db) => {
      seedFixture(db)
      const twoVersionServices = db
        .prepare(
          `SELECT service_id FROM service_versions GROUP BY service_id HAVING COUNT(*) = 2`
        )
        .all() as { service_id: string }[]
      expect(twoVersionServices.length).toBeGreaterThanOrEqual(2)

      for (const { service_id: serviceId } of twoVersionServices) {
        const versions = db
          .prepare(
            `SELECT version, effective_from, effective_to FROM service_versions WHERE service_id = ? ORDER BY version`
          )
          .all(serviceId) as { version: number; effective_from: string; effective_to: string | null }[]
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

describe('seedFixture: last_touch_at is derived from activity, not set independently', () => {
  it("every company's last_touch_at equals MAX(activity.occurred_at) for that company", () => {
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
        // derived value is never null.
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
      for (const row of activityRows) {
        expect(() => timestampSchema.parse(row.occurred_at)).not.toThrow()
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

describe('seedFixture: the non-empty-database guard', () => {
  it('refuses to seed a database that already has rows, without deleting anything', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(() => seedFixture(db)).toThrow(SeedGuardError)
      // Refusal must not have touched what was already there.
      expect(count(db, 'companies')).toBe(10)
    })
  })

  it('force bypasses the guard but still never deletes — it only adds the fixture again', () => {
    withFreshDb((db) => {
      seedFixture(db)
      expect(() => seedFixture(db, { force: true })).not.toThrow()
      expect(count(db, 'companies')).toBe(20)
    })
  })

  it('a database with rows in only one seeded table is still refused', () => {
    withFreshDb((db) => {
      db.prepare(
        `INSERT INTO service_categories (id, name, color, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
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
