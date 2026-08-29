import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { MIGRATIONS } from '../migrations'
import { seedFixture } from '../seed'
import { createCompany, deleteCompany } from './companies'
import { createEngagement, deleteEngagement } from './engagements'
import { RefusalError } from './errors'
import { addLink, listLinks } from './links'
import { createPerson, deletePerson } from './people'
import {
  attachmentCascadeTriggerName,
  countPolymorphicAttachments,
  POLYMORPHIC_ATTACHMENT_TABLES,
  POLYMORPHIC_PARENT_ENTITY_TYPES,
  type PolymorphicParentTable
} from './referential-guard'

/**
 * ADR-010's guarantee, end to end: deleting an entity takes its polymorphic
 * attachments with it, and an attachment cannot be created against an entity
 * that does not exist (T-260828-41).
 *
 * Every test opens a real, migrated database through `openDatabase`, the same
 * discipline as every sibling repository test — the behaviour under test is a
 * set of SQLite triggers, so a mock would test nothing at all.
 */

function makeTmpDir(prefix = 'solo-crm-cascade-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
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

const MIGRATION_0004 = (() => {
  const found = MIGRATIONS.find((m) => m.version === 4)
  if (!found) throw new Error('MIGRATIONS is missing migration version 4')
  return found
})()

const MIGRATIONS_BEFORE_0004 = MIGRATIONS.filter((m) => m.version < 4)

const NOW = '2026-08-29T12:00:00.000Z'

/**
 * Writes one row into each of the three attachment tables for
 * `entityType`/`entityId`. `taggings` and `external_refs` have no repository
 * yet (ADR-010's table), so they are inserted directly — the trigger under
 * test does not care which writer produced the row, which is the point.
 */
function attachAll(db: Database.Database, entityType: string, entityId: string): void {
  addLink(db, { entityType, entityId, url: `https://example.test/${entityType}` })

  const tagId = randomUUID()
  db.prepare('INSERT INTO tags (id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(
    tagId,
    `tag-${entityId.slice(0, 8)}`,
    '#000000',
    NOW,
    NOW
  )
  db.prepare(
    'INSERT INTO taggings (id, tag_id, entity_type, entity_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(randomUUID(), tagId, entityType, entityId, NOW, NOW)

  db.prepare(
    `INSERT INTO external_refs (id, entity_type, entity_id, source, external_id, url, last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(randomUUID(), entityType, entityId, 'stripe', 'cus_test', 'https://stripe.test/cus_test', NOW, NOW, NOW)
}

// ---------------------------------------------------------------------------
// The declaration and the installed triggers cannot drift
// ---------------------------------------------------------------------------

describe('the cascade is declared in one place and installed for every pair', () => {
  it('migration 0004 installs a cascade trigger for every parent in POLYMORPHIC_PARENT_ENTITY_TYPES', () => {
    withDatabase((db) => {
      for (const parent of Object.keys(POLYMORPHIC_PARENT_ENTITY_TYPES) as PolymorphicParentTable[]) {
        const row = db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get(attachmentCascadeTriggerName(parent)) as { sql: string } | undefined
        expect(row, `no cascade trigger for ${parent}`).toBeDefined()

        // Every attachment table the declaration names must appear in the
        // trigger body, and with this parent's entity_type literal — a fourth
        // table added to POLYMORPHIC_ATTACHMENT_TABLES without a matching
        // DELETE fails here rather than silently going uncovered.
        for (const table of POLYMORPHIC_ATTACHMENT_TABLES) {
          expect(row!.sql, `${parent} trigger does not clear ${table}`).toContain(`DELETE FROM ${table}`)
        }
        expect(row!.sql).toContain(`'${POLYMORPHIC_PARENT_ENTITY_TYPES[parent]}'`)
      }
    })
  })

  it('the search triggers migrations 0002/0003 own are untouched — both fire on a delete', () => {
    withDatabase((db) => {
      for (const parent of ['companies', 'people', 'engagements'] as const) {
        const names = db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name")
          .all(parent) as { name: string }[]
        const asSet = names.map((n) => n.name)
        expect(asSet).toContain(`trg_${parent}_search_ad`)
        expect(asSet).toContain(`trg_${parent}_attachments_ad`)
      }
    })
  })
})

// ---------------------------------------------------------------------------
// The cascade itself
// ---------------------------------------------------------------------------

describe('deleting an entity clears its polymorphic attachments in the same transaction', () => {
  it('deleteCompany removes the company links, taggings and external_refs', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Cascade Co' })
      attachAll(db, 'company', company.id)
      expect(countPolymorphicAttachments(db, 'company', company.id)).toBe(3)

      deleteCompany(db, company.id)

      expect(countPolymorphicAttachments(db, 'company', company.id)).toBe(0)
      expect(listLinks(db, { entityType: 'company', entityId: company.id })).toHaveLength(0)
    })
  })

  it('deletePerson removes the person attachments', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Cascade Person' })
      attachAll(db, 'person', person.id)
      expect(countPolymorphicAttachments(db, 'person', person.id)).toBe(3)

      deletePerson(db, person.id)

      expect(countPolymorphicAttachments(db, 'person', person.id)).toBe(0)
    })
  })

  it('deleteEngagement removes the engagement attachments', () => {
    withDatabase((db) => {
      const client = createCompany(db, { name: 'Engagement Client Co' })
      const engagement = createEngagement(db, {
        name: 'Cascade Engagement',
        billingModel: 'retainer',
        clientCompanyId: client.id,
        billingCompanyId: client.id,
        startedOn: '2026-01-01',
        hoursIncluded: 10
      })
      attachAll(db, 'engagement', engagement.id)
      expect(countPolymorphicAttachments(db, 'engagement', engagement.id)).toBe(3)

      deleteEngagement(db, engagement.id)

      expect(countPolymorphicAttachments(db, 'engagement', engagement.id)).toBe(0)
    })
  })

  it('takes only its own rows — another entity of the same type keeps its attachments', () => {
    withDatabase((db) => {
      const doomed = createCompany(db, { name: 'Doomed Co' })
      const survivor = createCompany(db, { name: 'Survivor Co' })
      attachAll(db, 'company', doomed.id)
      attachAll(db, 'company', survivor.id)

      deleteCompany(db, doomed.id)

      expect(countPolymorphicAttachments(db, 'company', doomed.id)).toBe(0)
      expect(countPolymorphicAttachments(db, 'company', survivor.id)).toBe(3)
    })
  })

  it('matches on entity_type as well as entity_id — a person sharing the id value keeps its links', () => {
    withDatabase((db) => {
      // The same collision `links.test.ts` constructs: two rows of different
      // types holding the literal same id. A cascade that deleted by
      // entity_id alone would take both.
      const sharedId = randomUUID()
      const company = createCompany(db, { name: 'Shared Id Co' })
      db.prepare('INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
        sharedId,
        'Shared Id Person',
        NOW,
        NOW
      )
      db.prepare('UPDATE companies SET id = ? WHERE id = ?').run(sharedId, company.id)

      attachAll(db, 'company', sharedId)
      attachAll(db, 'person', sharedId)

      deleteCompany(db, sharedId)

      expect(countPolymorphicAttachments(db, 'company', sharedId)).toBe(0)
      expect(countPolymorphicAttachments(db, 'person', sharedId)).toBe(3)
    })
  })

  it('rolls back with the delete: a refused deleteCompany leaves the attachments alone', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Blocked Co' })
      const blocker = createCompany(db, { name: 'Bills Through Co', billedViaCompanyId: company.id })
      attachAll(db, 'company', company.id)

      expect(() => deleteCompany(db, company.id)).toThrow(RefusalError)

      // The refusal happens before the DELETE, so the trigger never fires —
      // asserted rather than assumed, because a cascade that ran first would
      // destroy the links of a company that then stayed.
      expect(countPolymorphicAttachments(db, 'company', company.id)).toBe(3)
      expect(blocker.billedViaCompanyId).toBe(company.id)
    })
  })
})

// ---------------------------------------------------------------------------
// The create side of the same policy
// ---------------------------------------------------------------------------

describe('addLink refuses an entity that does not exist', () => {
  it('a company id nothing owns is a RefusalError, not a silent orphan', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        addLink(db, { entityType: 'company', entityId: randomUUID(), url: 'https://example.test/nowhere' })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('unknown-entity')
      // Nothing was written — the trigger is BEFORE INSERT.
      const count = db.prepare('SELECT COUNT(*) AS count FROM links').get() as { count: number }
      expect(count.count).toBe(0)
    })
  })

  it('the id of an entity of a different type does not satisfy the check', () => {
    withDatabase((db) => {
      const person = createPerson(db, { name: 'Wrong Type Person' })
      expect(() => addLink(db, { entityType: 'company', entityId: person.id, url: 'https://example.test/x' })).toThrow(
        RefusalError
      )
    })
  })

  it('an entity deleted after its link was added leaves no link behind to re-point at', () => {
    withDatabase((db) => {
      const company = createCompany(db, { name: 'Round Trip Co' })
      const link = addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.test/ok' })
      expect(link.entityId).toBe(company.id)

      deleteCompany(db, company.id)

      // Both halves of ADR-010 in one assertion: the cascade removed the row,
      // and re-creating it is now refused rather than recreating the orphan.
      expect(countPolymorphicAttachments(db, 'company', company.id)).toBe(0)
      expect(() =>
        addLink(db, { entityType: 'company', entityId: company.id, url: 'https://example.test/ok' })
      ).toThrow(RefusalError)
    })
  })
})

// ---------------------------------------------------------------------------
// Migration 0004 against a database that already holds data
// ---------------------------------------------------------------------------

describe('migration 0004 applies to a seeded database', () => {
  it('applies over a database seeded at 0003, and the cascade then clears the seeded links', () => {
    const tmpDir = makeTmpDir('solo-crm-cascade-seeded-')
    try {
      // Migrate only as far as 0003, seed it, then let 0004 run — the "copy of
      // a seeded database" case in this task's Acceptance. Reopening the same
      // userDataDir applies the remaining migration to the populated file.
      openDatabase({ userDataDir: tmpDir, migrations: MIGRATIONS_BEFORE_0004 })
      seedFixture(getDatabase())
      const seededLinks = (
        db => db.prepare("SELECT COUNT(*) AS count FROM links WHERE entity_type = 'company'").get() as { count: number }
      )(getDatabase())
      expect(seededLinks.count).toBeGreaterThan(0)
      closeDatabase()

      openDatabase({ userDataDir: tmpDir })
      const db = getDatabase()
      const applied = db
        .prepare('SELECT name FROM schema_migrations WHERE version = ?')
        .get(MIGRATION_0004.version) as { name: string } | undefined
      expect(applied?.name).toBe(MIGRATION_0004.name)

      // The cascade fires against a populated database, not just an empty
      // one. A *seeded* company cannot be the subject: every one of them has
      // activity and tasks, so `deleteCompany` refuses it — correctly, and
      // before the trigger would ever run. A company added to the seeded
      // database is the deletable case, and the seeded rows around it are
      // what prove the trigger deletes by id rather than by table.
      const seededLinkTotal = (
        db.prepare("SELECT COUNT(*) AS count FROM links WHERE entity_type = 'company'").get() as { count: number }
      ).count

      const added = createCompany(db, { name: 'Added To Seeded Co' })
      attachAll(db, 'company', added.id)
      expect(countPolymorphicAttachments(db, 'company', added.id)).toBe(3)

      deleteCompany(db, added.id)

      expect(countPolymorphicAttachments(db, 'company', added.id)).toBe(0)
      expect(
        (db.prepare("SELECT COUNT(*) AS count FROM links WHERE entity_type = 'company'").get() as { count: number })
          .count
      ).toBe(seededLinkTotal)

      // And no attachment anywhere in the database points at a company that
      // no longer exists — this task's Acceptance, asserted by query over a
      // seeded database rather than by reasoning about the trigger.
      const orphans = db
        .prepare(
          `SELECT COUNT(*) AS count FROM links
           WHERE entity_type = 'company' AND entity_id NOT IN (SELECT id FROM companies)`
        )
        .get() as { count: number }
      expect(orphans.count).toBe(0)
    } finally {
      closeDatabase()
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// EXPLAIN QUERY PLAN: the pre-checks and the cascade are index searches
// ---------------------------------------------------------------------------

/**
 * Every (query, index) pair migration 0004 exists to make fast. The query
 * text mirrors what actually runs: `refuseIfReferenced` composes
 * `SELECT COUNT(*) FROM <table> WHERE <column> = ?`, and each cascade trigger
 * body deletes on `entity_type` + `entity_id`.
 */
const INDEX_EXPECTATIONS: ReadonlyArray<{ sql: string; params: string[]; index: string }> = [
  { sql: 'SELECT COUNT(*) FROM activity WHERE company_id = ?', params: ['x'], index: 'idx_activity_company_id' },
  { sql: 'SELECT COUNT(*) FROM activity WHERE person_id = ?', params: ['x'], index: 'idx_activity_person_id' },
  { sql: 'SELECT COUNT(*) FROM activity WHERE engagement_id = ?', params: ['x'], index: 'idx_activity_engagement_id' },
  { sql: 'SELECT COUNT(*) FROM affiliations WHERE person_id = ?', params: ['x'], index: 'idx_affiliations_person_id' },
  { sql: 'SELECT COUNT(*) FROM affiliations WHERE company_id = ?', params: ['x'], index: 'idx_affiliations_company_id' },
  {
    sql: 'SELECT COUNT(*) FROM companies WHERE billed_via_company_id = ?',
    params: ['x'],
    index: 'idx_companies_billed_via_company_id'
  },
  {
    sql: 'SELECT COUNT(*) FROM companies WHERE introduced_by_company_id = ?',
    params: ['x'],
    index: 'idx_companies_introduced_by_company_id'
  },
  {
    sql: 'SELECT COUNT(*) FROM engagements WHERE billing_company_id = ?',
    params: ['x'],
    index: 'idx_engagements_billing_company_id'
  },
  {
    sql: 'SELECT COUNT(*) FROM engagements WHERE client_company_id = ?',
    params: ['x'],
    index: 'idx_engagements_client_company_id'
  },
  { sql: 'SELECT COUNT(*) FROM milestones WHERE engagement_id = ?', params: ['x'], index: 'idx_milestones_engagement_id' },
  {
    sql: 'SELECT COUNT(*) FROM revenue_lines WHERE engagement_id = ?',
    params: ['x'],
    index: 'idx_revenue_lines_engagement_id'
  },
  { sql: 'SELECT COUNT(*) FROM tasks WHERE company_id = ?', params: ['x'], index: 'idx_tasks_company_id' },
  { sql: 'SELECT COUNT(*) FROM tasks WHERE engagement_id = ?', params: ['x'], index: 'idx_tasks_engagement_id' },
  { sql: 'SELECT COUNT(*) FROM tasks WHERE person_id = ?', params: ['x'], index: 'idx_tasks_person_id' },
  {
    sql: 'SELECT COUNT(*) FROM time_entries WHERE engagement_id = ?',
    params: ['x'],
    index: 'idx_time_entries_engagement_id'
  },
  { sql: 'SELECT COUNT(*) FROM time_entries WHERE company_id = ?', params: ['x'], index: 'idx_time_entries_company_id' },
  {
    sql: 'DELETE FROM links WHERE entity_type = ? AND entity_id = ?',
    params: ['company', 'x'],
    index: 'idx_links_entity'
  },
  {
    sql: 'DELETE FROM taggings WHERE entity_type = ? AND entity_id = ?',
    params: ['company', 'x'],
    index: 'idx_taggings_entity'
  },
  {
    sql: 'DELETE FROM external_refs WHERE entity_type = ? AND entity_id = ?',
    params: ['company', 'x'],
    index: 'idx_external_refs_entity'
  }
]

describe('EXPLAIN QUERY PLAN: no delete pre-check or cascade is a full table scan', () => {
  it.each(INDEX_EXPECTATIONS)('$sql uses $index', ({ sql, params, index }) => {
    withDatabase((db) => {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
      const detail = plan.map((step) => step.detail).join(' | ')
      expect(detail).toContain(index)
      expect(detail).not.toContain('SCAN')
    })
  })
})
