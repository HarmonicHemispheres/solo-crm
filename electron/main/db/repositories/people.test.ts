import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { createCompany } from './companies'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import {
  addAffiliation,
  createPerson,
  deletePerson,
  endAffiliation,
  getPerson,
  listAffiliationsForCompany,
  listAffiliationsForPerson,
  listPeople,
  movePerson,
  updateAffiliation,
  updatePerson
} from './people'

/**
 * Every test here runs against a real, migrated database opened through
 * `openDatabase({ userDataDir })` — the same pattern `companies.test.ts`
 * uses, not a mock. `withDatabase` is the one place that setup lives so
 * every `it` gets its own throwaway directory.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-people-repo-'))
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

function insertActivityForPerson(db: Database.Database, personId: string): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), now, 'note', 'Touch', null, null, personId, null, 'manual', now, now)
}

function insertTaskForPerson(db: Database.Database, personId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO tasks (id, title, person_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    'Follow up',
    personId,
    now,
    now
  )
}

describe('people gains no company_id column', () => {
  it('the DDL for `people` has no company_id — a later "convenience" migration would fail this', () => {
    withDatabase((db) => {
      const columns = db.prepare('PRAGMA table_info(people)').all() as { name: string }[]
      expect(columns.map((c) => c.name)).not.toContain('company_id')
    })
  })
})

describe('createPerson / getPerson / updatePerson: round-trip', () => {
  it('round-trips name/email/phone/notes; lastContactAt is not writable here (ADR-001)', () => {
    withDatabase((db) => {
      const created = createPerson(db, { name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100', notes: 'Met at conf.' })
      const fetched = getPerson(db, created.id)

      expect(created.id).toMatch(UUID_PATTERN)
      expect(created.name).toBe('Jane Doe')
      expect(created.email).toBe('jane@example.com')
      expect(created.phone).toBe('555-0100')
      expect(created.notes).toBe('Met at conf.')
      expect(created.lastContactAt).toBeNull()
      expect(created.createdAt).toEqual(created.updatedAt)
      expect(fetched).toMatchObject({ ...created, affiliations: [] })
    })
  })

  it('createPerson accepts a bare name; email/phone/notes default to null', () => {
    withDatabase((db) => {
      const created = createPerson(db, { name: 'Bare Person' })
      expect(created.email).toBeNull()
      expect(created.phone).toBeNull()
      expect(created.notes).toBeNull()
    })
  })

  it('getPerson returns null for an id that does not exist', () => {
    withDatabase((db) => {
      expect(getPerson(db, randomUUID())).toBeNull()
    })
  })

  it('listPeople returns every row, ordered by name', () => {
    withDatabase((db) => {
      createPerson(db, { name: 'Zeb' })
      createPerson(db, { name: 'Amy' })
      expect(listPeople(db).map((p) => p.name)).toEqual(['Amy', 'Zeb'])
    })
  })

  it('updatePerson: a patch with an explicit undefined-valued key leaves the column untouched, same as an absent key', () => {
    withDatabase((db) => {
      const created = createPerson(db, { name: 'Undefined Patch Person', phone: '555-0100' })

      // The renderer's natural patch shape is `{ field: dirty ? value :
      // undefined }`; Electron's structured clone preserves that key across
      // IPC. Without stripping undefined-valued keys after parse this binds
      // NULL and wipes the column.
      const updated = updatePerson(db, created.id, { phone: undefined, notes: 'now with notes' })
      expect(updated.phone).toBe('555-0100')
      expect(updated.notes).toBe('now with notes')
    })
  })

  it('updatePerson: an explicit null actually clears a column that had a value', () => {
    withDatabase((db) => {
      const created = createPerson(db, { name: 'Nullable Person', phone: '555-0100' })
      const updated = updatePerson(db, created.id, { phone: null })
      expect(updated.phone).toBeNull()
    })
  })

  it('updatePerson throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => updatePerson(db, randomUUID(), { notes: 'x' })).toThrow(NotFoundError)
    })
  })

  it('updatePerson rejects an unknown field name instead of silently no-opping', () => {
    withDatabase((db) => {
      const created = createPerson(db, { name: 'Rename Person' })
      expect(() => updatePerson(db, created.id, { nmae: 'typo' })).toThrow(ValidationError)
      const after = getPerson(db, created.id)
      expect(after?.name).toBe('Rename Person')
      expect(after?.updatedAt).toBe(created.updatedAt)
    })
  })

  it('createPerson rejects a blank name as a ValidationError', () => {
    withDatabase((db) => {
      expect(() => createPerson(db, { name: '' })).toThrow(ValidationError)
    })
  })
})

describe('movePerson: the history-preserving job change', () => {
  it("closes the old affiliation (non-null ended) and opens a new one; getPerson marks both", () => {
    withDatabase((db) => {
      const oldCo = createCompany(db, { name: 'Old Co' })
      const newCo = createCompany(db, { name: 'New Co' })
      const person = createPerson(db, { name: 'Mover' })

      const original = addAffiliation(db, { personId: person.id, companyId: oldCo.id, started: '2025-01-01', title: 'Engineer' })
      expect(original.ended).toBeNull()

      const moved = movePerson(db, person.id, newCo.id, { on: '2026-06-01' })
      expect(moved.companyId).toBe(newCo.id)
      expect(moved.ended).toBeNull()
      expect(moved.started).toBe('2026-06-01')

      const detail = getPerson(db, person.id)
      expect(detail?.affiliations).toHaveLength(2)

      const oldRow = detail?.affiliations.find((a) => a.id === original.id)
      const newRow = detail?.affiliations.find((a) => a.id === moved.id)
      expect(oldRow?.ended).toBe('2026-06-01')
      expect(oldRow?.current).toBe(false)
      expect(newRow?.ended).toBeNull()
      expect(newRow?.current).toBe(true)
    })
  })

  it('forcing a failure on the insert half (a nonexistent destination company) leaves the old affiliation still open — no half-applied move', () => {
    withDatabase((db) => {
      const oldCo = createCompany(db, { name: 'Old Co 2' })
      const person = createPerson(db, { name: 'Mover 2' })
      const original = addAffiliation(db, { personId: person.id, companyId: oldCo.id, started: '2025-01-01' })

      let thrown: unknown
      try {
        movePerson(db, person.id, randomUUID(), { on: '2026-06-01' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)

      const affiliations = listAffiliationsForPerson(db, person.id)
      expect(affiliations).toHaveLength(1)
      expect(affiliations[0].id).toBe(original.id)
      expect(affiliations[0].ended).toBeNull()
      expect(affiliations[0].updatedAt).toBe(original.updatedAt)
    })
  })

  it('movePerson throws NotFoundError for a person that does not exist, and creates no affiliation row', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Some Co' })
      expect(() => movePerson(db, randomUUID(), co.id, { on: '2026-01-01' })).toThrow(NotFoundError)
      expect(listAffiliationsForCompany(db, co.id)).toHaveLength(0)
    })
  })

  it('a person with no prior affiliation can still be moved — the first assignment', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'First Co' })
      const person = createPerson(db, { name: 'Newcomer' })
      const result = movePerson(db, person.id, co.id, { on: '2026-01-01' })
      expect(result.companyId).toBe(co.id)
      expect(listAffiliationsForPerson(db, person.id)).toHaveLength(1)
    })
  })
})

describe('the same person affiliated to the same company twice', () => {
  it('left and returned: both rows are accepted and come back in started order', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Boomerang Co' })
      const person = createPerson(db, { name: 'Boomerang Person' })

      const first = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2020-01-01', ended: '2021-06-01' })
      const second = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2024-03-01' })

      const rows = listAffiliationsForPerson(db, person.id)
      expect(rows.map((r) => r.id)).toEqual([first.id, second.id])
      expect(rows[0].ended).toBe('2021-06-01')
      expect(rows[1].ended).toBeNull()
    })
  })
})

describe('is_primary: setting one clears the others at the same company', () => {
  it('addAffiliation with isPrimary:true clears is_primary on the other affiliation at that company', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Multi-Contact Co' })
      const personA = createPerson(db, { name: 'Contact A' })
      const personB = createPerson(db, { name: 'Contact B' })

      const affA = addAffiliation(db, { personId: personA.id, companyId: co.id, started: '2025-01-01', isPrimary: true })
      expect(affA.isPrimary).toBe(true)

      const affB = addAffiliation(db, { personId: personB.id, companyId: co.id, started: '2025-06-01', isPrimary: true })
      expect(affB.isPrimary).toBe(true)

      const rows = listAffiliationsForCompany(db, co.id)
      const reloadedA = rows.find((r) => r.id === affA.id)
      expect(reloadedA?.isPrimary).toBe(false)
      expect(reloadedA?.updatedAt).not.toBe(affA.updatedAt)
    })
  })

  it('updateAffiliation with isPrimary:true clears is_primary on the other affiliation at that company', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Multi-Contact Co 2' })
      const personA = createPerson(db, { name: 'Contact C' })
      const personB = createPerson(db, { name: 'Contact D' })

      const affA = addAffiliation(db, { personId: personA.id, companyId: co.id, started: '2025-01-01', isPrimary: true })
      const affB = addAffiliation(db, { personId: personB.id, companyId: co.id, started: '2025-06-01' })

      const updatedB = updateAffiliation(db, affB.id, { isPrimary: true })
      expect(updatedB.isPrimary).toBe(true)

      const reloadedA = listAffiliationsForCompany(db, co.id).find((r) => r.id === affA.id)
      expect(reloadedA?.isPrimary).toBe(false)
    })
  })

  it('does not clear is_primary at a different company', () => {
    withDatabase((db) => {
      const coX = createCompany(db, { name: 'Co X' })
      const coY = createCompany(db, { name: 'Co Y' })
      const personA = createPerson(db, { name: 'Contact E' })
      const personB = createPerson(db, { name: 'Contact F' })

      const affX = addAffiliation(db, { personId: personA.id, companyId: coX.id, started: '2025-01-01', isPrimary: true })
      addAffiliation(db, { personId: personB.id, companyId: coY.id, started: '2025-01-01', isPrimary: true })

      const reloadedX = listAffiliationsForCompany(db, coX.id).find((r) => r.id === affX.id)
      expect(reloadedX?.isPrimary).toBe(true)
    })
  })
})

describe('endAffiliation', () => {
  it('sets ended and leaves the affiliation otherwise unchanged', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'End Co' })
      const person = createPerson(db, { name: 'End Person' })
      const affiliation = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2025-01-01', title: 'Engineer' })

      const ended = endAffiliation(db, affiliation.id, '2026-01-01')
      expect(ended.ended).toBe('2026-01-01')
      expect(ended.title).toBe('Engineer')
    })
  })

  it('rejects an endedOn before the affiliation started, and leaves the row unchanged', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Backwards Co' })
      const person = createPerson(db, { name: 'Backwards Person' })
      const affiliation = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2025-06-01' })

      let thrown: unknown
      try {
        endAffiliation(db, affiliation.id, '2025-01-01')
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('ended-before-started')

      const rows = listAffiliationsForPerson(db, person.id)
      expect(rows[0].ended).toBeNull()
    })
  })
})

describe('deletePerson: referential refusals', () => {
  it('refuses to delete a person with activity rows, naming the count; the person survives', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Active Person' })
      insertActivityForPerson(db, person.id)

      let thrown: unknown
      try {
        deletePerson(db, person.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).message).toContain('1 activity record')
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'activity', count: 1 })
      expect(getPerson(db, person.id)).not.toBeNull()
    })
  })

  it('refuses to delete a person referenced by an affiliation; the person survives', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Blocking Co' })
      const person = createPerson(db, { name: 'Affiliated Person' })
      addAffiliation(db, { personId: person.id, companyId: co.id, started: '2025-01-01' })

      let thrown: unknown
      try {
        deletePerson(db, person.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'affiliations', count: 1 })
      expect(getPerson(db, person.id)).not.toBeNull()
    })
  })

  it('refuses to delete a person referenced by a task; the person survives', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Tasked Person' })
      insertTaskForPerson(db, person.id)

      let thrown: unknown
      try {
        deletePerson(db, person.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'tasks', count: 1 })
      expect(getPerson(db, person.id)).not.toBeNull()
    })
  })

  it('deletes cleanly when nothing blocks it', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Deletable Person' })
      deletePerson(db, person.id)
      expect(getPerson(db, person.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => deletePerson(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

describe('started and ended: dateOnlySchema, not a hand-rolled check', () => {
  it("addAffiliation rejects started: '2026-8-1'", () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Bad Date Co' })
      const person = createPerson(db, { name: 'Bad Date Person' })
      expect(() => addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-8-1' })).toThrow(ValidationError)
    })
  })

  it("addAffiliation rejects ended: '2026-8-1'", () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Bad End Date Co' })
      const person = createPerson(db, { name: 'Bad End Date Person' })
      expect(() =>
        addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-01-01', ended: '2026-8-1' })
      ).toThrow(ValidationError)
    })
  })

  it("endAffiliation rejects '2026-8-1'", () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Bad End2 Co' })
      const person = createPerson(db, { name: 'Bad End2 Person' })
      const affiliation = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-01-01' })
      expect(() => endAffiliation(db, affiliation.id, '2026-8-1')).toThrow(ValidationError)
    })
  })

  it("accepts '2026-08-01'", () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Good Date Co' })
      const person = createPerson(db, { name: 'Good Date Person' })
      const affiliation = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-08-01' })
      expect(affiliation.started).toBe('2026-08-01')
    })
  })
})

describe('affiliations timestamps and ids (ADR-002: not exempt from the UUID rule)', () => {
  it('assigns a UUID id and equal created_at/updated_at on create; a later update moves updated_at', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'))
      withDatabase((db) => {
        const co = createCompany(db, { name: 'Time Co' })
        const person = createPerson(db, { name: 'Time Person' })
        const created = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-01-01' })
        expect(created.id).toMatch(UUID_PATTERN)
        expect(created.createdAt).toBe('2026-08-28T10:00:00.000Z')
        expect(created.updatedAt).toBe('2026-08-28T10:00:00.000Z')

        vi.setSystemTime(new Date('2026-08-28T10:05:00.000Z'))
        const updated = updateAffiliation(db, created.id, { title: 'VP Engineering' })
        expect(updated.createdAt).toBe(created.createdAt)
        expect(updated.updatedAt).toBe('2026-08-28T10:05:00.000Z')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('addAffiliation input validation', () => {
  it('rejects an unknown field name', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Typo Co' })
      const person = createPerson(db, { name: 'Typo Person' })
      expect(() => addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-01-01', ttile: 'Oops' })).toThrow(
        ValidationError
      )
    })
  })

  it('rejects a write referencing a company that does not exist', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Orphan Person' })
      let thrown: unknown
      try {
        addAffiliation(db, { personId: person.id, companyId: randomUUID(), started: '2026-01-01' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
    })
  })

  it('updateAffiliation rejects a personId/companyId in the patch — the pair is fixed at creation, not patchable', () => {
    withDatabase((db) => {
      const co = createCompany(db, { name: 'Fixed Pair Co' })
      const person = createPerson(db, { name: 'Fixed Pair Person' })
      const affiliation = addAffiliation(db, { personId: person.id, companyId: co.id, started: '2026-01-01' })
      expect(() => updateAffiliation(db, affiliation.id, { companyId: randomUUID() })).toThrow(ValidationError)
    })
  })
})
