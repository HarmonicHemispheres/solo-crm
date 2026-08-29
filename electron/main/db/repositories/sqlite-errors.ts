import { RefusalError } from './errors'

/**
 * The SQLite-constraint translation machinery every repository in this
 * directory shares (T-260828-43) — previously copied byte-for-byte into six
 * of them.
 *
 * The discipline this encodes, unchanged from `companies.ts` where it
 * started: dispatch on the `SQLITE_CONSTRAINT_*` subcode, never forward
 * `error.message` into user-facing text. better-sqlite3's message is an
 * implementation detail of the SQLite build it links — not something to show
 * an operator, and not something to string-match on later. The one legitimate
 * read of `.message` is a repository matching a `CHECK` constraint *name* it
 * declared in its own migration, which is why `ConstraintHandler` receives
 * the error at all.
 *
 * What stays per-repository is the part that legitimately differs: the
 * `FOREIGNKEY` sentence (which names that table's own columns) and any
 * `CHECK` branches. Each repository declares a handler map holding exactly
 * the subcodes its table can raise — including which of the generic handlers
 * below it opts into — so no table starts answering for a constraint it
 * cannot trip.
 */

/** The structural shape better-sqlite3's `SqliteError` presents; typed here rather than imported so nothing depends on the driver's class. */
export interface SqliteConstraintError {
  readonly code: string
  readonly message: string
}

export function isSqliteConstraintError(error: unknown): error is SqliteConstraintError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  )
}

export type ConstraintHandler = (error: SqliteConstraintError) => RefusalError

/**
 * The three table-agnostic handlers. A `NOT NULL`, `UNIQUE` or primary-key
 * collision says the same thing whichever table raised it, so the message is
 * shared; a repository still opts in explicitly, by naming the subcode in its
 * own handler map, rather than inheriting branches for constraints its table
 * does not declare.
 */
export const NOT_NULL_HANDLER: ConstraintHandler = () => new RefusalError('A required field was left empty.', { reason: 'not-null' })
export const UNIQUE_HANDLER: ConstraintHandler = () => new RefusalError('This value conflicts with an existing row.', { reason: 'unique' })
export const PRIMARY_KEY_HANDLER: ConstraintHandler = () => new RefusalError('This id is already in use.', { reason: 'primary-key' })

/**
 * Turns a thrown `SqliteError` from an insert/update into a `RefusalError`
 * using `handlers`. Anything that is not a constraint error propagates
 * unchanged — a genuine bug must not be dressed up as a refusal.
 *
 * A `SQLITE_CONSTRAINT_*` subcode the caller's map does not cover (e.g.
 * `SQLITE_CONSTRAINT_TRIGGER`, `_VTAB`) is still a refusal rather than a
 * crash, but still carries no raw driver text.
 */
export function translateWriteError(handlers: Record<string, ConstraintHandler>, error: unknown): never {
  if (isSqliteConstraintError(error)) {
    const handler = handlers[error.code]
    if (handler) throw handler(error)
    throw new RefusalError('This write violates a database constraint.', { reason: 'constraint' })
  }
  throw error
}
