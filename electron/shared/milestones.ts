import { z } from 'zod'
import { centsSchema, periodMonthSchema } from './types'
import { milestoneSchema, type Milestone } from './engagements'

/**
 * `milestones`' write-side wire contract (T-260902-02, P3-04; ADR-007):
 * the create/update/reorder zod schemas and the sum's response shape, as
 * PURE zod with no Node imports — the discipline every `electron/shared/**`
 * module follows, for the reason `companies.ts`'s header gives.
 *
 * The row shape, `milestoneSchema`, stays declared in `./engagements` where
 * T-260828-31 put it, and is re-exported here so a caller of the
 * `milestones:*` channels imports one module. Declaring it twice would be
 * the "seventh copy" T-260828-48 warns about.
 *
 * The read shape is nullable on every column but the id and timestamps,
 * because migration 0001 declares them that way and rows written before
 * this task (tests, a hand-edited database) may carry NULLs. The *write*
 * side is stricter: a milestone the revenue generator (T-260902-03) can turn
 * into a `revenue_lines` row needs a name, an amount and an expected month,
 * so `createMilestoneInputSchema` requires all three. That is the point of
 * the repository — a fixed-scope engagement's milestones are what its
 * revenue is recognised from (ADR-003), and one with no amount or no month
 * would generate nothing and say nothing about why.
 */
export { milestoneSchema }
export type { Milestone }

/**
 * `createMilestone`'s input. `sort` is optional: absent, the repository
 * appends after the engagement's current last milestone. `completedAt` is
 * not here — completing is `completeMilestone`, a separate operation, so a
 * milestone cannot be created already done by accident.
 */
export const createMilestoneInputSchema = z
  .object({
    engagementId: z.string().min(1, 'engagementId is required'),
    name: z.string().min(1, 'name is required'),
    amountCents: centsSchema,
    /** `periodMonthSchema` — the first of the month the milestone is expected in. */
    expectedMonth: periodMonthSchema,
    sort: z.number().int().min(0).optional()
  })
  .strict()
export type CreateMilestoneInput = z.infer<typeof createMilestoneInputSchema>

/**
 * `updateMilestone`'s patch — the three descriptive fields. `sort` is
 * `reorderMilestones`' and `completedAt` is `completeMilestone`'s /
 * `uncompleteMilestone`'s; `engagementId` is the row's identity and is
 * never patched (a milestone does not move between engagements — delete
 * and recreate, as `movePerson` does for affiliations).
 */
export const updateMilestoneInputSchema = z
  .object({
    name: z.string().min(1, 'name is required'),
    amountCents: centsSchema,
    expectedMonth: periodMonthSchema
  })
  .partial()
  .strict()
export type UpdateMilestoneInput = z.infer<typeof updateMilestoneInputSchema>

/**
 * `reorderMilestones`' input: one engagement, and *all* of its milestone
 * ids in the order they should now sit. The repository refuses a set that
 * is not exactly the engagement's — an id of another engagement, a missing
 * one, a duplicate — rather than renumbering around it. A subset was
 * considered and rejected in review: with `created_at` breaking ties, a
 * subset's new positions could never move a row ahead of an older unnamed
 * one, so the caller's order was not the order they got. "Does not
 * renumber unrelated rows" (the plan) means other engagements' rows.
 */
export const reorderMilestonesInputSchema = z
  .object({
    engagementId: z.string().min(1, 'engagementId is required'),
    ids: z.array(z.string().min(1)).min(1, 'at least one id is required')
  })
  .strict()
export type ReorderMilestonesInput = z.infer<typeof reorderMilestonesInputSchema>

/** `milestones:list`'s request — one engagement's milestones, in position order. */
export const listMilestonesInputSchema = z.object({ engagementId: z.string().min(1) }).strict()
export type ListMilestonesInput = z.infer<typeof listMilestonesInputSchema>

/** `milestones:sum`'s request and response — `SUM(amount_cents)` for one engagement, `0` when it has none. */
export const sumMilestonesInputSchema = z.object({ engagementId: z.string().min(1) }).strict()
export type SumMilestonesInput = z.infer<typeof sumMilestonesInputSchema>

export const milestoneSumSchema = z
  .object({
    engagementId: z.string(),
    /** Integer cents, the sum over every milestone row of the engagement, NULL amounts counting as nothing. */
    totalCents: centsSchema,
    count: z.number().int().min(0)
  })
  .strict()
export type MilestoneSum = z.infer<typeof milestoneSumSchema>
