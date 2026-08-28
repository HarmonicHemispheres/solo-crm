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
