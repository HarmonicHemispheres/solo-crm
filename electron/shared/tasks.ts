import { z } from 'zod'
import { dateOnlySchema } from './types'

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

/** A `tasks` row, camelCased, as read back from the database. */
export interface Task {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus | null
  readonly isNextStep: boolean
  readonly dueOn: string | null
  readonly waitingSince: string | null
  readonly doneAt: string | null
  readonly companyId: string | null
  readonly engagementId: string | null
  readonly personId: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

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
