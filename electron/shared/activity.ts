import { z } from 'zod'
import { timelineKindIdSchema } from './timeline'
import { dateOnlySchema, timestampSchema } from './types'

/**
 * `activity`'s wire contract (ADR-007), following `electron/shared/companies.ts`'s
 * template exactly — pure zod, no Node imports, typechecked under both
 * `tsconfig.node.json` and `tsconfig.web.json`. See that file's header for the
 * TS6307 reasoning this module inherits unchanged.
 *
 * This module composes `electron/shared/types.ts`'s `timestampSchema` for
 * `occurredAt` rather than redefining a date/time check locally — the same
 * rule CONVENTIONS.md states and `types.ts` enforces.
 *
 * `activity` is append-only (G8, ADR-001): the repository
 * (`electron/main/db/repositories/activity.ts`) exposes `logActivity` as the
 * only writer, plus `recordContact` for the Gmail adapter's direct
 * denormalised-column write. There is no update or delete input schema here
 * because there is no update or delete operation — see that module's header
 * for why a SQLite trigger cannot stand in for this boundary.
 *
 * `source: 'gmail'` is reserved (ADR-001: the Gmail adapter writes
 * `companies.last_touch_at` / `people.last_contact_at` directly via
 * `recordContact` and never inserts an activity row) — `ACTIVITY_SOURCES`
 * below deliberately omits it, so `logActivityInputSchema` rejects it rather
 * than accepting a value with no writer.
 */

/**
 * `kind` is no longer a closed enum. It used to be `['call', 'email',
 * 'meeting', 'note']` — declared here as `ACTIVITY_KINDS` and imported by
 * five call sites as a `Record<ActivityKind, …>` key — and it is now the
 * operator's own editable category list, stored in `settings` under
 * `timeline.kinds` and validated on the wire for shape alone
 * (`electron/shared/timeline.ts`, whose header explains why the category
 * merged into this column rather than arriving beside it).
 *
 * The four old values are seeded into that list by
 * `DEFAULT_TIMELINE_KINDS`, so every row written before migration 0010
 * keeps the label it had. A row whose category the operator later removes
 * still renders, through `resolveTimelineKind`'s fallback — which it has to,
 * because an `activity` row cannot be edited to repair it (G8).
 */
export type ActivityKind = string

/**
 * Writable sources only — `schema.ts`'s comment on `activity.source`: "manual
 * | gcal — 'gmail' is reserved with no writer (ADR-001)". Not the full set of
 * values the column could ever theoretically hold; the set this repository
 * will ever insert.
 */
export const ACTIVITY_SOURCES = ['manual', 'gcal'] as const
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

/** An `activity` row, camelCased, as read back from the database — `activity:list`'s, `activity:get`'s and `activity:log`'s response shape (ADR-007 rule 5). */
export const activitySchema = z.object({
  id: z.string(),
  occurredAt: timestampSchema,
  kind: timelineKindIdSchema,
  title: z.string(),
  body: z.string().nullable(),
  /**
   * When the thing this row records is *due* — the other half of the pair
   * the operator asked both notes and todos to carry, alongside
   * `occurredAt`'s "when it happened". Date-only, matching `tasks.due_on`
   * exactly, so the merged timeline compares the two tables' due dates
   * without converting between a date and an instant.
   *
   * Almost always `null`: a logged touch is a thing that has happened, and
   * a due date on it is the exception (a note that carries its own
   * follow-up deadline without being a todo in its own right).
   */
  dueOn: dateOnlySchema.nullable(),
  companyId: z.string().nullable(),
  personId: z.string().nullable(),
  engagementId: z.string().nullable(),
  source: z.enum(ACTIVITY_SOURCES),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type Activity = z.infer<typeof activitySchema>

/**
 * `logActivity`'s input. `occurredAt`, `kind`, `title`, `body` and `source`
 * are required keys (a domain event has to say when it happened, what kind it
 * was, and where it came from); `body` may still hold `null` — not every
 * logged call has notes worth keeping. `companyId`/`personId`/`engagementId`
 * are the only genuinely optional keys — an activity row may name none, one,
 * or several of the three.
 *
 * `.strict()`: an unknown key is a `ValidationError`, not a silently-dropped
 * no-op — the same reasoning as `companies.ts`'s writable-fields schema.
 */
export const logActivityInputSchema = z
  .object({
    occurredAt: timestampSchema,
    kind: timelineKindIdSchema,
    title: z.string().min(1, 'title is required'),
    body: z.string().nullable(),
    /** Optional on the way in — see `activitySchema`'s note. An omitted key and an explicit `null` both store `NULL`. */
    dueOn: dateOnlySchema.nullable().optional(),
    companyId: z.string().min(1).nullable().optional(),
    personId: z.string().min(1).nullable().optional(),
    engagementId: z.string().min(1).nullable().optional(),
    source: z.enum(ACTIVITY_SOURCES)
  })
  .strict()
export type LogActivityInput = z.infer<typeof logActivityInputSchema>

/**
 * `recordContact`'s entity argument: exactly one of a company or a person —
 * never both, never neither. A discriminated-by-key union rather than an
 * `entityType`/`entityId` pair so `.strict()` on each branch rejects the
 * other id key outright (passing both `companyId` and `personId` is a
 * `ValidationError`, not "the second one wins").
 */
export const recordContactEntitySchema = z.union([
  z.object({ companyId: z.string().min(1) }).strict(),
  z.object({ personId: z.string().min(1) }).strict()
])
export type RecordContactEntity = z.infer<typeof recordContactEntitySchema>

/**
 * `listActivity`'s filter — moved here from a bare TypeScript interface in
 * `electron/main/db/repositories/activity.ts` (T-260828-24's review,
 * carried into this task): every other repository's read filter that
 * crosses IPC gets a zod schema in its `electron/shared/<entity>.ts` module,
 * and `activity:list` (this task) needs exactly that to declare its request
 * schema per ADR-007 rule 5 — importing it, not redeclaring its fields a
 * second time in `electron/shared/ipc-types.ts`.
 *
 * `.strict()`, matching every other filter/input schema in this file: an
 * unknown key crossing the IPC boundary is a `ValidationError`, not a
 * silently-ignored no-op.
 */
export const activityFiltersSchema = z
  .object({
    companyId: z.string().min(1).optional(),
    personId: z.string().min(1).optional(),
    engagementId: z.string().min(1).optional(),
    /** Inclusive lower bound on `occurredAt` (a `timestampSchema` value). */
    occurredFrom: timestampSchema.optional(),
    /** Inclusive upper bound on `occurredAt` (a `timestampSchema` value). */
    occurredTo: timestampSchema.optional()
  })
  .strict()
export type ActivityFilters = z.infer<typeof activityFiltersSchema>
