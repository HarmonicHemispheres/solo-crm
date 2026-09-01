import { z } from 'zod'
import { centsSchema, dateOnlySchema, timestampSchema } from './types'

/**
 * The offerings catalogue's wire contract (ADR-007) — `offering_categories`,
 * `offerings` and `offering_versions`, following the same discipline as
 * `electron/shared/companies.ts` and `electron/shared/engagements.ts`: pure
 * zod, no Node imports, typechecked under both `tsconfig.node.json` and
 * `tsconfig.web.json`, so it may only use the ES2022 lib both share and may
 * only import other `electron/shared/**` modules. SQL, `randomUUID`, row
 * mapping and constraint translation stay in
 * `electron/main/db/repositories/offerings.ts`, which imports the types and
 * schemas below rather than redeclaring them.
 *
 * Three vocabularies this file exists to close (T-260901-05's Scope).
 * `type`, `billing_model` and `unit` are nullable free-text columns whose
 * accepted values live only in a comment on `schema.ts` and in
 * `seed/fixture.ts`'s `OfferingSeed` doc-comments. Declaring them as `as
 * const` tuples here — the same shape `ENGAGEMENT_STATUSES` and
 * `COMPANY_KINDS` already take — makes the repository edge the enforcement
 * point, so `type: 'widget'` is a `ValidationError` rather than a row that
 * reads back and matches no filter. **Deliberately not a `CHECK` constraint
 * and deliberately not `NOT NULL`**: both are migrations, and this task has
 * none. The columns stay nullable, and every schema below reflects that.
 *
 * Nothing here computes money. An offering's rate is a stored column read
 * back for display, which ADR-003 permits explicitly; summing, projecting or
 * branching on `billingModel` to produce a figure is `revenue_lines`' job
 * (P3-05) and appears nowhere in this file or the repository that imports it.
 */

/** `schema.ts`'s comment on `offerings.type`: "service | product". */
export const OFFERING_TYPES = ['service', 'product'] as const
export type OfferingType = (typeof OFFERING_TYPES)[number]

/**
 * `schema.ts`'s comment on `offerings.billing_model`: "retainer | fixed | tm".
 *
 * Three values, not the five of `BILLING_MODELS` in
 * `electron/shared/engagements.ts` — an engagement can also be `equity` or
 * `none`, a catalogue entry cannot. The two are deliberately separate
 * constants rather than one shared tuple with a subset: they answer different
 * questions (what this priced thing *is* vs. how this signed deal bills), and
 * collapsing them would let an offering be created as `equity` the moment
 * someone widened the engagement list.
 */
export const OFFERING_BILLING_MODELS = ['retainer', 'fixed', 'tm'] as const
export type OfferingBillingModel = (typeof OFFERING_BILLING_MODELS)[number]

/**
 * `schema.ts`'s comment on `offerings.unit`: "fixed | from | mo | hr".
 *
 * How the rate is *quoted*, not how it is billed: `fixed` is a flat price,
 * `from` a starting price, `mo` per month, `hr` per hour. `fixed` appearing
 * in both this tuple and `OFFERING_BILLING_MODELS` is a coincidence of
 * spelling, not a shared value — the seed pairs `billingModel: 'fixed'` with
 * `unit: 'from'` on two of its nine offerings.
 */
export const OFFERING_UNITS = ['fixed', 'from', 'mo', 'hr'] as const
export type OfferingUnit = (typeof OFFERING_UNITS)[number]

// ---------------------------------------------------------------------------
// Read shapes (ADR-007 rule 5: the read shape lives beside the write schemas,
// derived with `z.infer` rather than a hand-maintained interface)
// ---------------------------------------------------------------------------

/** An `offering_categories` row, camelCased, as read back from the database. */
export const offeringCategorySchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  /** A hex swatch the view colours the category chip with. Free text — the seed writes `#C9A84C`-style values; nothing here validates the format. */
  color: z.string().nullable(),
  /** Manual display order, ascending. Nullable: an unsorted category sorts after every sorted one — see `listOfferingCategories`. */
  sort: z.number().int().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type OfferingCategory = z.infer<typeof offeringCategorySchema>

/**
 * An `offering_versions` row, camelCased, as read back from the database.
 *
 * `effectiveFrom`/`effectiveTo` are an **inclusive** range, and `null` on
 * either end means unbounded — `effectiveTo: null` is the open-ended current
 * price, which is how eight of the seed's twelve versions are written.
 * `assertNoOverlappingVersion` in the repository reads them that way, and the
 * seed's own consecutive pairs (`…-06-30` then `…-07-01`) only stay legal
 * under an inclusive end.
 */
export const offeringVersionSchema = z.object({
  id: z.string(),
  offeringId: z.string().nullable(),
  /** Ordinal within the offering, 1-based. Derived by the repository as `MAX(version) + 1`, never supplied by a caller. */
  version: z.number().int().nullable(),
  rateCents: centsSchema.nullable(),
  effectiveFrom: dateOnlySchema.nullable(),
  effectiveTo: dateOnlySchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type OfferingVersion = z.infer<typeof offeringVersionSchema>

/** An `offerings` row, camelCased, as read back from the database. */
export const offeringSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(OFFERING_TYPES).nullable(),
  /** Kept its column name through T-260829-10's rename (`category_id`); see that migration's header. */
  categoryId: z.string().nullable(),
  billingModel: z.enum(OFFERING_BILLING_MODELS).nullable(),
  unit: z.enum(OFFERING_UNITS).nullable(),
  blurb: z.string().nullable(),
  /** `false` means archived. Nothing in the catalogue is ever deleted — see `archiveOffering`. */
  active: z.boolean().nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
})
export type Offering = z.infer<typeof offeringSchema>

/**
 * `listOfferings`' row: an offering with its current version joined on, so a
 * list can show a price without a second call per row. `null` when the
 * offering has no versions at all — not reachable through this repository
 * (`createOffering` refuses a rateless offering in the same transaction) but
 * representable in a database seeded or imported by something else.
 */
export const offeringListItemSchema = offeringSchema.extend({
  currentVersion: offeringVersionSchema.nullable()
})
export type OfferingListItem = z.infer<typeof offeringListItemSchema>

/**
 * `getOffering`'s row: an offering with its full version history, newest
 * first, so `versions[0]` is the same row `listOfferings` reports as
 * `currentVersion`.
 */
export const offeringWithVersionsSchema = offeringSchema.extend({
  versions: z.array(offeringVersionSchema)
})
export type OfferingWithVersions = z.infer<typeof offeringWithVersionsSchema>

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** `.strict()` so a typo'd key is a request-validation failure, not a silently-ignored no-op — the same rule `listEngagementsFilterSchema` states. */
export const listOfferingsFilterSchema = z
  .object({
    type: z.enum(OFFERING_TYPES).optional(),
    categoryId: z.string().min(1).optional(),
    /** Omitted means "every offering, archived included" — there is no implicit `active = 1`. */
    active: z.boolean().optional()
  })
  .strict()
export type ListOfferingsFilter = z.infer<typeof listOfferingsFilterSchema>

// ---------------------------------------------------------------------------
// Category writes
// ---------------------------------------------------------------------------

const offeringCategoryWritableFieldsSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    color: z.string().min(1).nullable(),
    sort: z.number().int().nullable()
  })
  .strict()

export const createOfferingCategoryInputSchema = offeringCategoryWritableFieldsSchema.partial({ color: true, sort: true })
export type CreateOfferingCategoryInput = z.infer<typeof createOfferingCategoryInputSchema>

/** A patch: present means "set it", absent means "leave it". Renaming is the common case, hence the task's "rename a category". */
export const updateOfferingCategoryInputSchema = offeringCategoryWritableFieldsSchema.partial()
export type UpdateOfferingCategoryInput = z.infer<typeof updateOfferingCategoryInputSchema>

// ---------------------------------------------------------------------------
// Offering writes
// ---------------------------------------------------------------------------

/**
 * Everything an offering carries that is not its price and not assigned by
 * the repository (`id`, `created_at`, `updated_at`, `active`). `active` is
 * absent on purpose: it moves only through `archiveOffering`, so "archive" is
 * a named action rather than a field a generic form can flip by accident.
 */
const offeringWritableFieldsSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    type: z.enum(OFFERING_TYPES).nullable(),
    categoryId: z.string().min(1).nullable(),
    billingModel: z.enum(OFFERING_BILLING_MODELS).nullable(),
    unit: z.enum(OFFERING_UNITS).nullable(),
    blurb: z.string().nullable()
  })
  .strict()

/**
 * `rateCents` is **required**, and that is the whole point of this schema
 * rather than a bare `.partial()` of the writable fields: §6.5 and this
 * task's Scope both say an offering always has at least one version, so a
 * rateless offering must not be representable. The repository writes the
 * `offerings` row and its first `offering_versions` row inside one
 * `db.transaction`, so a failure at either step leaves neither behind — but
 * the missing-rate case never gets that far, because it fails here, before
 * any SQL runs, with an issue whose path names `rateCents`.
 *
 * `effectiveFrom`/`effectiveTo` describe that *first* version's range and
 * default to `null`/`null` (unbounded — "this is the price"). Appending a
 * *second* version, and closing the first one to make room for it, is P3-02.
 */
export const createOfferingInputSchema = offeringWritableFieldsSchema
  .extend({
    rateCents: centsSchema,
    effectiveFrom: dateOnlySchema.nullable(),
    effectiveTo: dateOnlySchema.nullable()
  })
  .partial({
    type: true,
    categoryId: true,
    billingModel: true,
    unit: true,
    blurb: true,
    effectiveFrom: true,
    effectiveTo: true
  })
export type CreateOfferingInput = z.infer<typeof createOfferingInputSchema>

/**
 * The non-price patch. `rateCents` is deliberately **not** a key here: §6.5
 * makes changing a price a distinct action (close the current version, append
 * the next), which is P3-02 and carries its own architecture review. An
 * `updateOffering` that quietly accepted a rate would either ignore it or
 * rewrite history in place, and both are worse than rejecting the key.
 */
export const updateOfferingInputSchema = offeringWritableFieldsSchema.partial()
export type UpdateOfferingInput = z.infer<typeof updateOfferingInputSchema>

/**
 * `duplicateOffering`'s optional overrides. Only the name — everything else
 * is copied, which is what makes duplicating useful (§6.5's "duplicate" on a
 * catalogue of near-identical retainers). Omitting it appends " (copy)".
 */
export const duplicateOfferingInputSchema = z.object({ name: z.string().min(1) }).strict().partial()
export type DuplicateOfferingInput = z.infer<typeof duplicateOfferingInputSchema>
