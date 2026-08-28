import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import {
  TASK_STATUSES,
  type CreateTaskInput,
  createTaskInputSchema,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
  updateTaskInputSchema
} from '../../../shared/tasks'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * The `tasks` repository (T-260828-23), built on `companies.ts`'s pattern
 * (T-260828-20) — `parseInput`/`stripUndefinedValues`, the `FIELD_SPECS`
 * column-mapping table, and `SQLITE_CONSTRAINT_*` dispatch are copied
 * verbatim in shape, not reinvented.
 *
 * Two things are unique to this table and are NOT the companies pattern:
 *
 * 1. `setNextStep` — a single-writer invariant ("exactly one *open* task per
 *    company may be the next step") enforced by one `db.transaction()` that
 *    clears `is_next_step` from every other open task for the company before
 *    setting it on the target. `is_next_step` is not part of
 *    `createTaskInputSchema`/`updateTaskInputSchema` at all — the only way a
 *    caller can move it is through this function, which always writes an
 *    explicit `1`/`0`, never a patch that could omit it.
 * 2. Status-transition-owned timestamps — `waiting_since` and `done_at` are
 *    likewise absent from the writable schemas (see `shared/tasks.ts`'s
 *    header comment); `statusTransitionColumns` below is the one place that
 *    derives them from a `status` change, used by both `createTask` (an
 *    implicit transition from "no previous status") and `updateTask` (an
 *    explicit transition from the row's current status), so the stamping
 *    rule can only be expressed once.
 *
 * `Task` and the create/update zod schemas live in `electron/shared/tasks.ts`
 * (ADR-007), not here — see that file's header comment, identical reasoning
 * to `companies.ts`'s.
 */
export { TASK_STATUSES, createTaskInputSchema, updateTaskInputSchema }
export type { CreateTaskInput, Task, TaskStatus, UpdateTaskInput }

// ---------------------------------------------------------------------------
// Input parsing — identical to companies.ts's parseInput/stripUndefinedValues.
// ---------------------------------------------------------------------------

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new ValidationError(message, result.error.issues)
  }
  // See companies.ts's parseInput for why this matters: zod's `.partial()`
  // marks a field optional, not absent, so a caller's `{ field: undefined }`
  // (the shape a renderer's `{ field: dirty ? value : undefined }` naturally
  // produces, preserved across Electron's structured-clone IPC boundary)
  // still parses with the key present, holding `undefined`. Every write path
  // below distinguishes "key absent" from "key present" via `in`, so an
  // undefined-valued key left in `result.data` would read as "the caller
  // explicitly set this" and wipe a column to NULL or skip a documented
  // default.
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
// Column mapping — shared between createTask and updateTask, same reasoning
// as companies.ts's FIELD_SPECS.
// ---------------------------------------------------------------------------

type WritableKey = keyof CreateTaskInput

interface FieldSpec {
  readonly key: WritableKey
  readonly column: string
}

const FIELD_SPECS: readonly FieldSpec[] = [
  { key: 'title', column: 'title' },
  { key: 'status', column: 'status' },
  { key: 'dueOn', column: 'due_on' },
  { key: 'companyId', column: 'company_id' },
  { key: 'engagementId', column: 'engagement_id' },
  { key: 'personId', column: 'person_id' }
]

/** Applied on create only, when the caller omits the field — mirrors companies.ts's CREATE_DEFAULTS. */
const CREATE_DEFAULTS: Partial<Record<WritableKey, unknown>> = {
  status: 'todo'
}

// ---------------------------------------------------------------------------
// Status-transition-owned columns: waiting_since / done_at.
//
// "One exported predicate, used everywhere" (this task's Risks) — the two
// call sites that need to know whether a status counts as "open"
// (countOpenTasks's WHERE clause and setNextStep's clear-the-others update)
// both build their SQL from OPEN_STATUS_SQL below rather than each writing
// their own `status NOT IN (...)` fragment that could quietly drift apart.
// ---------------------------------------------------------------------------

/** `true` for `todo` and for a `null` status; `false` for `waiting` and `done`. */
export function isTaskOpen(status: TaskStatus | null): boolean {
  return status !== 'waiting' && status !== 'done'
}

/**
 * SQL fragment form of `isTaskOpen`, for use inside a `WHERE`. NULL-safe:
 * `status NOT IN (...)` alone evaluates to NULL (excluding the row) when
 * `status` is NULL, which is wrong here — a task with no status set is open,
 * not excluded — so the `OR status IS NULL` branch is required, not
 * decorative.
 */
const OPEN_STATUS_SQL = "(status IS NULL OR status NOT IN ('waiting', 'done'))"

interface StatusTransitionColumns {
  readonly waitingSince?: string | null
  readonly doneAt?: string | null
}

/**
 * Derives the `waiting_since`/`done_at` writes a `status` change implies.
 * Only a key that actually needs writing is present on the result — a
 * transition that touches neither timestamp (e.g. `todo` -> `todo`, or a
 * patch that never mentions `status`) returns `{}` so callers don't emit a
 * no-op `SET waiting_since = waiting_since`.
 *
 * `prevStatus: null` (used by `createTask`, which has no prior row) is
 * treated as "neither waiting nor done" — the same as a fresh `todo` row —
 * so creating a task directly into `waiting` or `done` still stamps the
 * matching timestamp.
 */
function statusTransitionColumns(prevStatus: TaskStatus | null, nextStatus: TaskStatus | null, timestamp: string): StatusTransitionColumns {
  const result: { waitingSince?: string | null; doneAt?: string | null } = {}

  const wasWaiting = prevStatus === 'waiting'
  const isWaiting = nextStatus === 'waiting'
  if (isWaiting && !wasWaiting) result.waitingSince = timestamp
  else if (wasWaiting && !isWaiting) result.waitingSince = null

  const wasDone = prevStatus === 'done'
  const isDone = nextStatus === 'done'
  if (isDone && !wasDone) result.doneAt = timestamp
  else if (wasDone && !isDone) result.doneAt = null

  return result
}

// ---------------------------------------------------------------------------
// SQLite constraint translation — same shape as companies.ts's.
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

type ConstraintHandler = () => RefusalError

/**
 * `tasks` declares no `CHECK` and no `UNIQUE` constraint (migration 0001) —
 * only the three foreign keys (`company_id`, `engagement_id`, `person_id`)
 * and the `id` primary key. Unlike companies.ts's `CHECK` handler, a single
 * `FOREIGNKEY` message covers all three columns rather than disambiguating,
 * because better-sqlite3's error carries no column detail to disambiguate
 * with — the same reasoning as companies.ts's own "no raw driver text"
 * comment, just with less to work with here.
 */
const CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This write references a company, engagement or person that does not exist.', { reason: 'foreign-key' }),
  SQLITE_CONSTRAINT_NOTNULL: () => new RefusalError('A required field was left empty.', { reason: 'not-null' }),
  SQLITE_CONSTRAINT_PRIMARYKEY: () => new RefusalError('This id is already in use.', { reason: 'primary-key' })
}

function translateWriteError(error: unknown): never {
  if (isSqliteConstraintError(error)) {
    const handler = CONSTRAINT_HANDLERS[error.code]
    if (handler) throw handler()
    throw new RefusalError('This write violates a database constraint.', { reason: 'constraint' })
  }
  throw error
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface TaskRow {
  readonly id: string
  readonly title: string
  readonly status: string | null
  readonly is_next_step: number | null
  readonly due_on: string | null
  readonly waiting_since: string | null
  readonly done_at: string | null
  readonly company_id: string | null
  readonly engagement_id: string | null
  readonly person_id: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    status: row.status as TaskStatus | null,
    isNextStep: row.is_next_step === 1,
    dueOn: row.due_on,
    waitingSince: row.waiting_since,
    doneAt: row.done_at,
    companyId: row.company_id,
    engagementId: row.engagement_id,
    personId: row.person_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getTaskRow(db: Database.Database, id: string): TaskRow | undefined {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface TaskFilter {
  readonly status?: TaskStatus
  readonly companyId?: string
  readonly engagementId?: string
  readonly personId?: string
  /** Inclusive lower bound on `due_on` (`dateOnlySchema` shape). */
  readonly dueFrom?: string
  /** Inclusive upper bound on `due_on` (`dateOnlySchema` shape). */
  readonly dueTo?: string
}

function buildFilterClause(filter: TaskFilter | undefined): { readonly clause: string; readonly values: unknown[] } {
  const conditions: string[] = []
  const values: unknown[] = []

  if (filter?.status !== undefined) {
    conditions.push('status = ?')
    values.push(filter.status)
  }
  if (filter?.companyId !== undefined) {
    conditions.push('company_id = ?')
    values.push(filter.companyId)
  }
  if (filter?.engagementId !== undefined) {
    conditions.push('engagement_id = ?')
    values.push(filter.engagementId)
  }
  if (filter?.personId !== undefined) {
    conditions.push('person_id = ?')
    values.push(filter.personId)
  }
  if (filter?.dueFrom !== undefined) {
    conditions.push('due_on >= ?')
    values.push(filter.dueFrom)
  }
  if (filter?.dueTo !== undefined) {
    conditions.push('due_on <= ?')
    values.push(filter.dueTo)
  }

  return { clause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', values }
}

/**
 * Due-date-first ordering (open-ended tasks sort last, then earliest due
 * date, then creation order) — a reasonable default for a Todos-style
 * reader; no acceptance criterion pins the order, so this is not a contract
 * a caller should rely on beyond "stable and deterministic".
 */
export function listTasks(db: Database.Database, filter?: TaskFilter): readonly Task[] {
  const { clause, values } = buildFilterClause(filter)
  const rows = db
    .prepare(`SELECT * FROM tasks ${clause} ORDER BY (due_on IS NULL), due_on, created_at`)
    .all(...values) as TaskRow[]
  return rows.map(mapRow)
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getTask(db: Database.Database, id: string): Task | null {
  const row = getTaskRow(db, id)
  return row ? mapRow(row) : null
}

export type OpenTasksFilter = Omit<TaskFilter, 'status'>

/**
 * The single definition of "open" (this task's Risks: "'Open' defined
 * twice... One exported predicate, used everywhere") — `waiting` and `done`
 * excluded, everything else (including a `null` status) counted. The Todos
 * view's owed count and Today's next-step count both call this rather than
 * each composing their own `status NOT IN (...)` filter.
 */
export function countOpenTasks(db: Database.Database, filter?: OpenTasksFilter): number {
  const { clause, values } = buildFilterClause(filter)
  const openClause = clause ? `${clause} AND ${OPEN_STATUS_SQL}` : `WHERE ${OPEN_STATUS_SQL}`
  const row = db.prepare(`SELECT COUNT(*) AS count FROM tasks ${openClause}`).get(...values) as { count: number }
  return row.count
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function createTask(db: Database.Database, input: unknown): Task {
  const parsed = parseInput(createTaskInputSchema, input)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const finalStatus = ('status' in parsed ? parsed.status : (CREATE_DEFAULTS.status as TaskStatus)) ?? null
  const statusColumns = statusTransitionColumns(null, finalStatus, timestamp)

  const columns = [
    'id',
    ...FIELD_SPECS.map((spec) => spec.column),
    'is_next_step',
    'waiting_since',
    'done_at',
    'created_at',
    'updated_at'
  ]
  const placeholders = columns.map(() => '?').join(', ')
  const values: unknown[] = [id]
  for (const spec of FIELD_SPECS) {
    const raw = spec.key in parsed ? parsed[spec.key] : (CREATE_DEFAULTS[spec.key] ?? null)
    values.push(raw)
  }
  // `is_next_step` is never settable through createTaskInputSchema (see this
  // module's header comment) — every task is created with it `false`; the
  // only path to `true` is `setNextStep`.
  values.push(0)
  values.push(statusColumns.waitingSince ?? null)
  values.push(statusColumns.doneAt ?? null)
  values.push(timestamp, timestamp)

  try {
    db.prepare(`INSERT INTO tasks (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  } catch (error) {
    translateWriteError(error)
  }

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return getTask(db, id) as Task
}

export function updateTask(db: Database.Database, id: string, patch: unknown): Task {
  const parsed = parseInput(updateTaskInputSchema, patch)

  const current = getTaskRow(db, id)
  if (!current) {
    throw new NotFoundError('Task', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  for (const spec of FIELD_SPECS) {
    // `in`, not a truthiness/undefined check — see companies.ts's updateCompany
    // for why: distinguishes "the caller explicitly set this to null" from
    // "the caller did not mention this field", correct now that parseInput
    // has already stripped explicitly-undefined keys down to genuinely
    // absent ones.
    if (!(spec.key in parsed)) continue
    setClauses.push(`${spec.column} = ?`)
    values.push(parsed[spec.key])
  }

  const timestamp = nowTimestamp()

  // Status transitions own waiting_since/done_at (this task's Scope) — only
  // recomputed when the patch actually mentions `status`, and only when it
  // differs from the row's current value (a patch that resends the same
  // status is a no-op on these two columns, not a re-stamp).
  if ('status' in parsed) {
    const prevStatus = current.status as TaskStatus | null
    const nextStatus = (parsed.status ?? null) as TaskStatus | null
    if (nextStatus !== prevStatus) {
      const statusColumns = statusTransitionColumns(prevStatus, nextStatus, timestamp)
      if ('waitingSince' in statusColumns) {
        setClauses.push('waiting_since = ?')
        values.push(statusColumns.waitingSince)
      }
      if ('doneAt' in statusColumns) {
        setClauses.push('done_at = ?')
        values.push(statusColumns.doneAt)
      }
    }
  }

  setClauses.push('updated_at = ?')
  values.push(timestamp)
  values.push(id)

  try {
    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(error)
  }

  return getTask(db, id) as Task
}

/**
 * No table in migration 0001 declares a foreign key pointing at `tasks.id`
 * (unlike `companies`, which eight columns across six tables reference) —
 * so, unlike `deleteCompany`, there is no `refuseIfReferenced` blocker list
 * to run first. This is a deliberate absence, verified by reading migration
 * 0001, not an oversight: the pattern this repository follows
 * (`refuseIfReferenced` before every delete) is a guard against exactly the
 * FK this table does not have.
 */
export function deleteTask(db: Database.Database, id: string): void {
  const row = getTaskRow(db, id)
  if (!row) {
    throw new NotFoundError('Task', id)
  }
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

/**
 * Enforces "exactly one open task per company may be the next step" (this
 * task's Why). Runs as one `db.transaction()` (this task's Risks: "as two
 * statements outside a transaction... leaves a company with no next step")
 * so a failure between the clear and the set is impossible — either both
 * happen or neither does.
 *
 * A task with no `company_id` is refused, not silently accepted with no
 * effect: the Scope is explicit that such a task "cannot be a company's
 * next step", so setting it "next step" on a companyless task is a caller
 * error worth surfacing, not a no-op.
 *
 * Only *open* other tasks (`isTaskOpen`/`OPEN_STATUS_SQL`) are cleared — a
 * `done` task's `is_next_step` is closed history and is not rewritten (this
 * task's Acceptance); a `waiting` task's flag is likewise left alone, which
 * is safe because `waiting` is already excluded from `countOpenTasks`, so a
 * stale flag on a non-open task cannot violate the "exactly one open next
 * step" invariant the count and the views actually read.
 */
export function setNextStep(db: Database.Database, taskId: string): Task {
  const run = db.transaction(() => {
    const target = getTaskRow(db, taskId)
    if (!target) {
      throw new NotFoundError('Task', taskId)
    }
    if (!target.company_id) {
      throw new RefusalError('A task with no company cannot be set as that company\'s next step.', {
        reason: 'no-company'
      })
    }

    const timestamp = nowTimestamp()

    db.prepare(
      `UPDATE tasks SET is_next_step = 0, updated_at = ? WHERE company_id = ? AND id != ? AND is_next_step = 1 AND ${OPEN_STATUS_SQL}`
    ).run(timestamp, target.company_id, taskId)

    db.prepare('UPDATE tasks SET is_next_step = 1, updated_at = ? WHERE id = ?').run(timestamp, taskId)
  })

  run()

  return getTask(db, taskId) as Task
}
