import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../../shared/format'
import {
  TASK_STATUSES,
  type CreateTaskInput,
  createTaskInputSchema,
  type Task,
  type TaskFilter,
  taskFilterSchema,
  type TaskStatus,
  type UpdateTaskInput,
  updateTaskInputSchema
} from '../../../shared/tasks'
import { DEFAULT_TODO_KIND_ID } from '../../../shared/timeline'
import { NotFoundError, RefusalError } from './errors'
import { parseInput } from './input'
import { type ConstraintHandler, NOT_NULL_HANDLER, PRIMARY_KEY_HANDLER, translateWriteError } from './sqlite-errors'

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
 *    `createTaskInputSchema`/`updateTaskInputSchema` at all — a caller can
 *    only ever *set* it to `true` through `setNextStep`, which always writes
 *    an explicit `1`/`0`, never a patch that could omit it. `updateTask` is
 *    the one other writer, and only ever *clears* it (to `0`) — see its
 *    "next-step invariant" comment — when a write it is already making would
 *    otherwise strand a stale `1` outside `setNextStep`'s reach: reopening a
 *    waiting/done task, or moving a flagged task to a different company.
 *    `setNextStep` remains the only path to `true`.
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
export { TASK_STATUSES, createTaskInputSchema, taskFilterSchema, updateTaskInputSchema }
export type { CreateTaskInput, Task, TaskFilter, TaskStatus, UpdateTaskInput }

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
  { key: 'body', column: 'body' },
  { key: 'kind', column: 'kind' },
  { key: 'status', column: 'status' },
  { key: 'occurredAt', column: 'occurred_at' },
  { key: 'dueOn', column: 'due_on' },
  { key: 'companyId', column: 'company_id' },
  { key: 'engagementId', column: 'engagement_id' },
  { key: 'personId', column: 'person_id' }
]

/** Applied on create only, when the caller omits the field — mirrors companies.ts's CREATE_DEFAULTS. */
const CREATE_DEFAULTS: Partial<Record<WritableKey, unknown>> = {
  status: 'todo',
  // Migration 0010 backfilled every pre-existing row to the same id, so a
  // workspace that upgrades and a workspace that starts fresh agree on what
  // an uncategorised todo is. A caller may still pass `kind: null`
  // explicitly and get a row with no category — the default fills an
  // *omitted* key, not a null one (`stripUndefinedValues`).
  kind: DEFAULT_TODO_KIND_ID
}

// ---------------------------------------------------------------------------
// Status-transition-owned columns: waiting_since / done_at.
//
// "One exported predicate, used everywhere" (this task's Risks) — the two
// call sites that need to know whether a status counts as "open"
// (countOpenTasks's WHERE clause and setNextStep's clear-the-others update)
// both build their SQL from OPEN_STATUS_SQL below rather than each writing
// their own `status NOT IN (...)` fragment that could quietly drift apart.
//
// Review fix (item 3): `isTaskOpen` and `OPEN_STATUS_SQL` used to hand-write
// the same `waiting`/`done` exclusion twice — a JS function and a SQL
// string that "agreed today, by hand" and nothing stopped them drifting.
// Both now derive from the single `NON_OPEN_STATUSES` list below instead of
// restating the exclusion. `isTaskOpen` is also no longer dead: `updateTask`
// calls it to detect a reopening transition (see its "next-step invariant"
// comment).
// ---------------------------------------------------------------------------

/** The one list of statuses that are not "open" — everything else, including `null`, is. */
const NON_OPEN_STATUSES: readonly TaskStatus[] = ['waiting', 'done']

/** `true` for `todo` and for a `null` status; `false` for `waiting` and `done`. */
export function isTaskOpen(status: TaskStatus | null): boolean {
  return status === null || !NON_OPEN_STATUSES.includes(status)
}

/**
 * SQL fragment form of `isTaskOpen`, for use inside a `WHERE`, built from the
 * same `NON_OPEN_STATUSES` list rather than a separately hand-written
 * `NOT IN (...)`. NULL-safe: `status NOT IN (...)` alone evaluates to NULL
 * (excluding the row) when `status` is NULL, which is wrong here — a task
 * with no status set is open, not excluded — so the `OR status IS NULL`
 * branch is required, not decorative.
 */
export const OPEN_STATUS_SQL = `(status IS NULL OR status NOT IN (${NON_OPEN_STATUSES.map((status) => `'${status}'`).join(', ')}))`

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
// SQLite constraint translation — the machinery lives in sqlite-errors.ts;
// only the per-table map below is local.
// ---------------------------------------------------------------------------

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
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface TaskRow {
  readonly id: string
  readonly title: string
  readonly body: string | null
  readonly kind: string | null
  readonly status: string | null
  readonly is_next_step: number | null
  readonly occurred_at: string | null
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
    body: row.body,
    kind: row.kind,
    status: row.status as TaskStatus | null,
    isNextStep: row.is_next_step === 1,
    occurredAt: row.occurred_at,
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

function buildFilterClause(filter: TaskFilter | undefined): { readonly clause: string; readonly values: unknown[] } {
  const conditions: string[] = []
  const values: unknown[] = []

  if (filter?.status !== undefined) {
    conditions.push('status = ?')
    values.push(filter.status)
  }
  if (filter?.kind !== undefined) {
    conditions.push('kind = ?')
    values.push(filter.kind)
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
  if (filter?.open) {
    conditions.push(OPEN_STATUS_SQL)
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
 * each composing their own `status NOT IN (...)` filter. Built on the same
 * `open` filter `listTasks` exposes (this task's review fix item 4), not a
 * separately hand-assembled clause.
 *
 * Review fix (item 5): `OpenTasksFilter` (`Omit<TaskFilter, 'status'>`) keeps
 * a *typed* caller from passing `status` — but `Omit` erases at compile
 * time, not runtime. An unvalidated object crossing IPC as `{ status: 'done'
 * }` arrives here with no type to strip anything from; combined naively with
 * `OPEN_STATUS_SQL` that produces the self-contradicting
 * `status = 'done' AND (status NOT IN ('waiting', 'done'))`, which silently
 * returns 0 instead of surfacing the caller's mistake. `status` is therefore
 * stripped here, at runtime, before the filter reaches `buildFilterClause` —
 * belt-and-suspenders under the type-level `Omit`, not a replacement for it.
 */
export function countOpenTasks(db: Database.Database, filter?: OpenTasksFilter): number {
  const rawFilter: Record<string, unknown> = { ...(filter ?? {}) }
  delete rawFilter.status
  const { clause, values } = buildFilterClause({ ...(rawFilter as TaskFilter), open: true })
  const row = db.prepare(`SELECT COUNT(*) AS count FROM tasks ${clause}`).get(...values) as { count: number }
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
    translateWriteError(CONSTRAINT_HANDLERS, error)
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
  const statusChanged = 'status' in parsed && (parsed.status ?? null) !== (current.status as TaskStatus | null)
  if (statusChanged) {
    const prevStatus = current.status as TaskStatus | null
    const nextStatus = (parsed.status ?? null) as TaskStatus | null
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

  // Review fix (item 1): `setNextStep`'s exclusivity guarantee — "exactly
  // one *open* task per company may be the next step" — only holds for open
  // tasks, so it can be silently broken by writes that never go through
  // `setNextStep` at all:
  //
  //  (A/A2) A task that is the flagged next step moves to `waiting` or
  //  `done`. It drops out of `OPEN_STATUS_SQL`, so a later `setNextStep` for
  //  a sibling task in the same company has nothing to clear — the flagged
  //  task is invisible to it while non-open. If that task is later reopened
  //  (back to `todo`) with the stale flag still set, the company now has TWO
  //  open tasks with `is_next_step = 1`: the reopened one and whatever
  //  `setNextStep` picked while it was away.
  //
  //  (B) A flagged, open task's `companyId` changes. The invariant is
  //  per-company; the flag it carries was only ever exclusive within its
  //  OLD company, and the new company may already have its own next step.
  //
  // Both are fixed the same way, in this same UPDATE (one statement is
  // already one transaction — no separate `db.transaction()` needed here):
  // clear `is_next_step` whenever the row it's currently set on either
  // reopens (a non-open -> open status transition) or changes company.
  // Clearing is the deliberate, safer default over re-asserting the flag —
  // stated per this task's instructions: the company may have chosen a new
  // next step while this task was waiting, done, or in another company, and
  // this function has no way to know that without another read. A caller
  // that wants a fresh next step calls `setNextStep` again, which is exactly
  // what already owns that decision everywhere else.
  //
  // A *done* task's flag is deliberately left alone by everything BUT this
  // reopening case — closed history is not rewritten (Acceptance) — so the
  // only moment this touches a done/waiting task's flag is the moment it
  // stops being done/waiting.
  if (current.is_next_step === 1) {
    const reopened = statusChanged && !isTaskOpen(current.status as TaskStatus | null) && isTaskOpen((parsed.status ?? null) as TaskStatus | null)
    const movedCompany = 'companyId' in parsed && (parsed.companyId ?? null) !== current.company_id
    if (reopened || movedCompany) {
      setClauses.push('is_next_step = 0')
    }
  }

  setClauses.push('updated_at = ?')
  values.push(timestamp)
  values.push(id)

  try {
    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(CONSTRAINT_HANDLERS, error)
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
