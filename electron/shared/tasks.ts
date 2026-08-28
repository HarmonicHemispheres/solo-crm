import { z } from 'zod'
import { dateOnlySchema, timestampSchema } from './types'

/**
 * `tasks`' wire contract (ADR-007), following `electron/shared/companies.ts`
 * exactly: the domain type and the create/update zod schemas, as PURE zod
 * with no Node imports, composing `electron/shared/types.ts`'s primitives
 * (`dateOnlySchema` for `dueOn`) rather than redefining a date check
 * locally.
 *
 * `waitingSince`, `doneAt` and `isNextStep` are intentionally absent from
 * the writable schemas below — T-260828-23's Scope: "Status transitions own
 * their timestamps... A caller never writes these three columns directly."
 * `status` itself IS writable (that is how a caller drives a transition);
 * the repository reacts to a `status` change by stamping/clearing
 * `waiting_since`/`done_at` itself, and `is_next_step` is owned entirely by
 * `setNextStep`'s own transaction (see `electron/main/db/repositories/tasks.ts`).
 *
 * SQL, `randomUUID`, row mapping and SQLite constraint translation stay in
 * `electron/main/db/repositories/tasks.ts`, which imports the types and
 * schemas below rather than redeclaring any of them.
 */

/** `schema.ts`'s comment on `status`: "todo | waiting | done". */
export const TASK_STATUSES = ['todo', 'waiting', 'done'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

/**
 * Every writable column except `id`/`created_at`/`updated_at` (assigned by
 * the repository, never by a caller), `waiting_since`/`done_at` (owned by
 * the repository's status-transition logic, not writable directly — this
 * task's Scope and Acceptance), and `is_next_step` (owned by
 * `setNextStep`'s own transaction, not the general create/update path —
 * this task's Risks note on the absent-vs-false trap). `.partial()` below
 * derives the update schema from this one so the two can never drift on
 * which fields exist or how each is validated.
 *
 * `.strict()`: an unknown key — a typo'd field name crossing the IPC
 * boundary — is a `ValidationError`, not a silently-dropped no-op that still
 * bumps `updated_at` and returns what looks like a saved change.
 */
const taskWritableFieldsSchema = z
  .object({
    title: z.string().min(1, 'title is required'),
    status: z.enum(TASK_STATUSES).nullable(),
    dueOn: dateOnlySchema.nullable(),
    companyId: z.string().min(1).nullable(),
    engagementId: z.string().min(1).nullable(),
    personId: z.string().min(1).nullable()
  })
  .strict()

export const createTaskInputSchema = taskWritableFieldsSchema.partial({
  status: true,
  dueOn: true,
  companyId: true,
  engagementId: true,
  personId: true
})
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>

export const updateTaskInputSchema = taskWritableFieldsSchema.partial()
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>

/**
 * `listTasks`'/`countOpenTasks`' filter — moved here from a bare TypeScript
 * interface in `electron/main/db/repositories/tasks.ts` (review fix, ADR-007
 * rule 5), matching `activityFiltersSchema`'s identical move into
 * `electron/shared/activity.ts` in the same diff: every read filter that
 * crosses IPC gets a zod schema in its entity's shared module, imported by
 * both the repository (as a type) and `electron/shared/ipc-types.ts` (as the
 * request schema) — never redeclared in either.
 *
 * `.strict()`, matching every other filter/input schema in this file: an
 * unknown key crossing the IPC boundary is a `ValidationError`, not a
 * silently-ignored no-op. `countOpenTasks`'s `OpenTasksFilter` — this schema
 * minus `status` — stays declared in the repository as
 * `Omit<TaskFilter, 'status'>`, the same derivation it already used, since it
 * is not itself a wire shape: `tasks:countOpen`'s request schema derives its
 * own `.omit({ status: true })` view straight from `taskFilterSchema` below.
 */
export const taskFilterSchema = z
  .object({
    status: z.enum(TASK_STATUSES).optional(),
    companyId: z.string().min(1).optional(),
    engagementId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    /** Inclusive lower bound on `dueOn` (a `dateOnlySchema` value). */
    dueFrom: dateOnlySchema.optional(),
    /** Inclusive upper bound on `dueOn` (a `dateOnlySchema` value). */
    dueTo: dateOnlySchema.optional(),
    /**
     * `true` applies `OPEN_STATUS_SQL`
     * (`electron/main/db/repositories/tasks.ts`), the single definition of
     * "open"; `false`/`undefined` apply no open/closed restriction.
     */
    open: z.boolean().optional()
  })
  .strict()
export type TaskFilter = z.infer<typeof taskFilterSchema>

/** A `tasks` row, camelCased, as read back from the database — `tasks:list`'s, `tasks:get`'s and every mutation channel's response shape (ADR-007 rule 5). */
export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(TASK_STATUSES).nullable(),
  isNextStep: z.boolean(),
  dueOn: dateOnlySchema.nullable(),
  waitingSince: timestampSchema.nullable(),
  doneAt: timestampSchema.nullable(),
  companyId: z.string().nullable(),
  engagementId: z.string().nullable(),
  personId: z.string().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type Task = z.infer<typeof taskSchema>
