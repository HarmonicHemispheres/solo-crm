import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { createCompany } from './companies'
import { createEngagement, deleteEngagement } from './engagements'
import {
  completeMilestone,
  createMilestone,
  deleteMilestone,
  getMilestone,
  listMilestones,
  reorderMilestones,
  sumMilestoneAmounts,
  uncompleteMilestone,
  updateMilestone
} from './milestones'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import { milestoneSchema, milestoneSumSchema } from '../../../shared/milestones'
import { timestampSchema } from '../../../shared/types'

/**
 * T-260902-02 (P3-04): the `milestones` repository, against a real database
 * through `openDatabase`, the same as every sibling repository test.
 * `listMilestones` moved here from `engagements.ts` with this task; its
 * ordering tests stayed in `engagements.test.ts`, which imports it from
 * here, and this file exercises it for the order `reorderMilestones`
 * produces.
 */

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-milestones-repo-'))
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** A fixed-scope engagement to hang milestones on — the model they exist for. */
function fixedScope(db: Database.Database, contractValueCents = 1_800_000): string {
  const company = createCompany(db, { name: 'Milestone Co' })
  return createEngagement(db, {
    name: 'AI Agent Build',
    billingCompanyId: company.id,
    clientCompanyId: company.id,
    billingModel: 'fixed',
    contractValueCents,
    startedOn: '2026-09-01'
  }).id
}

describe('createMilestone', () => {
  it('writes name, amount and month, appends after the last sort, and reads back through the wire schema', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const first = createMilestone(db, { engagementId, name: 'Discovery', amountCents: 600_000, expectedMonth: '2026-09-01' })
      const second = createMilestone(db, { engagementId, name: 'Build', amountCents: 900_000, expectedMonth: '2026-10-01' })

      expect(() => milestoneSchema.parse(first)).not.toThrow()
      expect(first).toMatchObject({ engagementId, name: 'Discovery', amountCents: 600_000, expectedMonth: '2026-09-01', sort: 0, completedAt: null })
      expect(second.sort).toBe(1)
      expect(() => timestampSchema.parse(first.createdAt)).not.toThrow()
      expect(getMilestone(db, first.id)).toEqual(first)
    })
  })

  it('takes an explicit sort when one is given', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const row = createMilestone(db, { engagementId, name: 'Launch', amountCents: 1, expectedMonth: '2026-12-01', sort: 7 })
      expect(row.sort).toBe(7)
    })
  })

  it('requires all three of name, amount and month — a milestone the generator cannot recognise is refused', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      expect(() => createMilestone(db, { engagementId, amountCents: 1, expectedMonth: '2026-09-01' })).toThrow(ValidationError)
      expect(() => createMilestone(db, { engagementId, name: 'X', expectedMonth: '2026-09-01' })).toThrow(ValidationError)
      expect(() => createMilestone(db, { engagementId, name: 'X', amountCents: 1 })).toThrow(ValidationError)
      // CONVENTIONS.md: integer cents, first-of-month.
      expect(() => createMilestone(db, { engagementId, name: 'X', amountCents: 10.5, expectedMonth: '2026-09-01' })).toThrow(ValidationError)
      expect(() => createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-15' })).toThrow(ValidationError)
      expect(() => createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-01', extra: 1 })).toThrow(ValidationError)
    })
  })

  it('refuses an engagement that does not exist, as a RefusalError from the foreign key', () => {
    withDatabase((db) => {
      expect(() => createMilestone(db, { engagementId: 'nope', name: 'X', amountCents: 1, expectedMonth: '2026-09-01' })).toThrow(RefusalError)
    })
  })
})

describe('sumMilestoneAmounts', () => {
  it('is the contract value when three milestones add up to it, and not when they do not', () => {
    withDatabase((db) => {
      const contract = 1_800_000
      const adding = fixedScope(db, contract)
      createMilestone(db, { engagementId: adding, name: 'A', amountCents: 600_000, expectedMonth: '2026-09-01' })
      createMilestone(db, { engagementId: adding, name: 'B', amountCents: 600_000, expectedMonth: '2026-10-01' })
      createMilestone(db, { engagementId: adding, name: 'C', amountCents: 600_000, expectedMonth: '2026-11-01' })
      const sum = sumMilestoneAmounts(db, { engagementId: adding })
      expect(() => milestoneSumSchema.parse(sum)).not.toThrow()
      expect(sum).toEqual({ engagementId: adding, totalCents: contract, count: 3 })

      const short = fixedScope(db, contract)
      createMilestone(db, { engagementId: short, name: 'A', amountCents: 500_000, expectedMonth: '2026-09-01' })
      createMilestone(db, { engagementId: short, name: 'B', amountCents: 500_000, expectedMonth: '2026-10-01' })
      createMilestone(db, { engagementId: short, name: 'C', amountCents: 500_000, expectedMonth: '2026-11-01' })
      expect(sumMilestoneAmounts(db, { engagementId: short }).totalCents).toBe(1_500_000)
      expect(sumMilestoneAmounts(db, { engagementId: short }).totalCents).not.toBe(contract)
    })
  })

  it('answers 0 with count 0 for an engagement with no milestones, and ignores a NULL amount', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      expect(sumMilestoneAmounts(db, { engagementId })).toEqual({ engagementId, totalCents: 0, count: 0 })
      // A pre-task row with no amount (the column is nullable).
      db.prepare('INSERT INTO milestones (id, engagement_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'legacy',
        engagementId,
        'Legacy',
        '2026-01-01T00:00:00.000Z',
        '2026-01-01T00:00:00.000Z'
      )
      createMilestone(db, { engagementId, name: 'Real', amountCents: 250, expectedMonth: '2026-09-01' })
      expect(sumMilestoneAmounts(db, { engagementId })).toEqual({ engagementId, totalCents: 250, count: 2 })
    })
  })
})

describe('updateMilestone', () => {
  it('patches only the named fields and leaves the rest as they were', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const row = createMilestone(db, { engagementId, name: 'Discovery', amountCents: 600_000, expectedMonth: '2026-09-01' })
      const patched = updateMilestone(db, row.id, { amountCents: 650_000 })
      expect(patched).toMatchObject({ name: 'Discovery', amountCents: 650_000, expectedMonth: '2026-09-01', sort: 0 })
      // LESSONS.md 13: an absent key must not NULL the column.
      expect(updateMilestone(db, row.id, { name: 'Kick-off' })).toMatchObject({ name: 'Kick-off', amountCents: 650_000 })
      expect(updateMilestone(db, row.id, { amountCents: undefined, expectedMonth: '2026-10-01' })).toMatchObject({
        amountCents: 650_000,
        expectedMonth: '2026-10-01'
      })
    })
  })

  it('refuses sort, completedAt and engagementId as patch keys — each has its own operation or none', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const row = createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-01' })
      expect(() => updateMilestone(db, row.id, { sort: 3 })).toThrow(ValidationError)
      expect(() => updateMilestone(db, row.id, { completedAt: '2026-09-01T00:00:00.000Z' })).toThrow(ValidationError)
      expect(() => updateMilestone(db, row.id, { engagementId: 'other' })).toThrow(ValidationError)
    })
  })

  it('throws NotFoundError for an unknown id', () => {
    withDatabase((db) => {
      expect(() => updateMilestone(db, 'missing', { name: 'X' })).toThrow(NotFoundError)
    })
  })
})

describe('completeMilestone / uncompleteMilestone', () => {
  it('completing stamps completed_at as a timestamp; uncompleting clears it', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const row = createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-01' })
      const done = completeMilestone(db, row.id)
      expect(done.completedAt).not.toBeNull()
      expect(() => timestampSchema.parse(done.completedAt)).not.toThrow()

      // Completing again keeps the first stamp — the first completion is the
      // fact — and writes nothing: a same-millisecond re-stamp would leave
      // `completedAt` equal by accident, so `updatedAt` is what proves it.
      db.prepare('UPDATE milestones SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', row.id)
      const again = completeMilestone(db, row.id)
      expect(again.completedAt).toBe(done.completedAt)
      expect(again.updatedAt).toBe('2020-01-01T00:00:00.000Z')

      const undone = uncompleteMilestone(db, row.id)
      expect(undone.completedAt).toBeNull()
      expect(undone.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
      db.prepare('UPDATE milestones SET updated_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', row.id)
      expect(uncompleteMilestone(db, row.id).updatedAt).toBe('2020-01-01T00:00:00.000Z')
    })
  })

  it('throws NotFoundError for an unknown id', () => {
    withDatabase((db) => {
      expect(() => completeMilestone(db, 'missing')).toThrow(NotFoundError)
      expect(() => uncompleteMilestone(db, 'missing')).toThrow(NotFoundError)
    })
  })
})

describe('reorderMilestones', () => {
  it('writes sort = position for the ids named, returns the new order, and touches no other row', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const a = createMilestone(db, { engagementId, name: 'A', amountCents: 1, expectedMonth: '2026-09-01' })
      const b = createMilestone(db, { engagementId, name: 'B', amountCents: 1, expectedMonth: '2026-10-01' })
      const c = createMilestone(db, { engagementId, name: 'C', amountCents: 1, expectedMonth: '2026-11-01' })
      // An unrelated engagement's milestone keeps its sort untouched.
      const other = fixedScope(db)
      const o = createMilestone(db, { engagementId: other, name: 'O', amountCents: 1, expectedMonth: '2026-09-01', sort: 42 })

      const reordered = reorderMilestones(db, { engagementId, ids: [c.id, a.id, b.id] })
      expect(reordered.map((m) => m.name)).toEqual(['C', 'A', 'B'])
      expect(reordered.map((m) => m.sort)).toEqual([0, 1, 2])
      expect(listMilestones(db, engagementId).map((m) => m.id)).toEqual([c.id, a.id, b.id])
      expect(getMilestone(db, o.id)?.sort).toBe(42)
      expect(getMilestone(db, o.id)?.updatedAt).toBe(o.updatedAt)
    })
  })

  it('refuses a partial order — every milestone of the engagement must be named — and moves nothing', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const a = createMilestone(db, { engagementId, name: 'A', amountCents: 1, expectedMonth: '2026-09-01' })
      const b = createMilestone(db, { engagementId, name: 'B', amountCents: 1, expectedMonth: '2026-10-01' })
      const c = createMilestone(db, { engagementId, name: 'C', amountCents: 1, expectedMonth: '2026-11-01' })
      // Review: a subset could set C to 0 beside A's 0, and `created_at`
      // would still list A first — the caller asked for C first and would
      // not get it. So a subset is refused rather than half-honoured.
      expect(() => reorderMilestones(db, { engagementId, ids: [c.id] })).toThrow(RefusalError)
      expect(listMilestones(db, engagementId).map((m) => m.id)).toEqual([a.id, b.id, c.id])
      expect(getMilestone(db, c.id)?.sort).toBe(2)
    })
  })

  it("refuses, before writing anything, an id that is not this engagement's milestone, and a duplicate id", () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const a = createMilestone(db, { engagementId, name: 'A', amountCents: 1, expectedMonth: '2026-09-01' })
      const b = createMilestone(db, { engagementId, name: 'B', amountCents: 1, expectedMonth: '2026-10-01' })
      const other = fixedScope(db)
      const o = createMilestone(db, { engagementId: other, name: 'O', amountCents: 1, expectedMonth: '2026-09-01' })

      expect(() => reorderMilestones(db, { engagementId, ids: [b.id, o.id, a.id] })).toThrow(RefusalError)
      expect(() => reorderMilestones(db, { engagementId, ids: [b.id, 'missing'] })).toThrow(RefusalError)
      expect(() => reorderMilestones(db, { engagementId, ids: [b.id, b.id] })).toThrow(RefusalError)
      // Nothing moved.
      expect(listMilestones(db, engagementId).map((m) => m.id)).toEqual([a.id, b.id])
      expect(getMilestone(db, b.id)?.sort).toBe(1)
    })
  })
})

describe('deleteMilestone', () => {
  it('removes the row; a second delete is NotFoundError', () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      const row = createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-01' })
      deleteMilestone(db, row.id)
      expect(getMilestone(db, row.id)).toBeNull()
      expect(() => deleteMilestone(db, row.id)).toThrow(NotFoundError)
    })
  })

  it("an engagement with milestones still cannot be deleted — engagements.ts's pre-check is unchanged", () => {
    withDatabase((db) => {
      const engagementId = fixedScope(db)
      createMilestone(db, { engagementId, name: 'X', amountCents: 1, expectedMonth: '2026-09-01' })
      expect(() => deleteEngagement(db, engagementId)).toThrow(RefusalError)
    })
  })
})
