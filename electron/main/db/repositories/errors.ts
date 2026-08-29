/**
 * The repository-level error type every `electron/main/db/repositories/*`
 * module throws instead of letting a raw `ZodError` or `SqliteError` escape.
 * T-260828-20's Scope: "so T-260828-26 does not have to string-match" — the
 * IPC layer maps a caught error to its `{ ok: false }` envelope by `.code`
 * (a fixed union, switchable) or `instanceof`, never by inspecting
 * `error.message` for a substring. `.message` itself stays human-readable —
 * it is what a renderer eventually shows a user — but it is never the
 * *dispatch* key.
 *
 * Three subclasses, one per failure mode a repository can produce that is
 * not a programmer bug:
 *
 * - `NotFoundError` — the id a caller passed does not name an existing row
 *   (`updateCompany`/`deleteCompany` on a missing id).
 * - `ValidationError` — the input failed a zod schema before any SQL ran.
 *   Carries the raw `ZodError#issues` alongside a joined `.message` so a
 *   caller that wants field-level detail (a form, eventually) does not have
 *   to re-parse the message string.
 * - `RefusalError` — the operation is well-formed and the id exists, but the
 *   database (or a rule the repository enforces ahead of the database, per
 *   this task's Risks note on deletion) refuses it: a `CHECK` constraint, a
 *   foreign key still pointing at the row a caller tried to delete.
 *   `blocker` is optional structured detail (what kind of reference, how
 *   many rows) for the same string-match-avoidance reason as `.code` above.
 *
 * Note what is *not* a `RefusalError`: a polymorphic attachment (`links`,
 * `taggings`, `external_refs`) never blocks an entity delete. ADR-010
 * (T-260828-41) settles those as a cascade, so a delete that would once have
 * stranded them now succeeds and takes them with it — there is no error type
 * for it because there is no failure. The one refusal that decision *does*
 * produce is on the create side, `reason: 'unknown-entity'` from `links.ts`.
 *
 * Anything else — a genuine bug, a constraint this file did not anticipate —
 * is left to propagate as whatever it already was; wrapping it here would
 * only hide it from `verify`'s test output.
 */

export type RepositoryErrorCode = 'not-found' | 'validation' | 'refused'

export abstract class RepositoryError extends Error {
  abstract readonly code: RepositoryErrorCode
}

export class NotFoundError extends RepositoryError {
  readonly code = 'not-found' as const

  constructor(entity: string, id: string) {
    super(`${entity} "${id}" was not found`)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends RepositoryError {
  readonly code = 'validation' as const

  constructor(
    message: string,
    readonly issues?: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>
  ) {
    super(message)
    this.name = 'ValidationError'
  }
}

export interface RefusalBlocker {
  /** What kind of reference is blocking the operation, or what constraint refused it. */
  readonly reason: string
  /**
   * How many rows carry that reference — set by a delete-path referential
   * refusal (`referential-guard.ts`). A write-path refusal translated from a
   * SQLite constraint (a `CHECK`, a `UNIQUE`, a `FOREIGN KEY` on insert or
   * update) has no natural row count and omits this field.
   */
  readonly count?: number
}

export class RefusalError extends RepositoryError {
  readonly code = 'refused' as const

  constructor(
    message: string,
    readonly blocker?: RefusalBlocker
  ) {
    super(message)
    this.name = 'RefusalError'
  }
}
