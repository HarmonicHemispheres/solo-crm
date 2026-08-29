import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createCompany } from './companies'
import {
  createEngagement,
  deleteEngagement,
  getEngagement,
  listEngagements,
  listMilestones,
  updateEngagement
} from './engagements'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * Same real-database discipline as companies.test.ts: every test runs
 * against a real, migrated database opened through
 * `openDatabase({ userDataDir })`, not a mock.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-engagements-repo-'))
}

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir()
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Raw inserts into the tables migration 0001 gives a foreign key at
 * `engagements.id` — every one of `deleteEngagement`'s five blockers needs
 * a fixture row in the table it guards, and each of those repositories
 * (activity, tasks, time entries) is a separate task, so these are the
 * blocker fixtures for *this* task's tests, not a claim about any of those
 * repositories' future APIs.
 */
function insertMilestone(db: Database.Database, engagementId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO milestones (id, engagement_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    engagementId,
    'Kickoff',
    now,
    now
  )
}

function insertRevenueLine(db: Database.Database, engagementId: string): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO revenue_lines (id, engagement_id, period_month, amount_cents, kind, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), engagementId, '2026-08-01', 100000, 'retainer', 'projected', now, now)
}

function insertTimeEntry(db: Database.Database, engagementId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO time_entries (id, engagement_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    engagementId,
    now,
    now
  )
}

function insertTask(db: Database.Database, engagementId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO tasks (id, title, engagement_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    'Follow up',
    engagementId,
    now,
    now
  )
}

function insertActivity(db: Database.Database, engagementId: string): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), now, 'note', 'Touch', null, null, null, engagementId, 'manual', now, now)
}

describe('createEngagement / getEngagement: billing party and client are independent columns', () => {
  it("the seed fixture's Samay-shaped case — billed through one company, delivered to another — persists both and is returned by a query from either side", () => {
    withDatabase((db) => {
      const ezDeploy = createCompany(db, { name: 'EZDeploy' })
      const wPlusK = createCompany(db, { name: 'W+K' })

      const created = createEngagement(db, {
        name: 'Samay build',
        billingModel: 'retainer',
        billingCompanyId: ezDeploy.id,
        clientCompanyId: wPlusK.id,
        startedOn: '2026-01-01',
        hoursIncluded: 40
      })

      expect(created.billingCompanyId).toBe(ezDeploy.id)
      expect(created.clientCompanyId).toBe(wPlusK.id)
      expect(created.billingCompanyId).not.toBe(created.clientCompanyId)

      const fetched = getEngagement(db, created.id)
      expect(fetched?.billingCompanyId).toBe(ezDeploy.id)
      expect(fetched?.clientCompanyId).toBe(wPlusK.id)

      const byBilling = listEngagements(db, { billingCompanyId: ezDeploy.id })
      expect(byBilling.map((e) => e.id)).toContain(created.id)

      const byClient = listEngagements(db, { clientCompanyId: wPlusK.id })
      expect(byClient.map((e) => e.id)).toContain(created.id)

      // Querying the billing company's id as a *client* filter must not
      // match — the two columns are never coalesced.
      const wrongSide = listEngagements(db, { clientCompanyId: ezDeploy.id })
      expect(wrongSide.map((e) => e.id)).not.toContain(created.id)
    })
  })

  it('creating with only billingCompanyId leaves clientCompanyId null — no coalesce (review item 4, this task\'s headline risk)', () => {
    withDatabase((db) => {
      const ezDeploy = createCompany(db, { name: 'EZDeploy Solo' })

      const created = createEngagement(db, {
        name: 'Solo Billed',
        billingModel: 'none',
        billingCompanyId: ezDeploy.id,
        startedOn: '2026-01-01'
      })

      expect(created.billingCompanyId).toBe(ezDeploy.id)
      expect(created.clientCompanyId).toBeNull()

      const fetched = getEngagement(db, created.id)
      expect(fetched?.clientCompanyId).toBeNull()

      const raw = db.prepare('SELECT client_company_id FROM engagements WHERE id = ?').get(created.id) as {
        client_company_id: unknown
      }
      expect(raw.client_company_id).toBeNull()
    })
  })
})

describe('endsOn: null means rolling, never defaulted or coalesced', () => {
  it('survives create -> read -> update -> read with no sentinel substituted, asserted on the raw column value', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Rolling Retainer',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        endsOn: null
      })
      expect(created.endsOn).toBeNull()

      const fetchedAfterCreate = getEngagement(db, created.id)
      expect(fetchedAfterCreate?.endsOn).toBeNull()

      const rawAfterCreate = db.prepare('SELECT ends_on FROM engagements WHERE id = ?').get(created.id) as {
        ends_on: unknown
      }
      expect(rawAfterCreate.ends_on).toBeNull()

      const updated = updateEngagement(db, created.id, { notes: 'still rolling' })
      expect(updated.endsOn).toBeNull()

      const rawAfterUpdate = db.prepare('SELECT ends_on FROM engagements WHERE id = ?').get(created.id) as {
        ends_on: unknown
      }
      expect(rawAfterUpdate.ends_on).toBeNull()

      const fetchedAfterUpdate = getEngagement(db, created.id)
      expect(fetchedAfterUpdate?.endsOn).toBeNull()
    })
  })

  it('omitting endsOn entirely on create also leaves it null, not defaulted', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'No End Date', billingModel: 'none', startedOn: '2026-01-01' })
      expect(created.endsOn).toBeNull()
    })
  })
})

describe('billingModel: a real discriminated union, not a flat optional schema', () => {
  it("createEngagement({ billingModel: 'retainer', contractValueCents: ... }) is rejected, naming the offending field", () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createEngagement(db, {
          name: 'Mismatched Model',
          billingModel: 'retainer',
          startedOn: '2026-01-01',
          contractValueCents: 500000
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toContain('contractValueCents')
    })
  })

  it('rejects a tm field on a fixed engagement', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, {
          name: 'Fixed With TM Field',
          billingModel: 'fixed',
          startedOn: '2026-01-01',
          hourlyRateCents: 15000
        })
      ).toThrow(ValidationError)
    })
  })

  it('retainer carries hoursIncluded and round-trips it', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Retainer Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        hoursIncluded: 20
      })
      expect(created.hoursIncluded).toBe(20)
      expect(created.contractValueCents).toBeNull()
      expect(created.hourlyRateCents).toBeNull()
    })
  })

  it('fixed carries contractValueCents and round-trips it', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Fixed Co',
        billingModel: 'fixed',
        startedOn: '2026-01-01',
        contractValueCents: 1200000
      })
      expect(created.contractValueCents).toBe(1200000)
      expect(created.hoursIncluded).toBeNull()
    })
  })

  it('tm carries hourlyRateCents, estimatedHours and notToExceedCents and round-trips them', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'TM Co',
        billingModel: 'tm',
        startedOn: '2026-01-01',
        hourlyRateCents: 25000,
        estimatedHours: 80,
        notToExceedCents: 2000000
      })
      expect(created.hourlyRateCents).toBe(25000)
      expect(created.estimatedHours).toBe(80)
      expect(created.notToExceedCents).toBe(2000000)
    })
  })

  it('equity carries no model-specific columns and is accepted', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Equity Co', billingModel: 'equity', startedOn: '2026-01-01' })
      expect(created.billingModel).toBe('equity')
      expect(created.hoursIncluded).toBeNull()
      expect(created.contractValueCents).toBeNull()
    })
  })

  it('none carries no model-specific columns and is accepted', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'No Model Co', billingModel: 'none', startedOn: '2026-01-01' })
      expect(created.billingModel).toBe('none')
    })
  })

  it('rejects a create with no billingModel at all', () => {
    withDatabase((db) => {
      expect(() => createEngagement(db, { name: 'No Model At All', startedOn: '2026-01-01' })).toThrow(ValidationError)
    })
  })

  it('rejects an unknown billingModel value', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, { name: 'Bad Model', billingModel: 'subscription', startedOn: '2026-01-01' })
      ).toThrow(ValidationError)
    })
  })
})

describe('status: all six values round-trip, lost included', () => {
  const statuses = ['active', 'pending', 'proposed', 'held', 'delivered', 'lost'] as const

  it.each(statuses)('round-trips status=%s', (status) => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: `Status ${status}`,
        billingModel: 'none',
        startedOn: '2026-01-01',
        status
      })
      expect(created.status).toBe(status)

      const fetched = getEngagement(db, created.id)
      expect(fetched?.status).toBe(status)

      const filtered = listEngagements(db, { status })
      expect(filtered.map((e) => e.id)).toContain(created.id)
    })
  })

  it('rejects an unknown status value', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, { name: 'Bad Status', billingModel: 'none', startedOn: '2026-01-01', status: 'won' })
      ).toThrow(ValidationError)
    })
  })
})

describe('startedOn is required on create', () => {
  it('rejects a create with no startedOn, rather than defaulting to today', () => {
    withDatabase((db) => {
      expect(() => createEngagement(db, { name: 'No Start Date', billingModel: 'none' })).toThrow(ValidationError)
    })
  })
})

describe('agreedRateCents: writable on create, ignored on update', () => {
  it('is stored as given on create', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Rated Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        agreedRateCents: 15000,
        hoursIncluded: 10
      })
      expect(created.agreedRateCents).toBe(15000)
    })
  })

  it('updateEngagement cannot change agreedRateCents — the stored value is unchanged after an update that includes it', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Snapshot Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        agreedRateCents: 15000,
        hoursIncluded: 10
      })
      expect(created.agreedRateCents).toBe(15000)

      // The update patch includes agreedRateCents with a different value —
      // this must not throw (the schema accepts the key) and must not
      // change the stored column.
      const updated = updateEngagement(db, created.id, { agreedRateCents: 99999, notes: 'renegotiation discussed' })
      expect(updated.agreedRateCents).toBe(15000)
      expect(updated.notes).toBe('renegotiation discussed')

      const raw = db.prepare('SELECT agreed_rate_cents FROM engagements WHERE id = ?').get(created.id) as {
        agreed_rate_cents: number
      }
      expect(raw.agreed_rate_cents).toBe(15000)
    })
  })
})

describe('money is integer cents end to end', () => {
  it('rejects a float for agreedRateCents', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, {
          name: 'Float Rate Co',
          billingModel: 'retainer',
          startedOn: '2026-01-01',
          agreedRateCents: 150.5
        })
      ).toThrow(ValidationError)
    })
  })

  it('rejects a float for contractValueCents', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, {
          name: 'Float Contract Co',
          billingModel: 'fixed',
          startedOn: '2026-01-01',
          contractValueCents: 1200000.5
        })
      ).toThrow(ValidationError)
    })
  })
})

describe('updateEngagement: undefined-valued keys and switching billing model', () => {
  it('a patch with an explicit undefined-valued key leaves the column untouched, same as an absent key', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Undefined Patch Co', billingModel: 'none', startedOn: '2026-01-01', notes: 'original' })
      expect(created.notes).toBe('original')

      const updated = updateEngagement(db, created.id, { notes: undefined, status: 'active' })
      expect(updated.notes).toBe('original')
      expect(updated.status).toBe('active')
    })
  })

  it('accepts an explicit billingModel: undefined alongside other fields (review item 2) — the same shape the code documents parseInput normalises', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Undefined Model Patch Co', billingModel: 'none', startedOn: '2026-01-01' })

      const updated = updateEngagement(db, created.id, { billingModel: undefined, notes: 'x' })
      expect(updated.notes).toBe('x')
      expect(updated.billingModel).toBe('none')
    })
  })

  it('a patch that switches billingModel from retainer to fixed writes the new field and clears the old one', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Switching Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        hoursIncluded: 30
      })
      expect(created.hoursIncluded).toBe(30)

      const updated = updateEngagement(db, created.id, { billingModel: 'fixed', contractValueCents: 800000 })
      expect(updated.billingModel).toBe('fixed')
      expect(updated.contractValueCents).toBe(800000)
      expect(updated.hoursIncluded).toBeNull()
    })
  })

  it('a partial patch naming the SAME billingModel the row already has leaves unnamed model-specific columns alone (review item 1: silent data loss)', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Same Model Patch Co',
        billingModel: 'tm',
        startedOn: '2026-01-01',
        hourlyRateCents: 20000,
        estimatedHours: 40,
        notToExceedCents: 1000000
      })
      expect(created.estimatedHours).toBe(40)
      expect(created.notToExceedCents).toBe(1000000)

      const updated = updateEngagement(db, created.id, { billingModel: 'tm', hourlyRateCents: 30000 })
      expect(updated.hourlyRateCents).toBe(30000)
      expect(updated.estimatedHours).toBe(40)
      expect(updated.notToExceedCents).toBe(1000000)

      const raw = db
        .prepare('SELECT hourly_rate_cents, estimated_hours, not_to_exceed_cents FROM engagements WHERE id = ?')
        .get(created.id) as { hourly_rate_cents: number; estimated_hours: number; not_to_exceed_cents: number }
      expect(raw.hourly_rate_cents).toBe(30000)
      expect(raw.estimated_hours).toBe(40)
      expect(raw.not_to_exceed_cents).toBe(1000000)
    })
  })

  it('a patch that omits billingModel leaves every model-specific column untouched', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Untouched Model Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        hoursIncluded: 15
      })

      const updated = updateEngagement(db, created.id, { status: 'active' })
      expect(updated.billingModel).toBe('retainer')
      expect(updated.hoursIncluded).toBe(15)
    })
  })

  it('rejects a patch that switches to retainer while still carrying a fixed-only field', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Bad Switch Co',
        billingModel: 'fixed',
        startedOn: '2026-01-01',
        contractValueCents: 500000
      })

      expect(() => updateEngagement(db, created.id, { billingModel: 'retainer', contractValueCents: 500000 })).toThrow(
        ValidationError
      )
    })
  })

  it('updateEngagement throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => updateEngagement(db, randomUUID(), { notes: 'x' })).toThrow(NotFoundError)
    })
  })

  it('a validation failure names the actual offending field, not just "(root): Invalid input" (review item 3)', () => {
    withDatabase((db) => {
      const created = createEngagement(db, {
        name: 'Distinguishable Errors Co',
        billingModel: 'retainer',
        startedOn: '2026-01-01',
        hoursIncluded: 10
      })

      let thrown: unknown
      try {
        // A retainer patch carrying a fixed-only field: a real bug in
        // zod v4's `z.union` collapses this to one useless "(root): Invalid
        // input" issue with no mention of the field that is actually wrong.
        updateEngagement(db, created.id, { billingModel: 'retainer', contractValueCents: 500000 })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ValidationError)
      const validationError = thrown as ValidationError
      expect(validationError.message).not.toBe('(root): Invalid input')
      expect(validationError.message).toContain('contractValueCents')
      expect(validationError.issues?.length ?? 0).toBeGreaterThan(0)
    })
  })
})

describe('createEngagement / updateEngagement: id and timestamps', () => {
  it('assigns a UUID id and equal created_at/updated_at on create; update moves updated_at and leaves created_at', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'))
      withDatabase((db) => {
        const created = createEngagement(db, { name: 'Time Co', billingModel: 'none', startedOn: '2026-01-01' })
        expect(created.id).toMatch(UUID_PATTERN)
        expect(created.createdAt).toBe('2026-08-28T10:00:00.000Z')
        expect(created.updatedAt).toBe('2026-08-28T10:00:00.000Z')

        vi.setSystemTime(new Date('2026-08-28T10:05:00.000Z'))
        const updated = updateEngagement(db, created.id, { notes: 'touched' })
        expect(updated.createdAt).toBe(created.createdAt)
        expect(updated.updatedAt).toBe('2026-08-28T10:05:00.000Z')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('input validation', () => {
  it('createEngagement rejects a blank name', () => {
    withDatabase((db) => {
      expect(() => createEngagement(db, { name: '', billingModel: 'none', startedOn: '2026-01-01' })).toThrow(
        ValidationError
      )
    })
  })

  it('createEngagement rejects an unknown field name', () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, { name: 'Typo Co', billingModel: 'none', startedOn: '2026-01-01', nmae: 'Typo Co' })
      ).toThrow(ValidationError)
    })
  })

  it('updateEngagement rejects a non-object patch', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Patch Co', billingModel: 'none', startedOn: '2026-01-01' })
      expect(() => updateEngagement(db, created.id, 'not an object')).toThrow(ValidationError)
    })
  })

  it("rejects a since-style bad date ('2026-1-1') for startedOn", () => {
    withDatabase((db) => {
      expect(() =>
        createEngagement(db, { name: 'Bad Date Co', billingModel: 'none', startedOn: '2026-1-1' })
      ).toThrow(ValidationError)
    })
  })
})

describe('constraint translation: a write referencing a nonexistent company or service version is refused, not a bare SqliteError (review item 5)', () => {
  it('createEngagement with a nonexistent billingCompanyId is refused', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createEngagement(db, {
          name: 'Bad Billing Company Co',
          billingModel: 'none',
          billingCompanyId: randomUUID(),
          startedOn: '2026-01-01'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
    })
  })

  it('createEngagement with a nonexistent clientCompanyId is refused', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createEngagement(db, {
          name: 'Bad Client Company Co',
          billingModel: 'none',
          clientCompanyId: randomUUID(),
          startedOn: '2026-01-01'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
    })
  })

  it('createEngagement with a nonexistent serviceVersionId is refused', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createEngagement(db, {
          name: 'Bad Service Version Co',
          billingModel: 'none',
          serviceVersionId: randomUUID(),
          startedOn: '2026-01-01'
        })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
    })
  })

  it('updateEngagement with a nonexistent billingCompanyId is refused, and the row is unchanged', () => {
    withDatabase((db) => {
      const ezDeploy = createCompany(db, { name: 'EZDeploy FK' })
      const created = createEngagement(db, {
        name: 'Refused Update Co',
        billingModel: 'none',
        billingCompanyId: ezDeploy.id,
        startedOn: '2026-01-01'
      })

      let thrown: unknown
      try {
        updateEngagement(db, created.id, { billingCompanyId: randomUUID() })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')

      const unchanged = getEngagement(db, created.id)
      expect(unchanged?.billingCompanyId).toBe(ezDeploy.id)
    })
  })

  it('updateEngagement with a nonexistent clientCompanyId is refused', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Refused Client Update Co', billingModel: 'none', startedOn: '2026-01-01' })

      expect(() => updateEngagement(db, created.id, { clientCompanyId: randomUUID() })).toThrow(RefusalError)
    })
  })

  it('updateEngagement with a nonexistent serviceVersionId is refused', () => {
    withDatabase((db) => {
      const created = createEngagement(db, { name: 'Refused Service Update Co', billingModel: 'none', startedOn: '2026-01-01' })

      expect(() => updateEngagement(db, created.id, { serviceVersionId: randomUUID() })).toThrow(RefusalError)
    })
  })
})

describe('listMilestones', () => {
  it('returns every milestone for an engagement, ordered by sort', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Fixed Scope Co', billingModel: 'fixed', startedOn: '2026-01-01' })
      const now = nowTimestamp()
      db.prepare('INSERT INTO milestones (id, engagement_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        engagement.id,
        'Second',
        2,
        now,
        now
      )
      db.prepare('INSERT INTO milestones (id, engagement_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        engagement.id,
        'First',
        1,
        now,
        now
      )

      const milestones = listMilestones(db, engagement.id)
      expect(milestones.map((m) => m.name)).toEqual(['First', 'Second'])
    })
  })

  it('returns an empty list for an engagement with no milestones', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Bare Co', billingModel: 'none', startedOn: '2026-01-01' })
      expect(listMilestones(db, engagement.id)).toEqual([])
    })
  })

  it('an unsorted (sort: null) milestone does not lead the list ahead of sorted ones (review item 6)', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Nullable Sort Co', billingModel: 'fixed', startedOn: '2026-01-01' })
      const now = nowTimestamp()
      // Inserted first, so a plain "sort ASC" (NULLs first in SQLite) would
      // put this one at the head of the list even though it has no
      // position — it must sort AFTER every milestone that has a `sort`.
      db.prepare('INSERT INTO milestones (id, engagement_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        engagement.id,
        'Unsorted',
        null,
        now,
        now
      )
      db.prepare('INSERT INTO milestones (id, engagement_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        engagement.id,
        'Second',
        2,
        now,
        now
      )
      db.prepare('INSERT INTO milestones (id, engagement_id, name, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        randomUUID(),
        engagement.id,
        'First',
        1,
        now,
        now
      )

      const milestones = listMilestones(db, engagement.id)
      expect(milestones.map((m) => m.name)).toEqual(['First', 'Second', 'Unsorted'])
    })
  })
})

describe('deleteEngagement: referential refusals — all five foreign keys migration 0001 points at engagements.id', () => {
  it('refuses to delete an engagement referenced by a milestone; the row survives', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Milestoned Co', billingModel: 'fixed', startedOn: '2026-01-01' })
      insertMilestone(db, engagement.id)

      let thrown: unknown
      try {
        deleteEngagement(db, engagement.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'milestones', count: 1 })
      expect(getEngagement(db, engagement.id)).not.toBeNull()
    })
  })

  it('refuses to delete an engagement referenced by a revenue line; the row survives', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Revenue Co', billingModel: 'retainer', startedOn: '2026-01-01' })
      insertRevenueLine(db, engagement.id)

      let thrown: unknown
      try {
        deleteEngagement(db, engagement.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'revenue-lines', count: 1 })
      expect(getEngagement(db, engagement.id)).not.toBeNull()
    })
  })

  it('refuses to delete an engagement referenced by a time entry; the row survives', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Timelogged Co', billingModel: 'tm', startedOn: '2026-01-01' })
      insertTimeEntry(db, engagement.id)

      let thrown: unknown
      try {
        deleteEngagement(db, engagement.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'time-entries', count: 1 })
      expect(getEngagement(db, engagement.id)).not.toBeNull()
    })
  })

  it('refuses to delete an engagement referenced by a task; the row survives', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Tasked Co', billingModel: 'none', startedOn: '2026-01-01' })
      insertTask(db, engagement.id)

      let thrown: unknown
      try {
        deleteEngagement(db, engagement.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'tasks', count: 1 })
      expect(getEngagement(db, engagement.id)).not.toBeNull()
    })
  })

  it('refuses to delete an engagement with activity rows; the row survives and no activity row is deleted or orphaned', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Active Co', billingModel: 'none', startedOn: '2026-01-01' })
      insertActivity(db, engagement.id)

      let thrown: unknown
      try {
        deleteEngagement(db, engagement.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'activity', count: 1 })

      const activityCount = (
        db.prepare('SELECT COUNT(*) AS count FROM activity WHERE engagement_id = ?').get(engagement.id) as {
          count: number
        }
      ).count
      expect(activityCount).toBe(1)
      expect(getEngagement(db, engagement.id)).not.toBeNull()
    })
  })

  it('deletes cleanly when nothing blocks it', () => {
    withDatabase((db) => {
      const engagement = createEngagement(db, { name: 'Deletable Co', billingModel: 'none', startedOn: '2026-01-01' })
      deleteEngagement(db, engagement.id)
      expect(getEngagement(db, engagement.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => deleteEngagement(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

// ---------------------------------------------------------------------------
// The ADR-003 guard
//
// This is a backstop for review, not a replacement for it. It matches three
// shapes a per-billing-model money helper takes, and a determined author can
// still write one it does not see (a lookup table keyed by model, arithmetic
// spelled `Math.imul`, a helper in another file). What it does buy is that
// the *obvious* form — the `monthlyValue(engagement)` that branches on
// `billingModel` and multiplies hours by a rate, named as the highest-risk
// carry-over in this project — cannot land here unnoticed. Widened by
// T-260828-46: the original grepped only `/\bSUM\s*\(/i`, which catches an
// aggregate but not that helper, which contains no `SUM` at all.
// ---------------------------------------------------------------------------

/** Comments removed. Nothing here is about what the file *says*, only what it executes — the header comment names `SUM` and every billing model in prose. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

/**
 * String and template literals emptied too. Every SQL string in this
 * repository is a literal, and `SELECT * FROM engagements` is not
 * arithmetic; emptying a template also drops the code in its `${…}` holes,
 * which today is only `columns.join(', ')`-shaped SQL assembly.
 */
function withoutCommentsOrStrings(source: string): string {
  return withoutComments(source)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

/** Returns one line per rule this source breaks — empty means the source is clean. */
function adr003Violations(source: string): string[] {
  const violations: string[] = []

  // 1. An aggregate. The original rule, unchanged.
  if (/\bSUM\s*\(/i.test(source)) {
    violations.push('SUM( — an aggregate belongs in the revenue-lines generator (P3-05), not here')
  }

  // 2. Arithmetic in executable code. This repository reads and writes stored
  //    columns; it multiplies nothing by anything. `+` is deliberately not
  //    listed — every refusal message in the file concatenates strings with
  //    it, so it carries no signal.
  const arithmetic = withoutCommentsOrStrings(source).match(/[*/%]/g)
  if (arithmetic) {
    violations.push(`arithmetic (${arithmetic.join(' ')}) — this repository computes no figure, it returns stored columns`)
  }

  // 3. A branch on a billing-model literal. `parsed.billingModel !==
  //    currentRow.billing_model` (updateEngagement's "is the model actually
  //    changing" test) compares two columns, names no model, and passes;
  //    `if (e.billingModel === 'retainer')` does not.
  const models = String.raw`retainer|fixed|tm|equity|none`
  const executable = withoutComments(source)
  const branches = [
    ...(executable.match(new RegExp(String.raw`(?:===|!==|==|!=|case)\s*(['"\`])(?:${models})\1`, 'g')) ?? []),
    ...(executable.match(new RegExp(String.raw`(['"\`])(?:${models})\1\s*(?:===|!==|==|!=)`, 'g')) ?? [])
  ]
  if (branches.length > 0) {
    violations.push(`a branch on a billing-model literal (${branches.join(', ')}) — per-model money branching lives only in P3-05`)
  }

  return violations
}

describe('this file computes no summed, projected or per-month figure (ADR-003 / this task Risks)', () => {
  it('engagements.ts breaks none of the three rules — every revenue question stays in the revenue-lines generator (P3-05)', () => {
    expect(adr003Violations(readFileSync(join(__dirname, 'engagements.ts'), 'utf8'))).toEqual([])
  })

  it('the guard catches a monthlyValue helper that branches on billingModel and contains no SUM', () => {
    // The exact shape the Risks section names, and the exact shape the
    // SUM-only rule let through. Kept as a fixture rather than pasted into
    // engagements.ts and deleted again, so the guard stays measured rather
    // than assumed after the next edit to either file.
    const synthetic = [
      'function monthlyValue(engagement: Engagement): number {',
      "  if (engagement.billingModel === 'retainer') return engagement.agreedRateCents ?? 0",
      "  if (engagement.billingModel === 'tm') return (engagement.hourlyRateCents ?? 0) * (engagement.estimatedHours ?? 0)",
      '  return 0',
      '}'
    ].join('\n')

    expect(synthetic).not.toMatch(/\bSUM\s*\(/i)
    const violations = adr003Violations(synthetic)
    expect(violations).toHaveLength(2)
    expect(violations.join('\n')).toContain('arithmetic')
    expect(violations.join('\n')).toContain('billing-model literal')
  })

  it('leaves the comparison updateEngagement actually makes alone', () => {
    expect(adr003Violations('const changing = parsed.billingModel !== currentRow.billing_model')).toEqual([])
  })
})
