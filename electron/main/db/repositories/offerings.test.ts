import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { offeringCategorySchema, offeringListItemSchema, offeringWithVersionsSchema } from '../../../shared/offerings'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { seedFixture } from '../seed/index'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import {
  archiveOffering,
  assertNoOverlappingVersion,
  createOffering,
  createOfferingCategory,
  deleteOfferingCategory,
  duplicateOffering,
  getOffering,
  getOfferingCategory,
  listOfferingCategories,
  listOfferings,
  updateOffering,
  updateOfferingCategory
} from './offerings'

/**
 * Same real-database discipline as `companies.test.ts` and
 * `engagements.test.ts`: every test runs against a real, migrated database
 * opened through `openDatabase({ userDataDir })`, not a mock.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-offerings-repo-'))
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

/**
 * Guard-then-insert, exactly as `insertOfferingVersion` does it inside the
 * repository and exactly as P3-02's append will have to.
 * `insertOfferingVersion` itself is private (appending a *next* version is
 * P3-02's decision to make, not a surface this task ships), so the overlap
 * acceptance is exercised by doing the real thing to the real table rather
 * than by asserting the predicate in isolation: the insert genuinely runs
 * when the range is legal, and genuinely does not when it is not.
 */
function addVersion(
  db: Database.Database,
  offeringId: string,
  rateCents: number,
  effectiveFrom: string | null,
  effectiveTo: string | null
): void {
  assertNoOverlappingVersion(db, offeringId, effectiveFrom, effectiveTo)
  const now = nowTimestamp()
  const highest = (db.prepare('SELECT MAX(version) AS h FROM offering_versions WHERE offering_id = ?').get(offeringId) as {
    h: number | null
  }).h
  db.prepare(
    `INSERT INTO offering_versions (id, offering_id, version, rate_cents, effective_from, effective_to, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), offeringId, (highest ?? 0) + 1, rateCents, effectiveFrom, effectiveTo, now, now)
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

describe('offering categories', () => {
  it('creates a category with an id, timestamps and the shape electron/shared declares', () => {
    withDatabase((db) => {
      const category = createOfferingCategory(db, { name: 'Audits', color: '#C9A84C', sort: 0 })

      expect(category.id).toMatch(UUID_PATTERN)
      expect(category.name).toBe('Audits')
      expect(category.color).toBe('#C9A84C')
      expect(category.sort).toBe(0)
      expect(() => offeringCategorySchema.parse(category)).not.toThrow()
      expect(getOfferingCategory(db, category.id)).toEqual(category)
    })
  })

  it('renames a category and leaves the fields the patch does not mention alone', () => {
    withDatabase((db) => {
      const created = createOfferingCategory(db, { name: 'Audits', color: '#C9A84C', sort: 3 })
      const renamed = updateOfferingCategory(db, created.id, { name: 'Assessments' })

      expect(renamed.name).toBe('Assessments')
      expect(renamed.color).toBe('#C9A84C')
      expect(renamed.sort).toBe(3)
    })
  })

  it('distinguishes an explicit null from an absent key on update', () => {
    withDatabase((db) => {
      const created = createOfferingCategory(db, { name: 'Audits', color: '#C9A84C', sort: 3 })

      expect(updateOfferingCategory(db, created.id, { color: null }).color).toBeNull()
      // Explicitly-undefined must read as absent, not as "set it to null" —
      // input.ts's absent-vs-explicitly-undefined rule.
      expect(updateOfferingCategory(db, created.id, { sort: undefined }).sort).toBe(3)
    })
  })

  it('sorts by sort then name, with unsorted categories last', () => {
    withDatabase((db) => {
      createOfferingCategory(db, { name: 'Builds', sort: 1 })
      createOfferingCategory(db, { name: 'Audits', sort: 0 })
      createOfferingCategory(db, { name: 'Zephyr' })
      createOfferingCategory(db, { name: 'Advisory' })

      expect(listOfferingCategories(db).map((c) => c.name)).toEqual(['Audits', 'Builds', 'Advisory', 'Zephyr'])
    })
  })

  it('refuses to delete a category that holds an offering, naming the count, and deletes an empty one', () => {
    withDatabase((db) => {
      const held = createOfferingCategory(db, { name: 'Retainers' })
      const empty = createOfferingCategory(db, { name: 'Advisory' })
      createOffering(db, { name: 'Advisory Retainer', categoryId: held.id, rateCents: 650_000 })

      let refusal: unknown
      try {
        deleteOfferingCategory(db, held.id)
      } catch (error) {
        refusal = error
      }

      expect(refusal).toBeInstanceOf(RefusalError)
      expect((refusal as RefusalError).message).toContain('1 offering')
      expect((refusal as RefusalError).message).toContain('Advisory Retainer')
      expect((refusal as RefusalError).blocker).toEqual({ reason: 'offerings', count: 1 })
      expect(getOfferingCategory(db, held.id)).not.toBeNull()

      deleteOfferingCategory(db, empty.id)
      expect(getOfferingCategory(db, empty.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an unknown category id on update and delete', () => {
    withDatabase((db) => {
      expect(() => updateOfferingCategory(db, randomUUID(), { name: 'x' })).toThrow(NotFoundError)
      expect(() => deleteOfferingCategory(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

// ---------------------------------------------------------------------------
// Creating an offering
// ---------------------------------------------------------------------------

describe('createOffering', () => {
  it('creates the offering and its first version in one call', () => {
    withDatabase((db) => {
      const category = createOfferingCategory(db, { name: 'Audits' })
      const offering = createOffering(db, {
        name: 'Discovery Audit',
        type: 'service',
        categoryId: category.id,
        billingModel: 'fixed',
        unit: 'fixed',
        blurb: 'Map a business for automation opportunity.',
        rateCents: 450_000
      })

      expect(offering.id).toMatch(UUID_PATTERN)
      expect(offering.active).toBe(true)
      expect(offering.versions).toHaveLength(1)
      expect(offering.versions[0].version).toBe(1)
      expect(offering.versions[0].rateCents).toBe(450_000)
      expect(offering.versions[0].offeringId).toBe(offering.id)
      expect(() => offeringWithVersionsSchema.parse(offering)).not.toThrow()
    })
  })

  it('refuses an offering with no rate, names the missing rate, and leaves no row behind', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createOffering(db, { name: 'Rateless', type: 'service' })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toContain('rateCents')
      expect(count(db, 'offerings')).toBe(0)
      expect(count(db, 'offering_versions')).toBe(0)
    })
  })

  it('refuses a rate that is not integer cents, and still leaves no row behind', () => {
    withDatabase((db) => {
      expect(() => createOffering(db, { name: 'Floaty', rateCents: 4500.5 })).toThrow(ValidationError)
      expect(count(db, 'offerings')).toBe(0)
    })
  })

  it('refuses a type outside the shared tuple', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createOffering(db, { name: 'Widgetry', type: 'widget', rateCents: 1000 })
      } catch (error) {
        thrown = error
      }

      // The refusal comes from `OFFERING_TYPES` via zod at the repository
      // edge, not from a hand-written `if` — the message names the field and
      // the values the closed tuple accepts.
      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toContain('type')
      expect((thrown as ValidationError).message).toContain('service')
      expect(count(db, 'offerings')).toBe(0)
    })
  })

  it('refuses a billing model or unit outside their shared tuples', () => {
    withDatabase((db) => {
      // `equity` is a legal *engagement* billing model and an illegal
      // offering one — the two tuples are deliberately separate.
      expect(() => createOffering(db, { name: 'Equity thing', billingModel: 'equity', rateCents: 1000 })).toThrow(ValidationError)
      expect(() => createOffering(db, { name: 'Weekly thing', unit: 'wk', rateCents: 1000 })).toThrow(ValidationError)
      expect(count(db, 'offerings')).toBe(0)
    })
  })

  it('refuses a category id that does not exist, and rolls the offering back with it', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createOffering(db, { name: 'Orphan', categoryId: randomUUID(), rateCents: 1000 })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
      expect(count(db, 'offerings')).toBe(0)
      expect(count(db, 'offering_versions')).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Version ranges
// ---------------------------------------------------------------------------

describe('offering version effective ranges', () => {
  it('refuses two overlapping versions of one offering and accepts the same two ranges on two different offerings', () => {
    withDatabase((db) => {
      const a = createOffering(db, { name: 'Offering A', rateCents: 350_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' })
      const b = createOffering(db, { name: 'Offering B', rateCents: 350_000, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30' })

      // An actual insert attempt, not a prediction about one: the range
      // 2026-04-01..2026-09-30 straddles A's existing 2026-01-01..2026-06-30.
      let thrown: unknown
      try {
        addVersion(db, a.id, 450_000, '2026-04-01', '2026-09-30')
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('version-overlap')
      expect(getOffering(db, a.id)?.versions).toHaveLength(1)

      // Those same two ranges, held one per offering rather than both on one,
      // are accepted: the rule is scoped to a single offering, so two
      // offerings may perfectly well be priced over overlapping periods.
      const c = createOffering(db, { name: 'Offering C', rateCents: 450_000, effectiveFrom: '2026-04-01', effectiveTo: '2026-09-30' })
      expect(c.versions[0].effectiveFrom).toBe('2026-04-01')
      expect(getOffering(db, b.id)?.versions[0].effectiveFrom).toBe('2026-01-01')
    })
  })

  it('treats the range ends as inclusive, so consecutive versions abut without overlapping', () => {
    withDatabase((db) => {
      const offering = createOffering(db, {
        name: 'Discovery Audit',
        rateCents: 350_000,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30'
      })

      // The seed's own Discovery Audit pair: 01-01..06-30 then 07-01..open.
      addVersion(db, offering.id, 450_000, '2026-07-01', null)
      expect(getOffering(db, offering.id)?.versions).toHaveLength(2)

      // 06-30 is *inside* the first range, so a version starting there is not.
      expect(() => addVersion(db, offering.id, 500_000, '2026-06-30', null)).toThrow(RefusalError)
    })
  })

  it('treats a null end as unbounded, so a second open-ended version is refused', () => {
    withDatabase((db) => {
      const offering = createOffering(db, { name: 'Retainer', rateCents: 180_000, effectiveFrom: '2025-11-01' })
      expect(offering.versions[0].effectiveTo).toBeNull()

      expect(() => addVersion(db, offering.id, 260_000, '2026-07-01', null)).toThrow(RefusalError)
      expect(count(db, 'offering_versions')).toBe(1)
    })
  })

  it('treats a null start as unbounded in the other direction', () => {
    withDatabase((db) => {
      // The existing version runs 2026-07-01 onwards, open-ended.
      const offering = createOffering(db, { name: 'Retainer', rateCents: 180_000, effectiveFrom: '2026-07-01' })

      // A candidate with no start runs from the beginning of time, so one
      // ending after 2026-07-01 straddles the existing version.
      expect(() => addVersion(db, offering.id, 100_000, null, '2026-08-01')).toThrow(RefusalError)
      expect(count(db, 'offering_versions')).toBe(1)

      // Ending strictly before the existing version starts is legal.
      addVersion(db, offering.id, 100_000, null, '2026-06-30')
      expect(count(db, 'offering_versions')).toBe(2)
    })
  })

  it('reports the newest version first, so versions[0] is the current one', () => {
    withDatabase((db) => {
      const offering = createOffering(db, {
        name: 'Platform Advisory',
        rateCents: 16_500,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-07-31'
      })
      addVersion(db, offering.id, 18_500, '2026-08-01', null)

      const read = getOffering(db, offering.id)
      expect(read?.versions.map((v) => v.rateCents)).toEqual([18_500, 16_500])
      expect(listOfferings(db)[0].currentVersion?.rateCents).toBe(18_500)
    })
  })
})

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe('listOfferings', () => {
  it('joins the current version on, orders by name, and includes archived offerings by default', () => {
    withDatabase((db) => {
      const zed = createOffering(db, { name: 'Zed Product', type: 'product', rateCents: 25_000 })
      createOffering(db, { name: 'Alpha Service', type: 'service', rateCents: 450_000 })
      archiveOffering(db, zed.id)

      const listed = listOfferings(db)
      expect(listed.map((o) => o.name)).toEqual(['Alpha Service', 'Zed Product'])
      expect(listed[0].currentVersion?.rateCents).toBe(450_000)
      expect(listed[1].active).toBe(false)
      expect(() => offeringListItemSchema.parse(listed[0])).not.toThrow()
    })
  })

  it('filters by type, by category and by active', () => {
    withDatabase((db) => {
      const audits = createOfferingCategory(db, { name: 'Audits' })
      const products = createOfferingCategory(db, { name: 'Products' })
      createOffering(db, { name: 'Discovery Audit', type: 'service', categoryId: audits.id, rateCents: 450_000 })
      const kit = createOffering(db, { name: 'Agent Starter Kit', type: 'product', categoryId: products.id, rateCents: 75_000 })
      archiveOffering(db, kit.id)

      expect(listOfferings(db, { type: 'product' }).map((o) => o.name)).toEqual(['Agent Starter Kit'])
      expect(listOfferings(db, { categoryId: audits.id }).map((o) => o.name)).toEqual(['Discovery Audit'])
      expect(listOfferings(db, { active: true }).map((o) => o.name)).toEqual(['Discovery Audit'])
      expect(listOfferings(db, { active: false }).map((o) => o.name)).toEqual(['Agent Starter Kit'])
      expect(listOfferings(db, { type: 'service', categoryId: products.id })).toEqual([])
    })
  })

  it('rejects an unknown filter key rather than silently ignoring it', () => {
    withDatabase((db) => {
      expect(() => listOfferings(db, { categorySlug: 'audits' } as never)).toThrow(ValidationError)
    })
  })

  it('returns null from getOffering for an unknown id', () => {
    withDatabase((db) => {
      expect(getOffering(db, randomUUID())).toBeNull()
    })
  })
})

// ---------------------------------------------------------------------------
// Updating, archiving, duplicating
// ---------------------------------------------------------------------------

describe('updateOffering', () => {
  it('updates the non-price fields and leaves the versions alone', () => {
    withDatabase((db) => {
      const category = createOfferingCategory(db, { name: 'Builds' })
      const offering = createOffering(db, { name: 'Agent Build', type: 'service', rateCents: 1_800_000 })

      const updated = updateOffering(db, offering.id, {
        name: 'AI Agent Build',
        categoryId: category.id,
        billingModel: 'fixed',
        unit: 'from',
        blurb: 'Fixed-scope agent delivery against milestones.'
      })

      expect(updated.name).toBe('AI Agent Build')
      expect(updated.categoryId).toBe(category.id)
      expect(updated.unit).toBe('from')
      expect(updated.versions).toHaveLength(1)
      expect(updated.versions[0].rateCents).toBe(1_800_000)
      expect(updated.versions[0].id).toBe(offering.versions[0].id)
    })
  })

  it('rejects a rate on the update patch — changing a price is P3-02, not a field edit', () => {
    withDatabase((db) => {
      const offering = createOffering(db, { name: 'Discovery Audit', rateCents: 350_000 })

      let thrown: unknown
      try {
        updateOffering(db, offering.id, { rateCents: 450_000 })
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(ValidationError)
      expect((thrown as ValidationError).message).toContain('rateCents')
      expect(getOffering(db, offering.id)?.versions[0].rateCents).toBe(350_000)
    })
  })

  it('throws NotFoundError for an unknown id', () => {
    withDatabase((db) => {
      expect(() => updateOffering(db, randomUUID(), { name: 'x' })).toThrow(NotFoundError)
      expect(() => archiveOffering(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

describe('archiveOffering', () => {
  it('sets active = 0, keeps the row readable by id, and keeps it resolvable from an engagement', () => {
    withDatabase((db) => {
      const offering = createOffering(db, { name: 'Automation Playbook', type: 'product', rateCents: 25_000 })
      const versionId = offering.versions[0].id

      const now = nowTimestamp()
      const engagementId = randomUUID()
      db.prepare(
        `INSERT INTO engagements (id, name, offering_version_id, started_on, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(engagementId, 'Playbook licence', versionId, '2026-02-01', now, now)

      const archived = archiveOffering(db, offering.id)
      expect(archived.active).toBe(false)
      expect(count(db, 'offerings')).toBe(1)
      expect(count(db, 'offering_versions')).toBe(1)

      // Readable by id.
      expect(getOffering(db, offering.id)?.name).toBe('Automation Playbook')

      // And still resolvable from the engagement that names its version.
      const resolved = db
        .prepare(
          `SELECT o.name AS name, v.rate_cents AS rate_cents
           FROM engagements e
           JOIN offering_versions v ON v.id = e.offering_version_id
           JOIN offerings o ON o.id = v.offering_id
           WHERE e.id = ?`
        )
        .get(engagementId) as { name: string; rate_cents: number }
      expect(resolved).toEqual({ name: 'Automation Playbook', rate_cents: 25_000 })
    })
  })

  it('is idempotent', () => {
    withDatabase((db) => {
      const offering = createOffering(db, { name: 'Thing', rateCents: 1000 })
      archiveOffering(db, offering.id)
      expect(archiveOffering(db, offering.id).active).toBe(false)
    })
  })
})

describe('duplicateOffering', () => {
  it('produces a new id and a new first version at the current rate, leaving the original untouched', () => {
    withDatabase((db) => {
      const category = createOfferingCategory(db, { name: 'Retainers' })
      const original = createOffering(db, {
        name: 'Embedded Development Retainer',
        type: 'service',
        categoryId: category.id,
        billingModel: 'retainer',
        unit: 'mo',
        blurb: 'Ongoing engineering capacity.',
        rateCents: 180_000,
        effectiveFrom: '2025-11-01',
        effectiveTo: '2026-06-30'
      })
      addVersion(db, original.id, 260_000, '2026-07-01', null)

      const copy = duplicateOffering(db, original.id)

      expect(copy.id).toMatch(UUID_PATTERN)
      expect(copy.id).not.toBe(original.id)
      expect(copy.name).toBe('Embedded Development Retainer (copy)')
      expect(copy.type).toBe('service')
      expect(copy.categoryId).toBe(category.id)
      expect(copy.billingModel).toBe('retainer')
      expect(copy.unit).toBe('mo')
      expect(copy.blurb).toBe('Ongoing engineering capacity.')
      expect(copy.active).toBe(true)

      // One version, numbered 1, at the original's *current* rate — the
      // history is not copied.
      expect(copy.versions).toHaveLength(1)
      expect(copy.versions[0].version).toBe(1)
      expect(copy.versions[0].rateCents).toBe(260_000)
      expect(copy.versions[0].id).not.toBe(original.versions[0].id)
      expect(copy.versions[0].effectiveFrom).toBeNull()
      expect(copy.versions[0].effectiveTo).toBeNull()

      // Both rows read back: the original still has its two versions and its
      // own name.
      const reread = getOffering(db, original.id)
      expect(reread?.name).toBe('Embedded Development Retainer')
      expect(reread?.versions).toHaveLength(2)
      expect(reread?.versions.map((v) => v.rateCents)).toEqual([260_000, 180_000])
      expect(count(db, 'offerings')).toBe(2)
    })
  })

  it('takes a name override', () => {
    withDatabase((db) => {
      const original = createOffering(db, { name: 'Advisory Retainer', rateCents: 650_000 })
      expect(duplicateOffering(db, original.id, { name: 'Advisory Retainer (EU)' }).name).toBe('Advisory Retainer (EU)')
    })
  })

  it('throws NotFoundError for an unknown id and writes nothing', () => {
    withDatabase((db) => {
      expect(() => duplicateOffering(db, randomUUID())).toThrow(NotFoundError)
      expect(count(db, 'offerings')).toBe(0)
    })
  })
})

// ---------------------------------------------------------------------------
// Against the dev seed — the only other writer of these three tables
// ---------------------------------------------------------------------------

describe('against the dev seed', () => {
  it('lists nine offerings and five categories, and spells type/billing_model/unit the way fixture.ts does', () => {
    withDatabase((db) => {
      seedFixture(db)

      const offerings = listOfferings(db)
      expect(offerings).toHaveLength(9)
      expect(listOfferingCategories(db)).toHaveLength(5)

      // Every seeded row parses against the closed vocabularies — a value the
      // seed spells differently from `electron/shared/offerings.ts` would
      // fail here rather than reading back as an offering that matches no
      // filter.
      for (const offering of offerings) {
        expect(() => offeringListItemSchema.parse(offering)).not.toThrow()
      }

      // The seed's split: seven services, two products; one archived.
      expect(listOfferings(db, { type: 'service' })).toHaveLength(7)
      expect(listOfferings(db, { type: 'product' })).toHaveLength(2)
      expect(listOfferings(db, { active: false }).map((o) => o.name)).toEqual(['Automation Playbook'])
    })
  })

  it('picks the current version for each seeded offering, not the first one', () => {
    withDatabase((db) => {
      seedFixture(db)

      const listed = listOfferings(db)
      const discovery = listed.find((o) => o.name === 'Discovery Audit')
      // Seeded as v1 $3,500 (closed) then v2 $4,500 (open) — the open one wins.
      expect(discovery?.currentVersion?.rateCents).toBe(450_000)
      expect(discovery?.currentVersion?.version).toBe(2)

      const advisory = listed.find((o) => o.name === 'Platform Advisory')
      expect(advisory?.currentVersion?.rateCents).toBe(18_500)

      // Every seeded offering has a current version — the seed writes at
      // least one per offering, same as `createOffering` guarantees.
      expect(listed.every((o) => o.currentVersion !== null)).toBe(true)
    })
  })

  it('leaves every seeded version range non-overlapping, by the rule this repository enforces', () => {
    withDatabase((db) => {
      seedFixture(db)

      // Each seeded version, checked against its siblings with itself
      // excluded: if the seed's ranges overlapped, this repository's own rule
      // would say so.
      const versions = db.prepare('SELECT id, offering_id, effective_from, effective_to FROM offering_versions').all() as Array<{
        id: string
        offering_id: string
        effective_from: string | null
        effective_to: string | null
      }>
      expect(versions.length).toBeGreaterThan(9)
      for (const version of versions) {
        expect(() =>
          assertNoOverlappingVersion(db, version.offering_id, version.effective_from, version.effective_to, version.id)
        ).not.toThrow()
      }
    })
  })

  it('keeps a seeded engagement resolvable through its offering version after the offering is archived', () => {
    withDatabase((db) => {
      seedFixture(db)

      const link = db
        .prepare(
          `SELECT e.id AS engagement_id, o.id AS offering_id
           FROM engagements e
           JOIN offering_versions v ON v.id = e.offering_version_id
           JOIN offerings o ON o.id = v.offering_id
           LIMIT 1`
        )
        .get() as { engagement_id: string; offering_id: string }

      expect(archiveOffering(db, link.offering_id).active).toBe(false)

      const still = db
        .prepare(
          `SELECT o.id AS offering_id
           FROM engagements e
           JOIN offering_versions v ON v.id = e.offering_version_id
           JOIN offerings o ON o.id = v.offering_id
           WHERE e.id = ?`
        )
        .get(link.engagement_id) as { offering_id: string } | undefined
      expect(still?.offering_id).toBe(link.offering_id)
    })
  })
})
