import { z } from 'zod'
import { dateOnlySchema, timestampSchema } from './types'

/**
 * `companies`' wire contract (ADR-007): the domain type and the create/update
 * zod schemas, as PURE zod with no Node imports — the same discipline
 * `electron/shared/types.ts` and `electron/shared/ipc-types.ts` already
 * follow, and for the identical reason (see `ipc-types.ts`'s header comment
 * on TS6307): this module is typechecked under both `tsconfig.node.json`
 * (main + preload) and `tsconfig.web.json` (renderer), so it may only use
 * the ES2022 lib both share and may only import other `electron/shared/**`
 * modules.
 *
 * This file composes `electron/shared/types.ts`'s primitives (`dateOnlySchema`
 * for `since`) rather than redefining a date check locally — the same rule
 * CONVENTIONS.md states and `types.ts` enforces.
 *
 * SQL, `randomUUID`, row mapping (snake_case -> camelCase) and SQLite
 * constraint translation stay in
 * `electron/main/db/repositories/companies.ts`, which imports the types and
 * schemas below rather than redeclaring any of them. ADR-007 makes this
 * split — wire schema in shared, persistence in main — the pattern the next
 * five repositories (people, engagements, tasks, activity, affiliations)
 * follow, not a one-off for companies.
 */

/** `schema.ts`'s comment on `kind`: "client | prospect | end_client | advisory | channel". */
export const COMPANY_KINDS = ['client', 'prospect', 'end_client', 'advisory', 'channel'] as const
export type CompanyKind = (typeof COMPANY_KINDS)[number]

/** A `companies` row, camelCased, as read back from the database — `companies:list`'s, `companies:get`'s and every mutation channel's response shape (ADR-007 rule 5: the read shape lives beside the write schemas, derived with `z.infer` rather than a hand-maintained interface, so an added column cannot silently stop at the repository the way `registry.ts`'s `satisfies` alone would let it). */
export const companySchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(COMPANY_KINDS).nullable(),
  website: z.string().nullable(),
  billsDirectly: z.boolean().nullable(),
  billedViaCompanyId: z.string().nullable(),
  introducedByCompanyId: z.string().nullable(),
  cadenceDays: z.number().int().nullable(),
  /**
   * ADR-001: owned by the activity repository (T-260828-24), written in the
   * same transaction as an activity insert, and never moves backward. Not a
   * writable field on this repository's create/update schemas below — see
   * this task's Scope 7 fix — but still part of what a read returns.
   */
  lastTouchAt: timestampSchema.nullable(),
  budgetNote: z.string().nullable(),
  notes: z.string().nullable(),
  since: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type Company = z.infer<typeof companySchema>

/**
 * Every writable column except `id`/`created_at`/`updated_at` (assigned by
 * the repository, never by a caller) and `last_touch_at` (ADR-001: owned by
 * the activity repository, not writable here). `.partial()` below derives
 * the update schema from this one so the two can never drift on which fields
 * exist or how each is validated.
 *
 * `.strict()`: an unknown key — a typo'd field name crossing the IPC
 * boundary — is a `ValidationError`, not a silently-dropped no-op that still
 * bumps `updated_at` and returns what looks like a saved change.
 */
const companyWritableFieldsSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    kind: z.enum(COMPANY_KINDS).nullable(),
    website: z.string().nullable(),
    billsDirectly: z.boolean().nullable(),
    billedViaCompanyId: z.string().min(1).nullable(),
    introducedByCompanyId: z.string().min(1).nullable(),
    cadenceDays: z.number().int().positive().nullable(),
    budgetNote: z.string().nullable(),
    notes: z.string().nullable(),
    since: dateOnlySchema.nullable()
  })
  .strict()

export const createCompanyInputSchema = companyWritableFieldsSchema.partial({
  kind: true,
  website: true,
  billsDirectly: true,
  billedViaCompanyId: true,
  introducedByCompanyId: true,
  cadenceDays: true,
  budgetNote: true,
  notes: true,
  since: true
})
export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>

export const updateCompanyInputSchema = companyWritableFieldsSchema.partial()
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>
