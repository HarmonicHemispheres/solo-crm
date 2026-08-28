import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createCompany } from './companies'
import * as activityModule from './activity'
import { getActivity, listActivity, logActivity, recordContact } from './activity'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * Same real-database discipline as `companies.test.ts`: every test opens a
 * throwaway, fully migrated database through `openDatabase({ userDataDir })`
 * rather than mocking the repository's own SQL.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-activity-repo-'))
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
 * `people` has no repository yet (T-260828-21 is a separate, not-yet-built
 * task) — a raw insert fixture, same pattern `companies.test.ts` uses for
 * `activity`/`engagements`/`tasks`/`affiliations`/`time_entries` ahead of
 * their own repositories.
 */
function insertPerson(db: Database.Database, overrides: { readonly lastContactAt?: string | null } = {}): string {
  const id = randomUUID()
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO people (id, name, email, phone, notes, last_contact_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, 'Test Person', null, null, null, overrides.lastContactAt ?? null, now, now)
  return id
}

function getCompanyLastTouchAt(db: Database.Database, companyId: string): string | null {
  const row = db.prepare('SELECT last_touch_at FROM companies WHERE id = ?').get(companyId) as {
    last_touch_at: string | null
  }
  return row.last_touch_at
}

function getCompanyUpdatedAt(db: Database.Database, companyId: string): string {
  const row = db.prepare('SELECT updated_at FROM companies WHERE id = ?').get(companyId) as { updated_at: string }
  return row.updated_at
}

function getPersonLastContactAt(db: Database.Database, personId: string): string | null {
  const row = db.prepare('SELECT last_contact_at FROM people WHERE id = ?').get(personId) as {
    last_contact_at: string | null
  }
  return row.last_contact_at
}

function countActivityRows(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM activity').get() as { count: number }).count
}

describe('append-only boundary (G8)', () => {
  it('exports no function whose name contains update or delete', () => {
    const offenders = Object.keys(activityModule).filter((name) => /update|delete/i.test(name))
    expect(offenders).toEqual([])
  })
})

describe('logActivity: touch-timestamp maintenance (ADR-001)', () => {
  it("moves a company's last_touch_at to occurredAt, in the same write as the activity insert", () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Touched Co' })
      expect(getCompanyLastTouchAt(db, company.id)).toBeNull()

      const activity = logActivity(db, {
        occurredAt: '2026-08-28T10:00:00.000Z',
        kind: 'call',
        title: 'Kickoff call',
        body: 'Discussed scope.',
        companyId: company.id,
        source: 'manual'
      })

      expect(activity.id).toMatch(UUID_PATTERN)
      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T10:00:00.000Z')
    })
  })

  it("an activity row with a person and no company still moves the person's last_contact_at, and does not touch any company", () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Untouched Co' })
      const personId = insertPerson(db)

      logActivity(db, {
        occurredAt: '2026-08-28T11:00:00.000Z',
        kind: 'email',
        title: 'Follow-up email',
        body: null,
        personId,
        source: 'manual'
      })

      expect(getPersonLastContactAt(db, personId)).toBe('2026-08-28T11:00:00.000Z')
      // No companyId was named on this row — companies are untouched by it.
      expect(getCompanyLastTouchAt(db, company.id)).toBeNull()
    })
  })

  it('an activity row naming both a company and a person moves both timestamps', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Both Co' })
      const personId = insertPerson(db)

      logActivity(db, {
        occurredAt: '2026-08-28T12:00:00.000Z',
        kind: 'meeting',
        title: 'Quarterly review',
        body: null,
        companyId: company.id,
        personId,
        source: 'manual'
      })

      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T12:00:00.000Z')
      expect(getPersonLastContactAt(db, personId)).toBe('2026-08-28T12:00:00.000Z')
    })
  })

  it("a backdated activity row leaves the company's last_touch_at unchanged, and the row is still stored", () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Backdate Co' })

      logActivity(db, {
        occurredAt: '2026-08-28T12:00:00.000Z',
        kind: 'call',
        title: 'Recent call',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T12:00:00.000Z')

      const backdated = logActivity(db, {
        occurredAt: '2026-01-01T09:00:00.000Z',
        kind: 'note',
        title: 'Note about an old conversation',
        body: null,
        companyId: company.id,
        source: 'manual'
      })

      // The column did not move backward...
      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T12:00:00.000Z')
      // ...but the backdated row itself is stored, untouched.
      expect(getActivity(db, backdated.id)?.occurredAt).toBe('2026-01-01T09:00:00.000Z')
      expect(countActivityRows(db)).toBe(2)
    })
  })

  it("does not bump the company's updated_at when a backdated row leaves last_touch_at unchanged", () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Stable Co' })

      logActivity(db, {
        occurredAt: '2026-08-28T12:00:00.000Z',
        kind: 'call',
        title: 'Recent call',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
      const updatedAtAfterFirstTouch = getCompanyUpdatedAt(db, company.id)

      logActivity(db, {
        occurredAt: '2026-01-01T09:00:00.000Z',
        kind: 'note',
        title: 'Backdated note',
        body: null,
        companyId: company.id,
        source: 'manual'
      })

      expect(getCompanyUpdatedAt(db, company.id)).toBe(updatedAtAfterFirstTouch)
    })
  })

  it('forcing the update half to fail leaves no activity row written — the insert and the touch update are one transaction', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Atomic Co' })
      const originalPrepare = db.prepare.bind(db)

      const prepareSpy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        if (sql.includes('UPDATE companies')) {
          throw new Error('forced failure of the touch-update half')
        }
        return originalPrepare(sql)
      }) as typeof db.prepare)

      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28T13:00:00.000Z',
          kind: 'call',
          title: 'Should not persist',
          body: null,
          companyId: company.id,
          source: 'manual'
        })
      ).toThrow('forced failure of the touch-update half')

      prepareSpy.mockRestore()

      expect(countActivityRows(db)).toBe(0)
      expect(getCompanyLastTouchAt(db, company.id)).toBeNull()
    })
  })

  it('a correction is a new row: two rows about the same call both persist, and neither is mutated', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Correction Co' })

      const first = logActivity(db, {
        occurredAt: '2026-08-28T14:00:00.000Z',
        kind: 'call',
        title: 'Call with client',
        body: 'Discussed budget: $10,000.',
        companyId: company.id,
        source: 'manual'
      })

      const correction = logActivity(db, {
        occurredAt: '2026-08-28T14:05:00.000Z',
        kind: 'call',
        title: 'Call with client (correction)',
        body: 'Correction: budget was $12,000, not $10,000.',
        companyId: company.id,
        source: 'manual'
      })

      expect(first.id).not.toBe(correction.id)
      expect(countActivityRows(db)).toBe(2)

      // Neither row was mutated by the other's insert.
      expect(getActivity(db, first.id)?.body).toBe('Discussed budget: $10,000.')
      expect(getActivity(db, correction.id)?.body).toBe('Correction: budget was $12,000, not $10,000.')
    })
  })

  it('references a nonexistent companyId as a RefusalError, not a raw SQLite error, and writes nothing', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        logActivity(db, {
          occurredAt: '2026-08-28T15:00:00.000Z',
          kind: 'call',
          title: 'Orphaned',
          body: null,
          companyId: randomUUID(),
          source: 'manual'
        })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).not.toMatch(/SQLITE_CONSTRAINT/)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
      expect(countActivityRows(db)).toBe(0)
    })
  })
})

describe('logActivity: input validation', () => {
  it('occurredAt must be a timestampSchema value, not a bare date', () => {
    withDatabase((db) => {
      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28',
          kind: 'call',
          title: 'Bad timestamp',
          body: null,
          source: 'manual'
        })
      ).toThrow(ValidationError)
    })
  })

  it("rejects source: 'gmail' — reserved with no writer per ADR-001", () => {
    withDatabase((db) => {
      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28T10:00:00.000Z',
          kind: 'email',
          title: 'Gmail-sourced',
          body: null,
          source: 'gmail'
        })
      ).toThrow(ValidationError)
      expect(countActivityRows(db)).toBe(0)
    })
  })

  it('rejects an unknown kind value', () => {
    withDatabase((db) => {
      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28T10:00:00.000Z',
          kind: 'text-message',
          title: 'Bad kind',
          body: null,
          source: 'manual'
        })
      ).toThrow(ValidationError)
    })
  })

  it('rejects an unknown field name instead of silently dropping it', () => {
    withDatabase((db) => {
      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28T10:00:00.000Z',
          kind: 'call',
          title: 'Typo field',
          body: null,
          source: 'manual',
          companyid: randomUUID()
        })
      ).toThrow(ValidationError)
    })
  })

  it('rejects a blank title', () => {
    withDatabase((db) => {
      expect(() =>
        logActivity(db, {
          occurredAt: '2026-08-28T10:00:00.000Z',
          kind: 'note',
          title: '',
          body: null,
          source: 'manual'
        })
      ).toThrow(ValidationError)
    })
  })
})

describe('listActivity / getActivity', () => {
  it('filters by company, person, engagement and date range', () => {
    withDatabase((db) => {
      const companyA = createCompany(db, { name: 'Company A' })
      const companyB = createCompany(db, { name: 'Company B' })
      const personId = insertPerson(db)

      const early = logActivity(db, {
        occurredAt: '2026-01-01T00:00:00.000Z',
        kind: 'note',
        title: 'Early',
        body: null,
        companyId: companyA.id,
        source: 'manual'
      })
      const middle = logActivity(db, {
        occurredAt: '2026-06-01T00:00:00.000Z',
        kind: 'call',
        title: 'Middle',
        body: null,
        companyId: companyA.id,
        personId,
        source: 'manual'
      })
      logActivity(db, {
        occurredAt: '2026-08-01T00:00:00.000Z',
        kind: 'email',
        title: 'Other company',
        body: null,
        companyId: companyB.id,
        source: 'manual'
      })

      const forCompanyA = listActivity(db, { companyId: companyA.id })
      expect(forCompanyA.map((a) => a.id).sort()).toEqual([early.id, middle.id].sort())

      const forPerson = listActivity(db, { personId })
      expect(forPerson.map((a) => a.id)).toEqual([middle.id])

      const inRange = listActivity(db, { occurredFrom: '2026-05-01T00:00:00.000Z', occurredTo: '2026-07-01T00:00:00.000Z' })
      expect(inRange.map((a) => a.id)).toEqual([middle.id])
    })
  })

  it('orders results newest-first by occurredAt', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Ordered Co' })
      const older = logActivity(db, {
        occurredAt: '2026-01-01T00:00:00.000Z',
        kind: 'note',
        title: 'Older',
        body: null,
        companyId: company.id,
        source: 'manual'
      })
      const newer = logActivity(db, {
        occurredAt: '2026-06-01T00:00:00.000Z',
        kind: 'note',
        title: 'Newer',
        body: null,
        companyId: company.id,
        source: 'manual'
      })

      expect(listActivity(db, { companyId: company.id }).map((a) => a.id)).toEqual([newer.id, older.id])
    })
  })

  it('getActivity returns null for an id that does not exist', () => {
    withDatabase((db) => {
      expect(getActivity(db, randomUUID())).toBeNull()
    })
  })
})

describe('recordContact', () => {
  it('moves a company last_touch_at with no activity row created', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Gmail Co' })
      const before = countActivityRows(db)

      recordContact(db, { companyId: company.id }, '2026-08-28T09:00:00.000Z')

      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T09:00:00.000Z')
      expect(countActivityRows(db)).toBe(before)
    })
  })

  it('moves a person last_contact_at with no activity row created', () => {
    withDatabase((db) => {
      const personId = insertPerson(db)
      const before = countActivityRows(db)

      recordContact(db, { personId }, '2026-08-28T09:30:00.000Z')

      expect(getPersonLastContactAt(db, personId)).toBe('2026-08-28T09:30:00.000Z')
      expect(countActivityRows(db)).toBe(before)
    })
  })

  it('is forward-only, same as the touch update inside logActivity', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Forward Only Co' })
      recordContact(db, { companyId: company.id }, '2026-08-28T12:00:00.000Z')

      recordContact(db, { companyId: company.id }, '2026-01-01T00:00:00.000Z')
      expect(getCompanyLastTouchAt(db, company.id)).toBe('2026-08-28T12:00:00.000Z')
    })
  })

  it('throws NotFoundError for a company id that does not exist', () => {
    withDatabase((db) => {
      expect(() => recordContact(db, { companyId: randomUUID() }, '2026-08-28T09:00:00.000Z')).toThrow(NotFoundError)
    })
  })

  it('throws NotFoundError for a person id that does not exist', () => {
    withDatabase((db) => {
      expect(() => recordContact(db, { personId: randomUUID() }, '2026-08-28T09:00:00.000Z')).toThrow(NotFoundError)
    })
  })

  it('rejects an entity with both companyId and personId', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Ambiguous Co' })
      const personId = insertPerson(db)
      expect(() =>
        recordContact(db, { companyId: company.id, personId }, '2026-08-28T09:00:00.000Z')
      ).toThrow(ValidationError)
    })
  })

  it('rejects a non-timestamp at value', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Bad At Co' })
      expect(() => recordContact(db, { companyId: company.id }, '2026-08-28')).toThrow(ValidationError)
    })
  })
})
