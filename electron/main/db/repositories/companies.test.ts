import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createCompany, deleteCompany, getCompany, listCompanies, updateCompany } from './companies'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * Every test here runs `createCompany`/`getCompany`/`updateCompany`/
 * `deleteCompany` against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — the same real path `connection.test.ts`
 * and `migrate.test.ts` use, not a mock or an in-memory stub of the
 * repository's own making. `withDatabase` below is the one place that setup
 * lives so every `it` gets its own throwaway directory.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-companies-repo-'))
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

/** Inserts a raw `activity` row directly — the activity repository is a separate task (out of this task's scope); this is the RESTRICT-blocker fixture, not a claim about that repository's future API. */
function insertActivity(db: Database.Database, companyId: string): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), now, 'note', 'Touch', null, companyId, null, null, 'manual', now, now)
}

describe('createCompany / getCompany: round-trip', () => {
  it('round-trips all fourteen columns field-for-field', () => {
    withDatabase((db) => {
      const billingParty = createCompany(db, { name: 'Billing Party Co' })
      const referrer = createCompany(db, { name: 'Referrer Co' })

      const input = {
        name: 'Full Co',
        kind: 'client' as const,
        website: 'fullco.example',
        billsDirectly: false,
        billedViaCompanyId: billingParty.id,
        introducedByCompanyId: referrer.id,
        cadenceDays: 21,
        lastTouchAt: '2026-08-20T16:00:00.000Z',
        budgetNote: '$10,000 approved',
        notes: 'Some notes about Full Co.',
        since: '2026-01-15'
      }

      const created = createCompany(db, input)
      const fetched = getCompany(db, created.id)

      expect(fetched).toEqual(created)
      expect(created.id).toMatch(UUID_PATTERN)
      expect(created.name).toBe(input.name)
      expect(created.kind).toBe(input.kind)
      expect(created.website).toBe(input.website)
      expect(created.billsDirectly).toBe(input.billsDirectly)
      expect(created.billedViaCompanyId).toBe(input.billedViaCompanyId)
      expect(created.introducedByCompanyId).toBe(input.introducedByCompanyId)
      expect(created.cadenceDays).toBe(input.cadenceDays)
      expect(created.lastTouchAt).toBe(input.lastTouchAt)
      expect(created.budgetNote).toBe(input.budgetNote)
      expect(created.notes).toBe(input.notes)
      expect(created.since).toBe(input.since)
      expect(created.createdAt).toEqual(created.updatedAt)
    })
  })

  it('applies bills_directly=true and cadence_days=14 defaults when the caller omits them', () => {
    withDatabase((db) => {
      const created = createCompany(db, { name: 'Bare Co' })
      expect(created.billsDirectly).toBe(true)
      expect(created.cadenceDays).toBe(14)
      expect(created.kind).toBeNull()
      expect(created.lastTouchAt).toBeNull()
    })
  })

  it('getCompany returns null for an id that does not exist', () => {
    withDatabase((db) => {
      expect(getCompany(db, randomUUID())).toBeNull()
    })
  })

  it('listCompanies returns every row, ordered by name', () => {
    withDatabase((db) => {
      createCompany(db, { name: 'Zebra Co' })
      createCompany(db, { name: 'Alpha Co' })
      const names = listCompanies(db).map((c) => c.name)
      expect(names).toEqual(['Alpha Co', 'Zebra Co'])
    })
  })
})

describe('createCompany / updateCompany: id and timestamps', () => {
  it('assigns a UUID id and equal created_at/updated_at on create; update moves updated_at and leaves created_at', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'))
      withDatabase((db) => {
        const created = createCompany(db, { name: 'Time Co' })
        expect(created.id).toMatch(UUID_PATTERN)
        expect(created.createdAt).toBe('2026-08-28T10:00:00.000Z')
        expect(created.updatedAt).toBe('2026-08-28T10:00:00.000Z')

        vi.setSystemTime(new Date('2026-08-28T10:05:00.000Z'))
        const updated = updateCompany(db, created.id, { notes: 'touched' })
        expect(updated.createdAt).toBe(created.createdAt)
        expect(updated.updatedAt).toBe('2026-08-28T10:05:00.000Z')
        expect(updated.updatedAt).not.toBe(updated.createdAt)
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a patch that omits bills_directly does not reset it to the default', () => {
    withDatabase((db) => {
      const created = createCompany(db, { name: 'Direct Co', billsDirectly: false })
      expect(created.billsDirectly).toBe(false)

      const updated = updateCompany(db, created.id, { notes: 'unrelated change' })
      expect(updated.billsDirectly).toBe(false)
    })
  })

  it('updateCompany throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => updateCompany(db, randomUUID(), { notes: 'x' })).toThrow(NotFoundError)
    })
  })
})

describe('the billed_via_company_id self-reference CHECK', () => {
  it('is surfaced as a RefusalError, not an unhandled throw, and the row is left unchanged', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Self Co' })

      let thrown: unknown
      try {
        updateCompany(db, company.id, { billedViaCompanyId: company.id })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).not.toMatch(/SQLITE_CONSTRAINT_CHECK/)

      const after = getCompany(db, company.id)
      expect(after?.billedViaCompanyId).toBeNull()
    })
  })
})

describe('deleteCompany: referential refusals', () => {
  it("refuses to delete a company that is another company's billing party, naming the blocker; the row survives", () => {
    withDatabase((db) => {
      const parent = createCompany(db, { name: 'Billing Party' })
      createCompany(db, { name: 'Billed Through Parent', billedViaCompanyId: parent.id })

      let thrown: unknown
      try {
        deleteCompany(db, parent.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).toContain('Billed Through Parent')
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'billed-via', count: 1 })

      expect(getCompany(db, parent.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company it introduced, naming the blocker; the row survives', () => {
    withDatabase((db) => {
      const referrer = createCompany(db, { name: 'Referral Source' })
      createCompany(db, { name: 'Introduced Co', introducedByCompanyId: referrer.id })

      let thrown: unknown
      try {
        deleteCompany(db, referrer.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).toContain('Introduced Co')
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'introduced-by', count: 1 })

      expect(getCompany(db, referrer.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company with activity rows, naming the count; no activity row is deleted or orphaned', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Active Co' })
      insertActivity(db, company.id)

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).toContain('1 activity record')
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'activity', count: 1 })

      const activityCount = (
        db.prepare('SELECT COUNT(*) AS count FROM activity WHERE company_id = ?').get(company.id) as {
          count: number
        }
      ).count
      expect(activityCount).toBe(1)
      expect(getCompany(db, company.id)).not.toBeNull()
    })
  })

  it('deletes cleanly when nothing blocks it', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Deletable Co' })
      deleteCompany(db, company.id)
      expect(getCompany(db, company.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => deleteCompany(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

describe('the since column: dateOnlySchema, not a hand-rolled check', () => {
  it("rejects '2026-8-1'", () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createCompany(db, { name: 'Bad Date Co', since: '2026-8-1' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(ValidationError)
    })
  })

  it("accepts '2026-08-01'", () => {
    withDatabase((db) => {
      const created = createCompany(db, { name: 'Good Date Co', since: '2026-08-01' })
      expect(created.since).toBe('2026-08-01')
    })
  })
})

describe('input validation', () => {
  it('createCompany rejects a blank name as a ValidationError', () => {
    withDatabase((db) => {
      expect(() => createCompany(db, { name: '' })).toThrow(ValidationError)
    })
  })

  it('createCompany rejects an unknown kind value', () => {
    withDatabase((db) => {
      expect(() => createCompany(db, { name: 'Odd Co', kind: 'not-a-real-kind' })).toThrow(ValidationError)
    })
  })

  it('updateCompany rejects a non-object patch', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Patch Co' })
      expect(() => updateCompany(db, company.id, 'not an object')).toThrow(ValidationError)
    })
  })
})
