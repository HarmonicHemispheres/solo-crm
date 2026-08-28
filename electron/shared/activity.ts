import { z } from 'zod'
import { timestampSchema } from './types'

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

/** `schema.ts`'s comment on `activity.kind`: "call | email | meeting | note". */
export const ACTIVITY_KINDS = ['call', 'email', 'meeting', 'note'] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]

/**
 * Writable sources only — `schema.ts`'s comment on `activity.source`: "manual
 * | gcal — 'gmail' is reserved with no writer (ADR-001)". Not the full set of
 * values the column could ever theoretically hold; the set this repository
 * will ever insert.
 */
export const ACTIVITY_SOURCES = ['manual', 'gcal'] as const
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number]

/** An `activity` row, camelCased, as read back from the database. */
export interface Activity {
  readonly id: string
  readonly occurredAt: string
  readonly kind: ActivityKind
  readonly title: string
  readonly body: string | null
  readonly companyId: string | null
  readonly personId: string | null
  readonly engagementId: string | null
  readonly source: ActivitySource
  readonly createdAt: string
  readonly updatedAt: string
}

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
    kind: z.enum(ACTIVITY_KINDS),
    title: z.string().min(1, 'title is required'),
    body: z.string().nullable(),
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
