import { z } from 'zod'
import { centsSchema, dateOnlySchema, hoursSchema } from './types'

/**
 * `engagements`' wire contract (ADR-007), the second entity module after
 * `electron/shared/companies.ts` — same discipline, same reason: pure zod,
 * no Node imports, typechecked under both `tsconfig.node.json` and
 * `tsconfig.web.json`, so it may only use the ES2022 lib both share and may
 * only import other `electron/shared/**` modules. SQL, `randomUUID`, row
 * mapping and constraint translation stay in
 * `electron/main/db/repositories/engagements.ts`, which imports the types
 * and schemas below rather than redeclaring them.
 *
 * Three schema decisions this file exists to encode, all from this task's
 * "Why":
 *
 * 1. `billingCompanyId` and `clientCompanyId` are independent writable
 *    columns — never coalesced, never a parent/child link between
 *    companies (§5, restated from `companies.ts`'s header on
 *    `billedViaCompanyId`).
 * 2. `endsOn: null` means *rolling*, not "not yet decided" — no default, no
 *    coalesce, anywhere in this file or the repository that imports it.
 * 3. `agreedRateCents` is a snapshot taken at signature. It is writable on
 *    create; the update schemas below still accept the key (so a caller
 *    that echoes a full record back does not get a spurious
 *    `ValidationError`) but the repository never writes it to a column on
 *    `updateEngagement` — see that file's `updateEngagement` for where the
 *    key is deliberately dropped regardless of its presence in the parsed
 *    patch.
 */

/** `schema.ts`'s comment on `status`: "active | pending | proposed | held | delivered | lost". */
export const ENGAGEMENT_STATUSES = ['active', 'pending', 'proposed', 'held', 'delivered', 'lost'] as const
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number]

/** `schema.ts`'s comment on `billing_model`: "retainer | fixed | tm | equity | none". */
export const BILLING_MODELS = ['retainer', 'fixed', 'tm', 'equity', 'none'] as const
export type BillingModel = (typeof BILLING_MODELS)[number]

/** An `engagements` row, camelCased, as read back from the database. */
export interface Engagement {
  readonly id: string
  readonly name: string
  readonly billingCompanyId: string | null
  readonly clientCompanyId: string | null
  readonly serviceVersionId: string | null
  readonly agreedRateCents: number | null
  readonly billingModel: BillingModel | null
  readonly status: EngagementStatus | null
  readonly startedOn: string
  /** `null` means rolling — see this file's header. Never defaulted or coalesced. */
  readonly endsOn: string | null
  readonly renewsOn: string | null
  /** retainer only; `null` on every other billing model. */
  readonly hoursIncluded: number | null
  /** fixed only; `null` on every other billing model. */
  readonly contractValueCents: number | null
  /** tm only; `null` on every other billing model. */
  readonly hourlyRateCents: number | null
  /** tm only; `null` on every other billing model. */
  readonly estimatedHours: number | null
  /** tm only; `null` on every other billing model. */
  readonly notToExceedCents: number | null
  readonly notes: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/** A `milestones` row, camelCased, as read back from the database. Editing stays P3-09 — this repository only reads. */
export interface Milestone {
  readonly id: string
  readonly engagementId: string | null
  readonly name: string | null
  readonly sort: number | null
  readonly completedAt: string | null
  readonly amountCents: number | null
  readonly expectedMonth: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// Shared field shapes
// ---------------------------------------------------------------------------

/**
 * Every column common to all five billing models — everything on the table
 * except `id`/`created_at`/`updated_at` (assigned by the repository),
 * `agreedRateCents` (handled separately below, per this file's header), and
 * the billing-model discriminant plus its model-specific columns (handled
 * per-variant further down). `startedOn` is required, not defaulted — this
 * task's Risks: `started_on` is `NOT NULL` in the schema and a caller that
 * omits it must be rejected, not silently backfilled to today.
 */
const engagementCommonFields = {
  name: z.string().min(1, 'name is required'),
  billingCompanyId: z.string().min(1).nullable(),
  clientCompanyId: z.string().min(1).nullable(),
  serviceVersionId: z.string().min(1).nullable(),
  status: z.enum(ENGAGEMENT_STATUSES).nullable(),
  startedOn: dateOnlySchema,
  endsOn: dateOnlySchema.nullable(),
  renewsOn: dateOnlySchema.nullable(),
  notes: z.string().nullable()
}

/** Every key in `engagementCommonFields` except `name` and `startedOn`, which stay required on create. */
const OPTIONAL_COMMON_KEYS_ON_CREATE = {
  billingCompanyId: true,
  clientCompanyId: true,
  serviceVersionId: true,
  status: true,
  endsOn: true,
  renewsOn: true,
  notes: true
} as const

/** On update every common field is a patch key — present means "set it", absent means "leave it". */
const OPTIONAL_COMMON_KEYS_ON_UPDATE = {
  name: true,
  billingCompanyId: true,
  clientCompanyId: true,
  serviceVersionId: true,
  status: true,
  startedOn: true,
  endsOn: true,
  renewsOn: true,
  notes: true
} as const

// ---------------------------------------------------------------------------
// The discriminated union, on `billingModel` — this task's Risks: "the
// discriminated union widening into one flat optional schema... has to be a
// real union." Each branch below is its own `.strict()` object with only
// its own model-specific columns, so `{ billingModel: 'retainer',
// contractValueCents: … }` fails with an `unrecognized_keys` issue naming
// `contractValueCents`, not a silently-accepted flat shape.
// ---------------------------------------------------------------------------

const retainerCreateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('retainer'),
    hoursIncluded: hoursSchema.nullable()
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_CREATE, agreedRateCents: true, hoursIncluded: true })

const fixedCreateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('fixed'),
    contractValueCents: centsSchema.nullable()
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_CREATE, agreedRateCents: true, contractValueCents: true })

const tmCreateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('tm'),
    hourlyRateCents: centsSchema.nullable(),
    estimatedHours: hoursSchema.nullable(),
    notToExceedCents: centsSchema.nullable()
  })
  .strict()
  .partial({
    ...OPTIONAL_COMMON_KEYS_ON_CREATE,
    agreedRateCents: true,
    hourlyRateCents: true,
    estimatedHours: true,
    notToExceedCents: true
  })

const equityCreateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('equity')
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_CREATE, agreedRateCents: true })

const noneCreateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('none')
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_CREATE, agreedRateCents: true })

/**
 * `billingModel` is required on create (not nullable): every engagement
 * declares one of the five values up front, `'none'` included, so there is
 * no ambiguous "model not yet decided" state to represent — see this file's
 * header.
 */
export const createEngagementInputSchema = z.discriminatedUnion('billingModel', [
  retainerCreateSchema,
  fixedCreateSchema,
  tmCreateSchema,
  equityCreateSchema,
  noneCreateSchema
])
export type CreateEngagementInput = z.infer<typeof createEngagementInputSchema>

// ---------------------------------------------------------------------------
// Update schema — a patch, so every common field is optional whether or not
// the caller is also changing the billing model. A patch that does not
// mention `billingModel` at all (the common case: flipping `status`,
// setting `endsOn`) matches `engagementCommonPatchSchema` below. A patch
// that does include `billingModel` is routed into the same discriminated
// union shape as create, so switching a retainer to `fixed` still cannot
// smuggle in `hoursIncluded` alongside `contractValueCents`. `agreedRateCents`
// is accepted in both branches — this file's header explains why it is
// still rejected by the repository's write path, not by this schema.
// ---------------------------------------------------------------------------

const engagementCommonPatchSchema = z
  .object({ ...engagementCommonFields, agreedRateCents: centsSchema.nullable() })
  .strict()
  .partial()

const retainerUpdateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('retainer'),
    hoursIncluded: hoursSchema.nullable()
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_UPDATE, agreedRateCents: true, hoursIncluded: true })

const fixedUpdateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('fixed'),
    contractValueCents: centsSchema.nullable()
  })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_UPDATE, agreedRateCents: true, contractValueCents: true })

const tmUpdateSchema = z
  .object({
    ...engagementCommonFields,
    agreedRateCents: centsSchema.nullable(),
    billingModel: z.literal('tm'),
    hourlyRateCents: centsSchema.nullable(),
    estimatedHours: hoursSchema.nullable(),
    notToExceedCents: centsSchema.nullable()
  })
  .strict()
  .partial({
    ...OPTIONAL_COMMON_KEYS_ON_UPDATE,
    agreedRateCents: true,
    hourlyRateCents: true,
    estimatedHours: true,
    notToExceedCents: true
  })

const equityUpdateSchema = z
  .object({ ...engagementCommonFields, agreedRateCents: centsSchema.nullable(), billingModel: z.literal('equity') })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_UPDATE, agreedRateCents: true })

const noneUpdateSchema = z
  .object({ ...engagementCommonFields, agreedRateCents: centsSchema.nullable(), billingModel: z.literal('none') })
  .strict()
  .partial({ ...OPTIONAL_COMMON_KEYS_ON_UPDATE, agreedRateCents: true })

const engagementModelPatchSchema = z.discriminatedUnion('billingModel', [
  retainerUpdateSchema,
  fixedUpdateSchema,
  tmUpdateSchema,
  equityUpdateSchema,
  noneUpdateSchema
])

export const updateEngagementInputSchema = z.union([engagementCommonPatchSchema, engagementModelPatchSchema])
export type UpdateEngagementInput = z.infer<typeof updateEngagementInputSchema>
