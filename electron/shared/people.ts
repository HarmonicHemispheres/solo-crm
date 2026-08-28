import { z } from 'zod'
import { dateOnlySchema } from './types'

/**
 * `people` and `affiliations`' wire contract (ADR-007): the domain types and
 * the create/update zod schemas, as PURE zod with no Node imports — the same
 * discipline `electron/shared/companies.ts` follows and for the identical
 * reason (see that file's header comment, and `ipc-types.ts`'s on TS6307):
 * this module is typechecked under both `tsconfig.node.json` (main +
 * preload) and `tsconfig.web.json` (renderer), so it may only use the ES2022
 * lib both share and may only import other `electron/shared/**` modules.
 *
 * SQL, `randomUUID`, row mapping (snake_case -> camelCase) and SQLite
 * constraint translation stay in
 * `electron/main/db/repositories/people.ts`, which imports the types and
 * schemas below rather than redeclaring any of them.
 */

/** A `people` row, camelCased, as read back from the database. */
export interface Person {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  readonly notes: string | null
  /**
   * ADR-001: owned by the activity repository (T-260828-24), written in the
   * same transaction as an activity insert (and by the future Gmail
   * adapter's `recordContact`), and never moves backward. Not a writable
   * field on this repository's create/update schemas below — mirrors
   * `Company.lastTouchAt` exactly — but still part of what a read returns.
   */
  readonly lastContactAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Every writable column except `id`/`created_at`/`updated_at` (assigned by
 * the repository, never by a caller) and `last_contact_at` (ADR-001: owned
 * by the activity repository, not writable here). `.partial()` below derives
 * the update schema from this one so the two can never drift on which fields
 * exist or how each is validated.
 *
 * `.strict()`: an unknown key — a typo'd field name crossing the IPC
 * boundary — is a `ValidationError`, not a silently-dropped no-op that still
 * bumps `updated_at` and returns what looks like a saved change.
 */
const personWritableFieldsSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    notes: z.string().nullable()
  })
  .strict()

export const createPersonInputSchema = personWritableFieldsSchema.partial({
  email: true,
  phone: true,
  notes: true
})
export type CreatePersonInput = z.infer<typeof createPersonInputSchema>

export const updatePersonInputSchema = personWritableFieldsSchema.partial()
export type UpdatePersonInput = z.infer<typeof updatePersonInputSchema>

// ---------------------------------------------------------------------------
// Affiliations
// ---------------------------------------------------------------------------

/**
 * An `affiliations` row, camelCased, as read back from the database.
 * ADR-002: this is a join table with its own UUID `id` and both timestamps —
 * explicitly *not* exempted the way `settings`/`favicons` are — because a
 * person can leave a company and return, so `(personId, companyId)` is not
 * unique and each stint is its own row with its own lifespan.
 */
export interface Affiliation {
  readonly id: string
  readonly personId: string
  readonly companyId: string
  readonly title: string | null
  readonly isPrimary: boolean | null
  /** `dateOnlySchema` — the day this stint began. */
  readonly started: string
  /** `dateOnlySchema`, or `null` while the stint is still open. */
  readonly ended: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

/**
 * Every writable column except `id`/`personId`/`companyId`/`created_at`/
 * `updated_at`. `personId` and `companyId` are set once, at
 * `addAffiliation`, and are deliberately absent from
 * `updateAffiliationInputSchema` below: an affiliation's person and company
 * are its identity, not a patchable field — changing either in place is
 * exactly the "move-as-update shortcut" this task's Risks section forbids.
 * A move is `movePerson`: close this row, open a new one.
 */
const affiliationWritableFieldsSchema = z
  .object({
    title: z.string().nullable(),
    isPrimary: z.boolean().nullable(),
    started: dateOnlySchema,
    ended: dateOnlySchema.nullable()
  })
  .strict()

/**
 * Derived from `affiliationWritableFieldsSchema` the same way
 * `companies.ts`'s `createCompanyInputSchema` derives from
 * `companyWritableFieldsSchema` — `.partial()` for the optional fields, then
 * `.extend()` to add the two fields that only exist at creation. This keeps
 * `title`/`isPrimary`/`started`/`ended` declared in exactly one place, shared
 * with `updateAffiliationInputSchema` below; only `personId`/`companyId`,
 * which the update schema deliberately omits (an affiliation's person and
 * company are its identity, not a patchable field — see this file's header),
 * live outside that shared base.
 */
export const createAffiliationInputSchema = affiliationWritableFieldsSchema
  .partial({ title: true, isPrimary: true, ended: true })
  .extend({
    personId: z.string().min(1, 'personId is required'),
    companyId: z.string().min(1, 'companyId is required')
  })
export type CreateAffiliationInput = z.infer<typeof createAffiliationInputSchema>

export const updateAffiliationInputSchema = affiliationWritableFieldsSchema.partial()
export type UpdateAffiliationInput = z.infer<typeof updateAffiliationInputSchema>

/** `endAffiliation(id, endedOn)`'s second argument. */
export const endAffiliationInputSchema = dateOnlySchema
export type EndAffiliationInput = z.infer<typeof endAffiliationInputSchema>

/** `movePerson(personId, toCompanyId, { on })`'s third argument. */
export const movePersonOptionsSchema = z
  .object({
    on: dateOnlySchema,
    title: z.string().nullable().optional(),
    isPrimary: z.boolean().nullable().optional()
  })
  .strict()
export type MovePersonOptions = z.infer<typeof movePersonOptionsSchema>

/**
 * `getPerson`'s affiliation shape: every stint the person has ever had,
 * `current` telling a caller which one is still open instead of leaving that
 * to a `ended === null` check it might get backwards at a call site.
 */
export interface PersonAffiliation extends Affiliation {
  readonly current: boolean
}

/** `getPerson`'s return shape — the base row plus every affiliation, marked. */
export interface PersonWithAffiliations extends Person {
  readonly affiliations: readonly PersonAffiliation[]
}
