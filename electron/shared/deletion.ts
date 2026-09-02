import { z } from 'zod'

/**
 * What a delete would take with it — the wire shape behind every
 * `<entity>:deleteImpact` channel (T-260902-09), and the contents of the
 * confirmation the renderer shows before `<entity>:delete` runs.
 *
 * ADR-007: pure zod, no Node imports, typechecked under both tsconfigs. The
 * plans this describes live in
 * `electron/main/db/repositories/cascade.ts`, which is where the SQL that
 * both counts and deletes is declared once.
 *
 * The four entities are the ones the app can delete. `task`, `activity` and
 * `link` are absent on purpose: a todo and a link already have their own
 * delete affordance in place, and activity has none by decision (G8 — a
 * correction is a new row). Activity still *goes* when its company or
 * engagement does, which is a different question and one ADR-017 settles.
 */
export const DELETABLE_ENTITIES = ['company', 'person', 'engagement', 'offering'] as const
export type DeletableEntity = (typeof DELETABLE_ENTITIES)[number]

/**
 * One line of the confirmation: "3 engagements will be deleted", "2
 * companies that bill through it will be unlinked".
 *
 * `action` is what separates the two halves the operator must not confuse.
 * `delete` rows are gone; `clear` rows survive with a reference removed —
 * another company that billed through this one, an engagement sold from a
 * deleted offering. Rendering both as "deleted" would overstate the damage
 * and rendering both as "changed" would understate it, so the distinction
 * travels rather than being re-derived from the label's wording.
 */
export const deletionImpactEntrySchema = z
  .object({
    /** Plural and lowercase, as the dialog reads it: "activity records". */
    label: z.string(),
    count: z.number().int().nonnegative(),
    action: z.enum(['delete', 'clear'])
  })
  .strict()
export type DeletionImpactEntry = z.infer<typeof deletionImpactEntrySchema>

/**
 * Everything one delete would touch. `entries` is empty for a record nothing
 * points at — which is the common case and the one the dialog should stay
 * out of the way of.
 */
export const deletionImpactSchema = z
  .object({
    entity: z.enum(DELETABLE_ENTITIES),
    id: z.string(),
    /** The record's own name, so the dialog can say what is being deleted without a second read. */
    name: z.string(),
    entries: z.array(deletionImpactEntrySchema).readonly()
  })
  .strict()
export type DeletionImpact = z.infer<typeof deletionImpactSchema>

/**
 * A delete request. `cascade` defaults to false, and that default is the
 * whole safety property: an existing caller, or a new one that forgets, gets
 * the refusing delete that has always been there rather than a silent
 * cascade. The renderer sets it to true only on the second confirmation,
 * after showing the impact above.
 */
export const deleteRequestSchema = z
  .object({
    id: z.string().min(1),
    cascade: z.boolean().optional()
  })
  .strict()
export type DeleteRequest = z.infer<typeof deleteRequestSchema>
