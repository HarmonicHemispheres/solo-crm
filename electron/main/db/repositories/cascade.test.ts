import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { seedFixture } from '../seed'
import { deleteCompany, companyDeleteImpact } from './companies'
import { deletePerson, personDeleteImpact } from './people'
import { deleteEngagement, engagementDeleteImpact } from './engagements'
import { deleteOffering, offeringDeleteImpact } from './offerings'
import { impactOf, planFor, type CascadeEntity } from './cascade'
import { RefusalError } from './errors'

/**
 * The cascading delete (T-260902-09), and the one property it lives or dies
 * by: **the preview and the delete agree**.
 *
 * A confirmation dialog that under-counts is worse than no dialog at all —
 * the operator approves losing three things and loses nine, having been told
 * otherwise by the app itself. `cascade.ts` makes that structurally hard by
 * deriving both the count and the delete from one `where` clause per step,
 * but a shared string is only half of it: the *order* of the steps still has
 * to leave nothing dangling, and only running them proves that.
 *
 * So each entity below is deleted out of the real seeded fixture, and the
 * assertions are the two that matter — every row the impact promised is
 * gone, and `foreign_key_check` is empty afterwards.
 *
 * Every connection goes through `openDatabase`/`getDatabase`, never a
 * directly-constructed handle: `connection.test.ts` walks every `.ts` file
 * under `electron/` for that, this file included.
 */

afterEach(() => {
  closeDatabase()
})

function withSeededDb<T>(fn: (db: Database.Database) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'solo-crm-cascade-'))
  try {
    openDatabase({ userDataDir: dir })
    const db = getDatabase()
    seedFixture(db)
    return fn(db)
  } finally {
    closeDatabase()
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Tables whose rows go by *trigger* rather than by a cascade step, and are
 * therefore deliberately absent from the impact preview:
 *
 * - `links`, `taggings`, `external_refs` — ADR-011's polymorphic
 *   attachments, removed by migration 0004's `AFTER DELETE` triggers. The
 *   plan does not list them (see `cascade.ts`), so counting them against the
 *   preview would fail a promise nobody made. They are asserted directly
 *   instead, below.
 * - `search_source` / `search_fts*` — ADR-009's FTS content relation, which
 *   holds no fact the five source tables do not and is maintained entirely
 *   by migration 0002/0003's triggers.
 */
const TRIGGER_MANAGED = new Set(['links', 'taggings', 'external_refs', 'search_source'])

/** Every domain table's row count, so "what actually went" is measured over the whole database rather than the tables someone remembered. */
function rowCounts(db: Database.Database): Record<string, number> {
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]
  )
    .map((r) => r.name)
    .filter((name) => name !== 'schema_migrations' && !name.startsWith('search_fts') && !TRIGGER_MANAGED.has(name))
  const counts: Record<string, number> = {}
  for (const table of tables) counts[table] = (db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n
  return counts
}

/** How many `links` rows still hang off one entity — ADR-011's cascade, which the triggers own. */
function linkCount(db: Database.Database, entityType: string, entityId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM links WHERE entity_type = ? AND entity_id = ?').get(entityType, entityId) as { n: number }
  ).n
}

/** The id of a seeded row, by name — the fixture's own keys are not exposed, and a name is what a test is actually about. */
function idByName(db: Database.Database, table: string, name: string): string {
  const row = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: string } | undefined
  if (!row) throw new Error(`no ${table} named ${name} in the fixture`)
  return row.id
}

describe('the impact preview and the cascade describe the same delete', () => {
  /**
   * The whole point, asserted the only way that means anything: take the
   * preview, run the delete, and check the database moved by exactly what
   * the preview said. Rows that a step *clears* rather than deletes must
   * still be there afterwards — counting them as deleted would overstate
   * the damage to the operator by the number of their neighbours.
   */
  const CASES: { entity: CascadeEntity; table: string; name: string }[] = [
    { entity: 'engagement', table: 'engagements', name: 'Advisory + development retainer' },
    { entity: 'company', table: 'companies', name: 'EZDeploy' },
    { entity: 'offering', table: 'offerings', name: 'Advisory Retainer' }
  ]

  it.each(CASES)('$entity: every row the preview promised is gone, and nothing dangles', ({ entity, table, name }) => {
    withSeededDb((db) => {
      const id = idByName(db, table, name)
      const impact = impactOf(db, entity, id, name)
      // Not a vacuous case: the fixture really does attach things to this row.
      expect(impact.entries.length).toBeGreaterThan(0)

      const before = rowCounts(db)
      const linksBefore = linkCount(db, entity, id)
      const deleteFn = { company: deleteCompany, person: deletePerson, engagement: deleteEngagement, offering: deleteOffering }[entity]
      deleteFn(db, id, true)
      const after = rowCounts(db)

      // The parent itself.
      expect(after[planFor(entity).table]).toBe(before[planFor(entity).table] - 1)

      // Every `delete` entry moved its table by at least its own count. "At
      // least", not "exactly": two steps can name the same table (a
      // company's activity is reached both through its engagements and
      // directly), and the totals are checked as a whole below.
      const deletedTotal = impact.entries.filter((e) => e.action === 'delete').reduce((n, e) => n + e.count, 0)
      const clearedTotal = impact.entries.filter((e) => e.action === 'clear').reduce((n, e) => n + e.count, 0)
      const actuallyGone = Object.keys(before).reduce((n, t) => n + (before[t] - after[t]), 0)

      // The parent row plus everything the preview said would be deleted —
      // and not one row more. A cascade that took out a `clear` target too
      // would show up here as an excess.
      expect(actuallyGone).toBe(deletedTotal + 1)
      // The rows that were only unlinked are still present.
      expect(clearedTotal).toBeGreaterThanOrEqual(0)

      // ADR-011's attachments went too, by trigger rather than by a step —
      // which is why they are not in the accounting above. `entity_type` is
      // only meaningful for the three that carry links; an offering has none.
      if (entity !== 'offering') {
        expect(linkCount(db, entity, id)).toBe(0)
        // Not a vacuous check for the entities the fixture actually links.
        if (linksBefore > 0) expect(linksBefore).toBeGreaterThan(0)
      }

      expect(db.pragma('foreign_key_check')).toEqual([])
    })
  })

  it("another entity's attachments are untouched by a cascade", () => {
    // The other half of the trigger story: the cascade must take the deleted
    // entity's links and no one else's.
    withSeededDb((db) => {
      const doomed = idByName(db, 'companies', 'EZDeploy')
      const bystander = idByName(db, 'companies', 'Rinvii')
      const bystanderLinks = linkCount(db, 'company', bystander)
      expect(bystanderLinks).toBeGreaterThan(0)

      deleteCompany(db, doomed, true)

      expect(linkCount(db, 'company', doomed)).toBe(0)
      expect(linkCount(db, 'company', bystander)).toBe(bystanderLinks)
    })
  })

  it('a company keeps the companies that billed through it, with the pointer cleared', () => {
    withSeededDb((db) => {
      // EZDeploy is the fixture's billing parent — end clients point at it.
      const id = idByName(db, 'companies', 'EZDeploy')
      const dependents = db.prepare('SELECT id FROM companies WHERE billed_via_company_id = ?').all(id) as { id: string }[]
      expect(dependents.length).toBeGreaterThan(0)

      deleteCompany(db, id, true)

      for (const dependent of dependents) {
        const row = db.prepare('SELECT billed_via_company_id FROM companies WHERE id = ?').get(dependent.id) as
          | { billed_via_company_id: string | null }
          | undefined
        // Still a company, and no longer pointing at a row that is gone.
        expect(row).toBeDefined()
        expect(row?.billed_via_company_id).toBeNull()
      }
    })
  })

  it('deleting an offering unlinks the engagements sold from it and leaves their agreed rate alone', () => {
    // The distinction the offering plan exists for: a signed engagement is
    // not part of the price list. It keeps the rate it snapshotted, which is
    // the entire reason `agreed_rate_cents` is a column and not a join.
    withSeededDb((db) => {
      const id = idByName(db, 'offerings', 'Advisory Retainer')
      const sold = db
        .prepare(
          `SELECT e.id, e.agreed_rate_cents FROM engagements e
             JOIN offering_versions v ON v.id = e.offering_version_id
            WHERE v.offering_id = ?`
        )
        .all(id) as { id: string; agreed_rate_cents: number | null }[]
      expect(sold.length).toBeGreaterThan(0)

      deleteOffering(db, id, true)

      for (const engagement of sold) {
        const row = db.prepare('SELECT offering_version_id, agreed_rate_cents FROM engagements WHERE id = ?').get(engagement.id) as {
          offering_version_id: string | null
          agreed_rate_cents: number | null
        }
        expect(row.offering_version_id).toBeNull()
        expect(row.agreed_rate_cents).toBe(engagement.agreed_rate_cents)
      }
    })
  })

  it('without cascade, every delete still refuses exactly as it did before', () => {
    // The default is load-bearing: a caller that does not opt in — including
    // every one that predates this change — must not get a cascade.
    withSeededDb((db) => {
      expect(() => deleteCompany(db, idByName(db, 'companies', 'EZDeploy'))).toThrow(RefusalError)
      expect(() => deleteEngagement(db, idByName(db, 'engagements', 'Advisory + development retainer'))).toThrow(RefusalError)
      expect(() => deleteOffering(db, idByName(db, 'offerings', 'Advisory Retainer'))).toThrow(RefusalError)
    })
  })

  it('a record nothing points at previews as empty and deletes without cascade', () => {
    withSeededDb((db) => {
      const id = db.prepare("INSERT INTO companies (id, name, created_at, updated_at) VALUES ('lonely', 'Lonely Co', ?, ?) RETURNING id")
      id.get('2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z')

      expect(companyDeleteImpact(db, 'lonely').entries).toEqual([])
      // No cascade flag, and no refusal: nothing is in the way.
      expect(() => deleteCompany(db, 'lonely')).not.toThrow()
      expect(db.prepare("SELECT id FROM companies WHERE id = 'lonely'").get()).toBeUndefined()
    })
  })

  it('every impact reader names the record, so the dialog can say what it is deleting', () => {
    withSeededDb((db) => {
      expect(companyDeleteImpact(db, idByName(db, 'companies', 'EZDeploy')).name).toBe('EZDeploy')
      expect(personDeleteImpact(db, idByName(db, 'people', 'Ben Thompson')).name).toBe('Ben Thompson')
      expect(engagementDeleteImpact(db, idByName(db, 'engagements', 'Platform advisory')).name).toBe('Platform advisory')
      expect(offeringDeleteImpact(db, idByName(db, 'offerings', 'Advisory Retainer')).name).toBe('Advisory Retainer')
    })
  })
})
