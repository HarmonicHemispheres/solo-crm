import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_CHAIN_DEPTH } from '../chain-walk'
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

/**
 * Raw inserts into the other tables migration 0001 gives a foreign key at
 * `companies.id` — every one of `deleteCompany`'s eight blockers needs a
 * fixture row in the table it guards, and each of those repositories is a
 * separate, not-yet-built task (T-260828-21..25), so these are the
 * RESTRICT-blocker fixtures for *this* task's tests, not a claim about any
 * of those repositories' future APIs.
 */
function insertActivity(db: Database.Database, companyId: string): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), now, 'note', 'Touch', null, companyId, null, null, 'manual', now, now)
}

function insertEngagement(
  db: Database.Database,
  fields: { readonly billingCompanyId?: string; readonly clientCompanyId?: string }
): void {
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO engagements (id, name, billing_company_id, client_company_id, started_on, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), 'Engagement', fields.billingCompanyId ?? null, fields.clientCompanyId ?? null, '2026-01-01', now, now)
}

function insertTask(db: Database.Database, companyId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO tasks (id, title, company_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    randomUUID(),
    'Follow up',
    companyId,
    now,
    now
  )
}

function insertAffiliation(db: Database.Database, companyId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO affiliations (id, company_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    companyId,
    now,
    now
  )
}

function insertTimeEntry(db: Database.Database, companyId: string): void {
  const now = nowTimestamp()
  db.prepare('INSERT INTO time_entries (id, company_id, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
    randomUUID(),
    companyId,
    now,
    now
  )
}

describe('createCompany / getCompany: round-trip', () => {
  it('round-trips all fourteen columns field-for-field — ten writable, plus id/createdAt/updatedAt/lastTouchAt', () => {
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
      expect(created.budgetNote).toBe(input.budgetNote)
      expect(created.notes).toBe(input.notes)
      expect(created.since).toBe(input.since)
      expect(created.createdAt).toEqual(created.updatedAt)
      // lastTouchAt is not writable here (ADR-001: owned by the activity
      // repository) — a company with no touch history reads null.
      expect(created.lastTouchAt).toBeNull()
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

  it('applies the documented defaults when the caller passes explicit undefined, not just when the key is absent', () => {
    withDatabase((db) => {
      // The renderer's natural patch shape is `{ field: dirty ? value :
      // undefined }` — the key is present, its value is `undefined`.
      // Electron's structured clone preserves that key across the IPC
      // boundary. Without stripping undefined-valued keys after parsing,
      // `'billsDirectly' in parsed` is true here, CREATE_DEFAULTS is
      // bypassed, and better-sqlite3 binds `undefined` as NULL — a NULL
      // `cadence_days` makes ADR-001's staleness predicate evaluate to NULL,
      // so the client silently never reads stale.
      const created = createCompany(db, { name: 'Explicit Undefined Co', billsDirectly: undefined, cadenceDays: undefined })
      expect(created.billsDirectly).toBe(true)
      expect(created.cadenceDays).toBe(14)
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

  it('a patch with an explicit undefined-valued key leaves the column untouched, same as an absent key', () => {
    withDatabase((db) => {
      const created = createCompany(db, { name: 'Undefined Patch Co', billsDirectly: false })
      expect(created.billsDirectly).toBe(false)

      // The key is present on the object — `'billsDirectly' in patch` is
      // true — but its value is `undefined`. Before this fix that made
      // updateCompany bind NULL for the column; the correct behaviour is
      // identical to omitting the key.
      const updated = updateCompany(db, created.id, { billsDirectly: undefined, notes: 'unrelated change' })
      expect(updated.billsDirectly).toBe(false)
      expect(updated.notes).toBe('unrelated change')
    })
  })

  it('an explicit billsDirectly:false actually flips a company that was true', () => {
    withDatabase((db) => {
      const created = createCompany(db, { name: 'Flips Co' })
      expect(created.billsDirectly).toBe(true)

      const updated = updateCompany(db, created.id, { billsDirectly: false })
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
      expect((thrown as RefusalError).blocker?.reason).toBe('self-reference')

      const after = getCompany(db, company.id)
      expect(after?.billedViaCompanyId).toBeNull()
    })
  })
})

/**
 * T-260828-42 — the database CHECK above blocks only a *direct*
 * self-reference; a two-step cycle (A billed via B, B billed via A) passes
 * it. These guards run in the repository, before the write, using the same
 * `walkChain` traversal `seed/index.ts`'s `orderCompaniesForInsert` uses
 * (`../chain-walk`).
 */
describe('the billed-via / introduced-by transitive cycle guard (T-260828-42)', () => {
  it('refuses the exact sequence review reproduced — create B billed via A, then update A billed via B — naming both companies', () => {
    withDatabase((db) => {
      const a = createCompany(db, { name: 'Company A' })
      const b = createCompany(db, { name: 'Company B', billedViaCompanyId: a.id })

      let thrown: unknown
      try {
        updateCompany(db, a.id, { billedViaCompanyId: b.id })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      const refusal = thrown as RefusalError
      expect(refusal.message).toContain('Company A')
      expect(refusal.message).toContain('Company B')
      // A blocker discriminator, not just a message.
      expect(refusal.blocker?.reason).toBe('billed-via-cycle')

      // A refused write leaves the row unchanged.
      const after = getCompany(db, a.id)
      expect(after?.billedViaCompanyId).toBeNull()
    })
  })

  it('refuses a three-company cycle A -> B -> C -> A at the closing edge', () => {
    withDatabase((db) => {
      const a = createCompany(db, { name: 'Company A' })
      const b = createCompany(db, { name: 'Company B', billedViaCompanyId: a.id })
      const c = createCompany(db, { name: 'Company C', billedViaCompanyId: b.id })

      expect(() => updateCompany(db, a.id, { billedViaCompanyId: c.id })).toThrow(RefusalError)

      const after = getCompany(db, a.id)
      expect(after?.billedViaCompanyId).toBeNull()
    })
  })

  it('accepts a legitimate chain A -> B -> C with no cycle', () => {
    withDatabase((db) => {
      const a = createCompany(db, { name: 'Company A' })
      const b = createCompany(db, { name: 'Company B', billedViaCompanyId: a.id })
      const c = createCompany(db, { name: 'Company C', billedViaCompanyId: b.id })

      expect(b.billedViaCompanyId).toBe(a.id)
      expect(c.billedViaCompanyId).toBe(b.id)

      // A further, unrelated legitimate update on the chain's root still
      // goes through — the guard only refuses when the chain would loop.
      const renamed = updateCompany(db, a.id, { notes: 'renamed' })
      expect(renamed.notes).toBe('renamed')
    })
  })

  it('guards introduced_by_company_id via the same code path, asserted separately from billed_via_company_id', () => {
    withDatabase((db) => {
      const a = createCompany(db, { name: 'Referrer A' })
      const b = createCompany(db, { name: 'Referred B', introducedByCompanyId: a.id })

      let thrown: unknown
      try {
        updateCompany(db, a.id, { introducedByCompanyId: b.id })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      const refusal = thrown as RefusalError
      expect(refusal.message).toContain('Referrer A')
      expect(refusal.message).toContain('Referred B')
      expect(refusal.blocker?.reason).toBe('introduced-by-cycle')

      const after = getCompany(db, a.id)
      expect(after?.introducedByCompanyId).toBeNull()
    })
  })

  it('refuses introduced_by_company_id set to the row\'s own id — no database CHECK covers this column at all', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Self Referred Co' })

      let thrown: unknown
      try {
        updateCompany(db, company.id, { introducedByCompanyId: company.id })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      // Its own discriminator, distinct from the transitive-cycle one above
      // (T-260828-56) — "you pointed this row at itself" and "this would
      // close a loop through other rows" are different facts.
      expect((thrown as RefusalError).blocker?.reason).toBe('introduced-by-self-reference')

      const after = getCompany(db, company.id)
      expect(after?.introducedByCompanyId).toBeNull()
    })
  })

  it("refuses createCompany's introduced_by target whose existing chain already loops — the create-path guard, not the update-path one", () => {
    withDatabase((db) => {
      // Covers `createCompany`'s `introducedByCompanyId` guard call
      // specifically: delete that one line and this is the test that fails.
      // A fresh row's own id cannot be reached by any existing chain, so the
      // only thing the create-path guard can catch is a chain that was
      // already bad — wired raw here, bypassing the repository entirely.
      const timestamp = nowTimestamp()
      const ids = [randomUUID(), randomUUID()]
      const insert = db.prepare(
        `INSERT INTO companies (id, name, bills_directly, cadence_days, created_at, updated_at) VALUES (?, ?, 1, 14, ?, ?)`
      )
      for (let i = 0; i < ids.length; i += 1) {
        insert.run(ids[i], `Referral Loop ${i}`, timestamp, timestamp)
      }
      const setIntroducedBy = db.prepare('UPDATE companies SET introduced_by_company_id = ? WHERE id = ?')
      setIntroducedBy.run(ids[1], ids[0])
      setIntroducedBy.run(ids[0], ids[1])

      let thrown: unknown
      try {
        createCompany(db, { name: 'New Referred Co', introducedByCompanyId: ids[0] })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('introduced-by-chain-cycle')
      // The refused create wrote nothing.
      expect(listCompanies(db).map((company) => company.name)).not.toContain('New Referred Co')
    })
  })

  it("refuses createCompany's billed_via target whose existing chain already loops — the create-path guard for that column", () => {
    withDatabase((db) => {
      // The billed-via twin of the case above, for the same reason: delete
      // `createCompany`'s `billedViaCompanyId` guard call and this fails.
      const timestamp = nowTimestamp()
      const ids = [randomUUID(), randomUUID()]
      const insert = db.prepare(
        `INSERT INTO companies (id, name, bills_directly, cadence_days, created_at, updated_at) VALUES (?, ?, 1, 14, ?, ?)`
      )
      for (let i = 0; i < ids.length; i += 1) {
        insert.run(ids[i], `Billing Loop ${i}`, timestamp, timestamp)
      }
      const setBilledVia = db.prepare('UPDATE companies SET billed_via_company_id = ? WHERE id = ?')
      setBilledVia.run(ids[1], ids[0])
      setBilledVia.run(ids[0], ids[1])

      let thrown: unknown
      try {
        createCompany(db, { name: 'New Billed Co', billedViaCompanyId: ids[0] })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('billed-via-chain-cycle')
      expect(listCompanies(db).map((company) => company.name)).not.toContain('New Billed Co')
    })
  })

  it('does not hang on a database that already contains a billed-via cycle — the walk is bounded and refuses as a CYCLE, not as depth exceeded', () => {
    withDatabase((db) => {
      // Simulates data that predates this guard: three companies wired into
      // a raw cycle directly, bypassing createCompany/updateCompany
      // entirely, so nothing here could have refused it going in.
      const timestamp = nowTimestamp()
      const ids = [randomUUID(), randomUUID(), randomUUID()]
      const insert = db.prepare(
        `INSERT INTO companies (id, name, bills_directly, cadence_days, created_at, updated_at) VALUES (?, ?, 1, 14, ?, ?)`
      )
      for (let i = 0; i < ids.length; i += 1) {
        insert.run(ids[i], `Cyclic ${i}`, timestamp, timestamp)
      }
      const setBilledVia = db.prepare('UPDATE companies SET billed_via_company_id = ? WHERE id = ?')
      setBilledVia.run(ids[1], ids[0])
      setBilledVia.run(ids[2], ids[1])
      setBilledVia.run(ids[0], ids[2])

      const start = Date.now()
      let thrown: unknown
      try {
        createCompany(db, { name: 'New Co', billedViaCompanyId: ids[0] })
      } catch (error) {
        thrown = error
      }
      const elapsedMs = Date.now() - start

      expect(thrown).toBeInstanceOf(RefusalError)
      // T-260828-56: this walk closes a 3-cycle at step 3. Reporting it as
      // depth-exceeded told the operator their chain "already exceeds 50
      // steps", which is simply untrue about their data.
      expect((thrown as RefusalError).blocker?.reason).toBe('billed-via-chain-cycle')
      expect((thrown as RefusalError).message).not.toContain(String(MAX_CHAIN_DEPTH))
      expect((thrown as RefusalError).message).toMatch(/loops back on itself/)
      expect(elapsedMs).toBeLessThan(1000)
    })
  })

  it('does not hang on a database with a billed-via chain longer than the depth bound — refuses on depth exceeded', () => {
    withDatabase((db) => {
      // A raw, non-cyclic chain one link longer than the guard's bound
      // (`MAX_CHAIN_DEPTH`, `../chain-walk.ts`) — built with direct inserts,
      // not createCompany, since createCompany's own guard would refuse to
      // build a chain this deep in the first place. This proves the walk
      // itself is bounded, not merely that cycle detection is fast.
      const depth = MAX_CHAIN_DEPTH + 1
      const timestamp = nowTimestamp()
      const ids = Array.from({ length: depth }, () => randomUUID())
      const insert = db.prepare(
        `INSERT INTO companies (id, name, bills_directly, cadence_days, billed_via_company_id, created_at, updated_at) VALUES (?, ?, 1, 14, ?, ?, ?)`
      )
      for (let i = 0; i < ids.length; i += 1) {
        insert.run(ids[i], `Chain ${i}`, i === 0 ? null : ids[i - 1], timestamp, timestamp)
      }

      const start = Date.now()
      let thrown: unknown
      try {
        createCompany(db, { name: 'New Co', billedViaCompanyId: ids[ids.length - 1] })
      } catch (error) {
        thrown = error
      }
      const elapsedMs = Date.now() - start

      expect(thrown).toBeInstanceOf(RefusalError)
      // Asserted separately from the cycle case above, and deliberately the
      // other discriminator: this chain is long, not looping (T-260828-56).
      expect((thrown as RefusalError).blocker?.reason).toBe('billed-via-chain-depth-exceeded')
      expect((thrown as RefusalError).message).toContain(String(MAX_CHAIN_DEPTH))
      expect(elapsedMs).toBeLessThan(2000)
    })
  })
})

describe('deleteCompany: referential refusals — all eight foreign keys migration 0001 points at companies.id', () => {
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

  it('refuses to delete a company that bills an engagement; the row survives', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Engagement Biller' })
      insertEngagement(db, { billingCompanyId: company.id })

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'engagement-billing', count: 1 })
      expect(getCompany(db, company.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company that is the client on an engagement; the row survives', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Engagement Client' })
      insertEngagement(db, { clientCompanyId: company.id })

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'engagement-client', count: 1 })
      expect(getCompany(db, company.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company referenced by a task; the row survives', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Tasked Co' })
      insertTask(db, company.id)

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'tasks', count: 1 })
      expect(getCompany(db, company.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company referenced by an affiliation; the row survives', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Affiliated Co' })
      insertAffiliation(db, company.id)

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'affiliations', count: 1 })
      // Word-for-word `deletePerson`'s affiliation refusal (T-260828-46), and
      // deliberately no longer offering to "reassign": an affiliation's
      // person/company pair is fixed at creation, so the only route out is
      // `deleteAffiliation` — which exists, and is what "remove" means here.
      expect((thrown as RefusalError).message).toContain('Remove those affiliations before deleting this company')
      expect((thrown as RefusalError).message).not.toContain('Reassign')
      expect(getCompany(db, company.id)).not.toBeNull()
    })
  })

  it('refuses to delete a company referenced by a time entry; the row survives', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Timelogged Co' })
      insertTimeEntry(db, company.id)

      let thrown: unknown
      try {
        deleteCompany(db, company.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker).toEqual({ reason: 'time-entries', count: 1 })
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

  it('createCompany rejects an unknown field name', () => {
    withDatabase((db) => {
      expect(() => createCompany(db, { name: 'Typo Co', nmae: 'Typo Co' })).toThrow(ValidationError)
    })
  })

  it('updateCompany rejects a non-object patch', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Patch Co' })
      expect(() => updateCompany(db, company.id, 'not an object')).toThrow(ValidationError)
    })
  })

  it('updateCompany rejects an unknown field name instead of silently no-opping', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Rename Co' })

      // Before .strict(), a renamed/misspelled field was stripped silently:
      // the patch parsed to `{}`, updated_at still moved, and the caller got
      // back what looked like a saved change that changed nothing.
      expect(() => updateCompany(db, company.id, { nmae: 'typo' })).toThrow(ValidationError)

      const after = getCompany(db, company.id)
      expect(after?.name).toBe('Rename Co')
      expect(after?.updatedAt).toBe(company.updatedAt)
    })
  })

  it('updateCompany rejects an attempt to write lastTouchAt directly — ADR-001 reserves it for the activity repository', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Touch Co' })
      expect(() => updateCompany(db, company.id, { lastTouchAt: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)
    })
  })
})
