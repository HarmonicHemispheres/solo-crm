import type Database from 'better-sqlite3'
import { RefusalError } from './errors'

/**
 * Declares one blocking reference a delete must refuse against — a
 * `{table, column}` pair migration 0001 gave a foreign key pointing at the
 * row being deleted. Migration 0001 uses `ON DELETE no action`, **not**
 * `RESTRICT`, on every foreign key in this schema (companies.ts's original
 * header got this wrong): a repository that skips this pre-check and lets
 * the delete run gets a bare `SQLITE_CONSTRAINT_FOREIGNKEY` with no table,
 * column or row count attached, not a safety net. `refuseIfReferenced`
 * below is the pre-check every repository's `deleteX` should run instead of
 * writing the count/fetch/compose/throw sequence by hand.
 */
export interface ReferenceBlocker {
  /** The table that may hold a row pointing at the id being deleted. */
  readonly table: string
  /** The foreign-key column on `table` that may point at the id. */
  readonly column: string
  /**
   * A short, stable tag for *why* the delete is blocked — carried on
   * `RefusalError.blocker.reason` so a caller (eventually the IPC layer, a
   * test) can branch on it instead of parsing `.message`.
   */
  readonly reason: string
  /**
   * A column on `table` worth naming in the refusal message (e.g. `name`,
   * `title`). Omit when `table` has no column worth surfacing — the message
   * then names only the count, not an example row.
   */
  readonly exampleColumn?: string
  /** Builds the user-facing refusal sentence from the blocking row count and, when `exampleColumn` was given, one example value. */
  readonly describe: (count: number, example: string | null) => string
}

/**
 * Runs each blocker in `blockers`, in order, against `id`, and throws a
 * `RefusalError` on the first one that has at least one matching row.
 * Callers run this inside the same `db.transaction()` as the delete it
 * guards, so nothing can change between the check and the delete.
 *
 * `table`/`column` are interpolated into the query text rather than bound as
 * parameters — SQLite has no placeholder for an identifier — but every
 * blocker is a literal declared by the repository itself, never a value
 * that crossed the IPC boundary, so this is the same trust boundary as the
 * rest of this file's hand-written SQL, not a place user input can reach.
 */
export function refuseIfReferenced(db: Database.Database, id: string, blockers: readonly ReferenceBlocker[]): void {
  for (const blocker of blockers) {
    const countRow = db
      .prepare(`SELECT COUNT(*) AS count FROM ${blocker.table} WHERE ${blocker.column} = ?`)
      .get(id) as { count: number }
    if (countRow.count === 0) continue

    let example: string | null = null
    if (blocker.exampleColumn) {
      const exampleRow = db
        .prepare(`SELECT ${blocker.exampleColumn} AS example FROM ${blocker.table} WHERE ${blocker.column} = ? LIMIT 1`)
        .get(id) as { example: string | null } | undefined
      example = exampleRow?.example ?? null
    }

    throw new RefusalError(blocker.describe(countRow.count, example), { reason: blocker.reason, count: countRow.count })
  }
}

// ---------------------------------------------------------------------------
// Polymorphic attachments (T-260828-41, ADR-011)
// ---------------------------------------------------------------------------

/**
 * The three tables that reference an entity as `entity_type`/`entity_id`
 * rather than through a foreign key. They are deliberately **not**
 * `ReferenceBlocker`s: ADR-011 settles that an attachment is cascaded with
 * its entity rather than blocking the delete, so nothing above ever asks
 * about them.
 *
 * The cascade itself is three `AFTER DELETE` triggers installed by migration
 * `0004_fk_indexes_polymorphic_cascade.sql`, not code in this file — a
 * trigger cannot be forgotten by the next repository and also covers the
 * writers that never go through one (the seeder, the P4 importers). ADR-011
 * has the full reasoning.
 *
 * What lives here is the *declaration*: the single place in TypeScript that
 * says which attachment tables exist and which `entity_type` literal each
 * parent table's rows carry. `referential-guard.test.ts` reads both constants
 * and asserts the installed trigger set matches, so a fourth attachment table
 * added to this list without a matching trigger fails a test rather than
 * being silently uncovered.
 */
export const POLYMORPHIC_ATTACHMENT_TABLES = ['links', 'taggings', 'external_refs'] as const

export type PolymorphicAttachmentTable = (typeof POLYMORPHIC_ATTACHMENT_TABLES)[number]

/**
 * Parent table → the `entity_type` literal its rows are named by. The values
 * are the same three strings as `LINK_ENTITY_TYPES` in
 * `electron/shared/links.ts`, but they are not imported from there: that
 * constant is the closed union one *repository's* zod schema validates
 * against, while this map is about which SQL tables the cascade spans. They
 * happen to agree today; a fourth entity type that carries links would extend
 * both, and the test below would say so.
 */
export const POLYMORPHIC_PARENT_ENTITY_TYPES = {
  companies: 'company',
  people: 'person',
  engagements: 'engagement'
} as const

export type PolymorphicParentTable = keyof typeof POLYMORPHIC_PARENT_ENTITY_TYPES

/** The cascade trigger migration 0004 installs on `parentTable`. Distinct from `trg_<parent>_search_ad`, which 0003 owns. */
export function attachmentCascadeTriggerName(parentTable: PolymorphicParentTable): string {
  return `trg_${parentTable}_attachments_ad`
}

/**
 * How many rows across all three attachment tables still point at
 * `entityType`/`entityId` — the query ADR-011's guarantee is stated in, and
 * the one place the three table names are spelled out for a caller rather
 * than for a trigger. Written as a `UNION ALL` of three counts so a caller
 * gets one number for "is this entity fully detached" without three
 * round-trips or three hand-written statements to keep in step.
 *
 * Each table name comes from `POLYMORPHIC_ATTACHMENT_TABLES`, a literal in
 * this file, never from anything that crossed the IPC boundary — the same
 * trust boundary `refuseIfReferenced` above explains.
 */
export function countPolymorphicAttachments(db: Database.Database, entityType: string, entityId: string): number {
  const sql = POLYMORPHIC_ATTACHMENT_TABLES.map(
    (table) => `SELECT COUNT(*) AS count FROM ${table} WHERE entity_type = ? AND entity_id = ?`
  ).join(' UNION ALL ')
  const params = POLYMORPHIC_ATTACHMENT_TABLES.flatMap(() => [entityType, entityId])
  const rows = db.prepare(sql).all(...params) as { count: number }[]
  return rows.reduce((total, row) => total + row.count, 0)
}
