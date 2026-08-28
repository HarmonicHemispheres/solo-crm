import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import { timestampSchema } from '../../../shared/types'
import {
  ACTIVITY_KINDS,
  ACTIVITY_SOURCES,
  type Activity,
  type ActivityKind,
  type ActivitySource,
  type LogActivityInput,
  logActivityInputSchema,
  type RecordContactEntity,
  recordContactEntitySchema
} from '../../../shared/activity'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * The `activity` repository (T-260828-24) — the maintainer ADR-001 promises
 * `companies.last_touch_at` and `people.last_contact_at`, and the place G8's
 * "activity is append-only" stops being a comment in `schema.ts` and becomes
 * a boundary.
 *
 * `logActivity` is the **only** writer of an `activity` row. There is
 * deliberately no `updateActivity` and no `deleteActivity` — a SQLite
 * trigger could refuse an `UPDATE`/`DELETE` at the database level, but it
 * would also fire against this module's own writes (an `UPDATE` runs inside
 * `logActivity`'s transaction too, just against `companies`/`people`, not
 * `activity` — a table-scoped trigger would not catch that, but a
 * statement-scoped one watching this table would need to distinguish "this
 * repository's insert" from "a future caller's mutation", which SQL has no
 * way to express). The only place able to enforce "no update, no delete" is
 * this module's export list, so that is what `activity.test.ts` asserts
 * against — the module's own exports, not the diff.
 *
 * `recordContact` is a second, narrower writer: it moves the denormalised
 * touch column directly, with no `activity` row at all. ADR-001 exists
 * because of exactly this case — the Gmail adapter (P4-xx) gets a
 * last-contacted timestamp with no message body, so there is nothing to log.
 * Exported and tested now; P4-xx is its only future caller.
 *
 * Both writers share the same forward-only rule (ADR-001 rule 2): a touch
 * timestamp never retreats. `advanceCompanyLastTouch`/
 * `advancePersonLastContact` below are the one place that comparison lives,
 * so `logActivity` and `recordContact` can never disagree on it.
 *
 * `Activity` and the `logActivity`/`recordContact` input schemas live in
 * `electron/shared/activity.ts` (ADR-007), not here — see that module's
 * header, and `companies.ts`'s header for the fuller rationale this repeats.
 */
export { ACTIVITY_KINDS, ACTIVITY_SOURCES, logActivityInputSchema, recordContactEntitySchema }
export type { Activity, ActivityKind, ActivitySource, LogActivityInput, RecordContactEntity }

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Parses `input` against `schema` and strips explicitly-`undefined`-valued
 * keys from the result — see `companies.ts`'s `parseInput` for the full
 * rationale (Electron's structured clone preserves a key set to the literal
 * value `undefined` across the IPC boundary; zod's `.optional()` keeps such a
 * key rather than treating it as absent). Reused unchanged here rather than
 * imported from `companies.ts`: nothing exports it there, and the function
 * itself is table-agnostic — it is the pattern that must not drift, not a
 * shared dependency to wire up.
 */
function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new ValidationError(message, result.error.issues)
  }
  return stripUndefinedValues(result.data)
}

function stripUndefinedValues<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  const cleaned = { ...(value as Record<string, unknown>) }
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined) delete cleaned[key]
  }
  return cleaned as T
}

// ---------------------------------------------------------------------------
// SQLite constraint translation
// ---------------------------------------------------------------------------

interface SqliteConstraintError {
  readonly code: string
  readonly message: string
}

function isSqliteConstraintError(error: unknown): error is SqliteConstraintError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  )
}

type ConstraintHandler = (error: SqliteConstraintError) => RefusalError

/**
 * `activity` declares no `CHECK` and no `UNIQUE` — only three nullable
 * foreign keys (`company_id`, `person_id`, `engagement_id`) and the `NOT
 * NULL` columns `logActivityInputSchema` already validates ahead of SQL. Two
 * branches cover every `SQLITE_CONSTRAINT_*` subcode this table can actually
 * raise; the fallback in `translateWriteError` covers the rest without ever
 * forwarding `error.message`, same discipline as `companies.ts`.
 */
const CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError(
      'This activity references a company, person or engagement that does not exist — check companyId, personId and engagementId.',
      { reason: 'foreign-key' }
    ),
  SQLITE_CONSTRAINT_NOTNULL: () => new RefusalError('A required field was left empty.', { reason: 'not-null' })
}

function translateWriteError(error: unknown): never {
  if (isSqliteConstraintError(error)) {
    const handler = CONSTRAINT_HANDLERS[error.code]
    if (handler) throw handler(error)
    throw new RefusalError('This write violates a database constraint.', { reason: 'constraint' })
  }
  throw error
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface ActivityRow {
  readonly id: string
  readonly occurred_at: string
  readonly kind: string
  readonly title: string
  readonly body: string | null
  readonly company_id: string | null
  readonly person_id: string | null
  readonly engagement_id: string | null
  readonly source: string
  readonly created_at: string
  readonly updated_at: string
}

function mapRow(row: ActivityRow): Activity {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    kind: row.kind as ActivityKind,
    title: row.title,
    body: row.body,
    companyId: row.company_id,
    personId: row.person_id,
    engagementId: row.engagement_id,
    source: row.source as ActivitySource,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getActivityRow(db: Database.Database, id: string): ActivityRow | undefined {
  return db.prepare('SELECT * FROM activity WHERE id = ?').get(id) as ActivityRow | undefined
}

// ---------------------------------------------------------------------------
// Forward-only touch-timestamp maintenance (ADR-001)
// ---------------------------------------------------------------------------

/**
 * Advances `companies.last_touch_at` to `at` — but only if `at` is later than
 * what is already stored, or nothing is stored yet. A `WHERE` clause carries
 * the comparison rather than a read-then-write in JS, so the check and the
 * write are one atomic statement with nothing racing it inside the
 * transaction the caller already holds open.
 *
 * String comparison, not a parsed-Date comparison: every `timestampSchema`
 * value is millisecond-precision ISO-8601 UTC with a fixed-width `Z` suffix
 * (CONVENTIONS.md), the one format family where lexicographic string order
 * and chronological order coincide exactly. `updated_at` moves in the same
 * statement, and only when `last_touch_at` actually advances — a backdated
 * touch that changes nothing about the row does not look like a row that was
 * just written.
 *
 * Deliberately never `MAX(activity.occurred_at)` — see this task's Risks and
 * ADR-001: that would derive the column instead of maintaining it, and
 * silently drop every Gmail-sourced touch `recordContact` writes with no
 * activity row behind it.
 */
function advanceCompanyLastTouch(db: Database.Database, companyId: string, at: string): void {
  const now = nowTimestamp()
  db.prepare(
    `UPDATE companies
     SET last_touch_at = ?, updated_at = ?
     WHERE id = ? AND (last_touch_at IS NULL OR ? > last_touch_at)`
  ).run(at, now, companyId, at)
}

/** As `advanceCompanyLastTouch`, for `people.last_contact_at`. */
function advancePersonLastContact(db: Database.Database, personId: string, at: string): void {
  const now = nowTimestamp()
  db.prepare(
    `UPDATE people
     SET last_contact_at = ?, updated_at = ?
     WHERE id = ? AND (last_contact_at IS NULL OR ? > last_contact_at)`
  ).run(at, now, personId, at)
}

function companyExists(db: Database.Database, id: string): boolean {
  return db.prepare('SELECT 1 FROM companies WHERE id = ?').get(id) !== undefined
}

function personExists(db: Database.Database, id: string): boolean {
  return db.prepare('SELECT 1 FROM people WHERE id = ?').get(id) !== undefined
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ActivityFilters {
  readonly companyId?: string
  readonly personId?: string
  readonly engagementId?: string
  /** Inclusive lower bound on `occurredAt` (a `timestampSchema` value). */
  readonly occurredFrom?: string
  /** Inclusive upper bound on `occurredAt` (a `timestampSchema` value). */
  readonly occurredTo?: string
}

/** Newest first (`occurred_at DESC`) — a read log, not an insert-order dump. */
export function listActivity(db: Database.Database, filters: ActivityFilters = {}): readonly Activity[] {
  const clauses: string[] = []
  const values: unknown[] = []

  if (filters.companyId !== undefined) {
    clauses.push('company_id = ?')
    values.push(filters.companyId)
  }
  if (filters.personId !== undefined) {
    clauses.push('person_id = ?')
    values.push(filters.personId)
  }
  if (filters.engagementId !== undefined) {
    clauses.push('engagement_id = ?')
    values.push(filters.engagementId)
  }
  if (filters.occurredFrom !== undefined) {
    clauses.push('occurred_at >= ?')
    values.push(filters.occurredFrom)
  }
  if (filters.occurredTo !== undefined) {
    clauses.push('occurred_at <= ?')
    values.push(filters.occurredTo)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM activity ${where} ORDER BY occurred_at DESC`).all(...values) as ActivityRow[]
  return rows.map(mapRow)
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getActivity(db: Database.Database, id: string): Activity | null {
  const row = getActivityRow(db, id)
  return row ? mapRow(row) : null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * The only writer of an `activity` row. The insert and the touch-timestamp
 * updates it triggers are one transaction (this task's Risks: "two
 * statements, no transaction" is the exact failure mode this guards against)
 * — a company named on the row advances that company's `last_touch_at`, a
 * person named on it advances that person's `last_contact_at`, and both
 * advance if both are named. If either half throws, `db.transaction` rolls
 * the whole thing back: no activity row is left behind by a touch update
 * that failed, and no touch update is applied for an activity row that
 * failed to insert.
 */
export function logActivity(db: Database.Database, input: unknown): Activity {
  const parsed = parseInput(logActivityInputSchema, input)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const run = db.transaction(() => {
    try {
      db.prepare(
        `INSERT INTO activity (id, occurred_at, kind, title, body, company_id, person_id, engagement_id, source, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        parsed.occurredAt,
        parsed.kind,
        parsed.title,
        parsed.body,
        parsed.companyId ?? null,
        parsed.personId ?? null,
        parsed.engagementId ?? null,
        parsed.source,
        timestamp,
        timestamp
      )
    } catch (error) {
      translateWriteError(error)
    }

    if (parsed.companyId) advanceCompanyLastTouch(db, parsed.companyId, parsed.occurredAt)
    if (parsed.personId) advancePersonLastContact(db, parsed.personId, parsed.occurredAt)
  })

  run()

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection) — same
  // reasoning as createCompany.
  return getActivity(db, id) as Activity
}

/**
 * Moves a company's `last_touch_at` or a person's `last_contact_at` with no
 * `activity` row created — the whole reason ADR-001 rejected deriving either
 * column from `MAX(activity.occurred_at)`: the Gmail adapter (P4-xx) has a
 * timestamp and no message to log. Forward-only, same as the touch update
 * inside `logActivity`, via the same two functions.
 *
 * Throws `NotFoundError` if the named company/person does not exist —
 * `logActivity`'s touch update never needs this check because the
 * `activity.company_id`/`person_id` foreign key already refused the insert
 * for a bad id before the touch code runs; `recordContact` has no insert to
 * lean on, so it checks directly.
 */
export function recordContact(db: Database.Database, entity: unknown, at: unknown): void {
  const parsedEntity = parseInput(recordContactEntitySchema, entity)
  const parsedAt = parseInput(timestampSchema, at)

  const run = db.transaction(() => {
    if ('companyId' in parsedEntity) {
      if (!companyExists(db, parsedEntity.companyId)) {
        throw new NotFoundError('Company', parsedEntity.companyId)
      }
      advanceCompanyLastTouch(db, parsedEntity.companyId, parsedAt)
    } else {
      if (!personExists(db, parsedEntity.personId)) {
        throw new NotFoundError('Person', parsedEntity.personId)
      }
      advancePersonLastContact(db, parsedEntity.personId, parsedAt)
    }
  })

  run()
}
