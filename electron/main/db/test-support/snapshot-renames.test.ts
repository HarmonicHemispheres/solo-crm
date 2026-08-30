import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, type MigrationDefinition } from '../migrations'
import { applyRenames, renamedTableName, renamesInMigrations, type DrizzleSnapshot } from './snapshot-renames'

/**
 * Direct tests for the rename replay `schema.test.ts` builds its base from.
 *
 * That file could only ever exercise this indirectly, through a
 * `drizzle-kit generate` child process, and only against the renames 0006
 * happens to perform. The case worth testing is the one no checked-in
 * migration performs yet: **a rename whose source is a token that appears
 * everywhere in a snapshot.** Every table in a drizzle snapshot has a
 * `"name"` key and every column has a `"type"`; the textual substitution
 * this replaced would have rewritten all of them.
 */

/** A migration definition carrying only the SQL — the rest is unread here. */
function sqlOnly(sql: string): MigrationDefinition {
  return { version: 99, name: 'test', sql } as MigrationDefinition
}

/**
 * A snapshot fragment built to be hostile to substitution: a table *called*
 * `name`, a column called `name` on two tables, a column called `type`, and
 * a pair of identifiers where one is a prefix of the other (`service` /
 * `service_version`). Everything a textual pass would smear across.
 */
function hostileSnapshot(): DrizzleSnapshot {
  return {
    version: '6',
    dialect: 'sqlite',
    tables: {
      name: {
        name: 'name',
        columns: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' } },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {}
      },
      service: {
        name: 'service',
        columns: { id: { name: 'id', type: 'text' }, name: { name: 'name', type: 'text' } },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {}
      },
      service_version: {
        name: 'service_version',
        columns: {
          id: { name: 'id', type: 'text' },
          service_id: { name: 'service_id', type: 'text' },
          // Deliberately a superstring of `service_id`: renaming the shorter
          // column must not touch the longer one.
          service_id_note: { name: 'service_id_note', type: 'text' },
          type: { name: 'type', type: 'text' }
        },
        indexes: {
          idx_service_version_type: { name: 'idx_service_version_type', columns: ['type'], isUnique: false },
          idx_service_version_ids: {
            name: 'idx_service_version_ids',
            columns: ['service_id', 'service_id_note'],
            isUnique: false
          }
        },
        foreignKeys: {
          service_version_service_id_service_id_fk: {
            name: 'service_version_service_id_service_id_fk',
            tableFrom: 'service_version',
            tableTo: 'service',
            columnsFrom: ['service_id'],
            columnsTo: ['id'],
            onDelete: 'no action',
            onUpdate: 'no action'
          }
        },
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {}
      }
    },
    views: {},
    enums: {},
    _meta: { schemas: {}, tables: {}, columns: {} }
  } as unknown as DrizzleSnapshot
}

describe('renamesInMigrations', () => {
  it('reads table and column renames, tagging each with its kind', () => {
    const renames = renamesInMigrations([
      sqlOnly('ALTER TABLE `services` RENAME TO `offerings`;\nALTER TABLE `offerings` RENAME COLUMN `a` TO `b`;')
    ])
    expect(renames).toEqual([
      { kind: 'table', from: 'services', to: 'offerings' },
      { kind: 'column', table: 'offerings', from: 'a', to: 'b' }
    ])
  })

  it('returns renames in statement order, not grouped by kind', () => {
    // The order is load-bearing: 0006 renames a table and then renames a
    // column *of the new name*. Grouped by kind — all tables, then all
    // columns — that still happens to work, but a migration that renamed a
    // column and then the table holding it would look up a table that has
    // already moved. Source order is the only order that always resolves.
    const renames = renamesInMigrations([
      sqlOnly(
        'ALTER TABLE `a` RENAME COLUMN `one` TO `two`;\n' +
          'ALTER TABLE `a` RENAME TO `b`;\n' +
          'ALTER TABLE `b` RENAME COLUMN `three` TO `four`;'
      )
    ])
    expect(renames.map((r) => r.kind)).toEqual(['column', 'table', 'column'])
  })

  it('reads unquoted identifiers, since a hand-written migration need not use backticks', () => {
    expect(renamesInMigrations([sqlOnly('ALTER TABLE services RENAME TO offerings;')])).toEqual([
      { kind: 'table', from: 'services', to: 'offerings' }
    ])
  })

  it('finds the renames 0006 actually performs, in the order it performs them', () => {
    expect(renamesInMigrations(MIGRATIONS)).toEqual([
      { kind: 'table', from: 'service_categories', to: 'offering_categories' },
      { kind: 'table', from: 'services', to: 'offerings' },
      { kind: 'table', from: 'service_versions', to: 'offering_versions' },
      { kind: 'column', table: 'offering_versions', from: 'service_id', to: 'offering_id' },
      { kind: 'column', table: 'engagements', from: 'service_version_id', to: 'offering_version_id' }
    ])
  })
})

describe('applyRenames moves identifiers and nothing that merely looks like one', () => {
  it('renaming a column called `name` leaves every table’s own `name` field alone', () => {
    // The defect this module exists to prevent. Textually, `name` appears as
    // a JSON key on every table and every column in the snapshot; renaming a
    // column from it rewrote all of them.
    const renamed = applyRenames(hostileSnapshot(), [{ kind: 'column', table: 'service', from: 'name', to: 'label' }])

    expect(Object.keys(renamed.tables).sort()).toEqual(['name', 'service', 'service_version'])
    expect(renamed.tables.name.name).toBe('name')
    expect(renamed.tables.service.name).toBe('service')
    expect(Object.keys(renamed.tables.service.columns)).toEqual(['id', 'label'])
    expect(renamed.tables.service.columns.label.name).toBe('label')
    // The identically-named column on another table did not move.
    expect(Object.keys(renamed.tables.name.columns)).toEqual(['id', 'name'])
    expect(renamed.tables.name.columns.name.name).toBe('name')
  })

  it('renaming a column called `type` leaves every column’s `type` field alone', () => {
    const renamed = applyRenames(hostileSnapshot(), [
      { kind: 'column', table: 'service_version', from: 'type', to: 'shape' }
    ])
    expect(renamed.tables.service_version.columns.shape.type).toBe('text')
    expect(renamed.tables.service_version.columns.id.type).toBe('text')
    expect(renamed.tables.service.columns.name.type).toBe('text')
    // The index over that column follows it; the index's own name does not,
    // because that name is a literal written in schema.ts.
    expect(renamed.tables.service_version.indexes?.idx_service_version_type.columns).toEqual(['shape'])
    expect(renamed.tables.service_version.indexes?.idx_service_version_type.name).toBe('idx_service_version_type')
  })

  it('renaming a table called `name` moves only that table', () => {
    const renamed = applyRenames(hostileSnapshot(), [{ kind: 'table', from: 'name', to: 'label' }])
    expect(Object.keys(renamed.tables).sort()).toEqual(['label', 'service', 'service_version'])
    expect(renamed.tables.label.name).toBe('label')
    // Every other table still carries its own `name`, and the column called
    // `name` on the renamed table is a column, not the table.
    expect(renamed.tables.service.name).toBe('service')
    expect(Object.keys(renamed.tables.label.columns)).toEqual(['id', 'name'])
  })

  it('renaming `service` does not touch `service_version`, with no ordering trick', () => {
    // The old textual pass needed longest-`from`-first ordering to avoid
    // corrupting the longer identifier. Structurally there is nothing to
    // order: `'service_version' === 'service'` is false.
    const renamed = applyRenames(hostileSnapshot(), [{ kind: 'table', from: 'service', to: 'offering' }])
    expect(Object.keys(renamed.tables).sort()).toEqual(['name', 'offering', 'service_version'])
    expect(renamed.tables.service_version.name).toBe('service_version')
    expect(Object.keys(renamed.tables.service_version.columns)).toContain('service_id')
  })

  it('renaming a column leaves a column whose name merely contains it alone', () => {
    // The other half of whole-identifier matching, and the half a column
    // list makes easy to get wrong: `service_id_note` contains `service_id`.
    // Substring matching passes every other test in this file and fails
    // only here.
    const renamed = applyRenames(hostileSnapshot(), [
      { kind: 'column', table: 'service_version', from: 'service_id', to: 'offering_id' }
    ])
    const table = renamed.tables.service_version
    expect(Object.keys(table.columns)).toEqual(['id', 'offering_id', 'service_id_note', 'type'])
    expect(table.columns.service_id_note.name).toBe('service_id_note')
    expect(table.indexes?.idx_service_version_ids.columns).toEqual(['offering_id', 'service_id_note'])
    expect(table.foreignKeys?.service_version_offering_id_service_id_fk.columnsFrom).toEqual(['offering_id'])
  })

  it('rewrites the compound foreign-key name and key drizzle derives from the parts', () => {
    const renamed = applyRenames(hostileSnapshot(), [
      { kind: 'table', from: 'service', to: 'offering' },
      { kind: 'column', table: 'service_version', from: 'service_id', to: 'offering_id' }
    ])
    const fks = renamed.tables.service_version.foreignKeys ?? {}
    expect(Object.keys(fks)).toEqual(['service_version_offering_id_offering_id_fk'])
    const fk = fks.service_version_offering_id_offering_id_fk
    expect(fk.name).toBe('service_version_offering_id_offering_id_fk')
    expect(fk.tableTo).toBe('offering')
    expect(fk.columnsFrom).toEqual(['offering_id'])
  })

  it('leaves a hand-named foreign key’s name alone while still moving its parts', () => {
    // SQLite's `ALTER TABLE ... RENAME` does not rename constraints, and a
    // name that is not drizzle's derived one was written by a person.
    const snapshot = hostileSnapshot()
    const fks = snapshot.tables.service_version.foreignKeys ?? {}
    const fk = fks.service_version_service_id_service_id_fk
    delete fks.service_version_service_id_service_id_fk
    fk.name = 'fk_written_by_hand'
    fks.fk_written_by_hand = fk

    const renamed = applyRenames(snapshot, [{ kind: 'table', from: 'service', to: 'offering' }])
    const after = renamed.tables.service_version.foreignKeys ?? {}
    expect(Object.keys(after)).toEqual(['fk_written_by_hand'])
    expect(after.fk_written_by_hand.tableTo).toBe('offering')
  })

  it('rewrites a quoted identifier inside a check constraint', () => {
    const snapshot = hostileSnapshot()
    snapshot.tables.service.checkConstraints = {
      service_name_not_blank: { name: 'service_name_not_blank', value: '("service"."name" != \'\')' }
    }
    const renamed = applyRenames(snapshot, [{ kind: 'table', from: 'service', to: 'offering' }])
    expect(renamed.tables.offering.checkConstraints?.service_name_not_blank.value).toBe('("offering"."name" != \'\')')
  })

  it('refuses an unquoted identifier in a check constraint rather than guessing', () => {
    const snapshot = hostileSnapshot()
    snapshot.tables.service.checkConstraints = {
      c: { name: 'c', value: '(service.name IS NOT NULL)' }
    }
    expect(() => applyRenames(snapshot, [{ kind: 'table', from: 'service', to: 'offering' }])).toThrow(/unquoted/)
  })

  it('refuses a rename of a table the snapshot does not have', () => {
    expect(() => applyRenames(hostileSnapshot(), [{ kind: 'table', from: 'absent', to: 'x' }])).toThrow(
      /snapshot does not have/
    )
  })

  it('refuses a rename of a column the table does not have', () => {
    expect(() =>
      applyRenames(hostileSnapshot(), [{ kind: 'column', table: 'service', from: 'absent', to: 'x' }])
    ).toThrow(/does not have/)
  })

  it('does not mutate the snapshot it was given', () => {
    const snapshot = hostileSnapshot()
    applyRenames(snapshot, [{ kind: 'table', from: 'service', to: 'offering' }])
    expect(Object.keys(snapshot.tables).sort()).toEqual(['name', 'service', 'service_version'])
    expect(snapshot.tables.service_version.foreignKeys?.service_version_service_id_service_id_fk.tableTo).toBe('service')
  })
})

describe('renamedTableName', () => {
  const renames = renamesInMigrations(MIGRATIONS)

  it('maps a renamed table to the name it ends up with', () => {
    expect(renamedTableName('services', renames)).toBe('offerings')
    expect(renamedTableName('service_versions', renames)).toBe('offering_versions')
    expect(renamedTableName('service_categories', renames)).toBe('offering_categories')
  })

  it('leaves a table whose name merely contains a renamed one alone', () => {
    // Whole names only. `service_versions_archive` is not `service_versions`
    // with a suffix as far as a rename is concerned — it is a table nobody
    // renamed. Substring matching passes the case above and fails here.
    expect(renamedTableName('service_versions_archive', renames)).toBe('service_versions_archive')
    expect(renamedTableName('legacy_services', renames)).toBe('legacy_services')
  })

  it('leaves an untouched table exactly as it was, and ignores column renames', () => {
    expect(renamedTableName('companies', renames)).toBe('companies')
    // `service_id` is a column rename; asking for it as a table name must
    // not pick it up.
    expect(renamedTableName('service_id', renames)).toBe('service_id')
  })
})

describe('applyRenames against the real 0001 snapshot', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const snapshot0001 = JSON.parse(
    readFileSync(join(here, '..', 'migrations', 'meta', '0001_snapshot.json'), 'utf-8')
  ) as DrizzleSnapshot

  const renamed = applyRenames(snapshot0001, renamesInMigrations(MIGRATIONS))

  it('produces the three table names 0006 renames to', () => {
    expect(Object.keys(renamed.tables)).toContain('offering_categories')
    expect(Object.keys(renamed.tables)).toContain('offerings')
    expect(Object.keys(renamed.tables)).toContain('offering_versions')
    expect(Object.keys(renamed.tables)).not.toContain('services')
    expect(Object.keys(renamed.tables)).not.toContain('service_versions')
    expect(Object.keys(renamed.tables)).not.toContain('service_categories')
  })

  it('renames only the two columns 0006 renames, and no other column called `name`', () => {
    expect(Object.keys(renamed.tables.offering_versions.columns)).toContain('offering_id')
    expect(Object.keys(renamed.tables.engagements.columns)).toContain('offering_version_id')
    // `offerings.category_id` deliberately keeps its name (0006's header).
    expect(Object.keys(renamed.tables.offerings.columns)).toContain('category_id')
    // Every table's `name` column survived — the token that would have been
    // smeared if this were textual.
    expect(Object.keys(renamed.tables.companies.columns)).toContain('name')
    expect(Object.keys(renamed.tables.people.columns)).toContain('name')
  })

  it('rewrites the compound foreign-key names that embed a renamed identifier', () => {
    const fks = renamed.tables.engagements.foreignKeys ?? {}
    expect(Object.keys(fks)).toContain('engagements_offering_version_id_offering_versions_id_fk')
    expect(fks.engagements_offering_version_id_offering_versions_id_fk.tableTo).toBe('offering_versions')
  })

  it('leaves every foreign key naming an untouched table exactly as it was', () => {
    const fks = renamed.tables.engagements.foreignKeys ?? {}
    expect(Object.keys(fks)).toContain('engagements_billing_company_id_companies_id_fk')
    expect(renamed.tables.companies.checkConstraints?.companies_billed_via_company_not_self.value).toBe(
      '("companies"."billed_via_company_id" IS NULL OR "companies"."billed_via_company_id" != "companies"."id")'
    )
  })
})
