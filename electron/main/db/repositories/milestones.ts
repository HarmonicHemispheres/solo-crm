import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../../shared/format'
import {
  type CreateMilestoneInput,
  createMilestoneInputSchema,
  type Milestone,
  type MilestoneSum,
  type ReorderMilestonesInput,
  reorderMilestonesInputSchema,
  type SumMilestonesInput,
  sumMilestonesInputSchema,
  type UpdateMilestoneInput,
  updateMilestoneInputSchema
} from '../../../shared/milestones'
import { NotFoundError, RefusalError } from './errors'
import { parseInput } from './input'
import { regenerateRevenueLines } from './revenue-generator'
import { type ConstraintHandler, translateWriteError } from './sqlite-errors'

/**
 * The `milestones` repository (T-260902-02, P3-04). The read,
 * `listMilestones`, moved here from `engagements.ts` (T-260828-31 put it
 * there for the then-only channel, `engagements:milestones`, retired by this
 * task in favour of `milestones:list`) so that one module owns the table
 * and one query-key entity covers every read of it — a milestone mutation
 * calls `invalidate.milestones` and nothing else. The other reason it
 * moved is import direction: `engagements.ts` will import the revenue
 * generator (T-260902-03) to regenerate on an engagement write, and the
 * generator reads milestones; had this module kept importing from
 * `engagements.ts`, that would have closed a cycle. Nothing here imports
 * `engagements.ts`, and nothing must.
 *
 * What a milestone is for decides the shape: a fixed-scope engagement
 * recognises revenue one `revenue_lines` row per milestone at its
 * `expected_month` (ADR-003), so a milestone is created with a name, an
 * amount and a month, all required (`shared/milestones.ts` says why the
 * read shape is looser). Completing sets `completed_at`; nothing here
 * changes `status` on any engagement or line — that is the generator's
 * and, later, Stripe's business.
 *
 * Every write runs inside one transaction and ends by calling
 * `afterMilestoneWrite` with the engagement it touched. That hook is a
 * no-op today and exists for T-260902-03: the generator has to regenerate
 * an engagement's `revenue_lines` whenever its milestones change, and
 * "inside the same transaction as the write" is the only place that is
 * atomic. One seam, six callers, so wiring the generator is one line here
 * rather than six places to remember.
 *
 * Deliberately raw `db.prepare(...).run(...)`, like every sibling.
 */
export { createMilestoneInputSchema, reorderMilestonesInputSchema, sumMilestonesInputSchema, updateMilestoneInputSchema }
export type { CreateMilestoneInput, Milestone, MilestoneSum, ReorderMilestonesInput, SumMilestonesInput, UpdateMilestoneInput }

/** `milestones` declares one foreign key, `engagement_id` (migration 0001), and no `CHECK`/`UNIQUE`. */
const CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This milestone references an engagement that does not exist.', { reason: 'foreign-key' })
}

/**
 * Called at the end of every write, inside its transaction, with the
 * engagement whose milestones changed: a fixed scope's revenue is one
 * `revenue_lines` row per milestone (ADR-003), so its lines are
 * regenerated here, atomically with the milestone write (T-260902-03).
 * `engagementId` is `null` only for a pre-task row with no engagement (the
 * column is nullable), for which there is nothing to regenerate.
 */
function afterMilestoneWrite(db: Database.Database, engagementId: string | null): void {
  if (engagementId === null) return
  regenerateRevenueLines(db, engagementId)
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface MilestoneRow {
  readonly id: string
  readonly engagement_id: string | null
  readonly name: string | null
  readonly sort: number | null
  readonly completed_at: string | null
  readonly amount_cents: number | null
  readonly expected_month: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapRow(row: MilestoneRow): Milestone {
  return {
    id: row.id,
    engagementId: row.engagement_id,
    name: row.name,
    sort: row.sort,
    completedAt: row.completed_at,
    amountCents: row.amount_cents,
    expectedMonth: row.expected_month,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getMilestoneRow(db: Database.Database, id: string): MilestoneRow | undefined {
  return db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as MilestoneRow | undefined
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getMilestone(db: Database.Database, id: string): Milestone | null {
  const row = getMilestoneRow(db, id)
  return row ? mapRow(row) : null
}

function requireRow(db: Database.Database, id: string): MilestoneRow {
  const row = getMilestoneRow(db, id)
  if (!row) throw new NotFoundError('Milestone', id)
  return row
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Every milestone of one engagement, in position order.
 *
 * `milestones.sort` is nullable, and plain `ORDER BY sort ASC` sorts SQLite
 * NULLs first — an unsorted milestone would lead the list ahead of every
 * milestone that actually has a position. `sort IS NULL` evaluates to 0 for
 * a sorted row and 1 for an unsorted one, so ordering by that first pushes
 * NULLs to the end; `sort ASC` then orders the sorted rows among themselves,
 * and `created_at ASC` breaks ties (including among unsorted rows, and
 * among rows created with the same explicit `sort`).
 */
export function listMilestones(db: Database.Database, engagementId: string): readonly Milestone[] {
  const rows = db
    .prepare('SELECT * FROM milestones WHERE engagement_id = ? ORDER BY sort IS NULL, sort ASC, created_at ASC')
    .all(engagementId) as MilestoneRow[]
  return rows.map(mapRow)
}

/**
 * `SUM(amount_cents)` over one engagement's milestones, as integer cents,
 * with `count` beside it so a caller can tell "no milestones" from "they
 * sum to zero". `COALESCE` makes an engagement with no rows answer `0`
 * rather than `NULL`; a row with a NULL amount (pre-task data) contributes
 * nothing, exactly as SQL's `SUM` already treats it.
 *
 * **This is not a revenue figure.** It is a check on an engagement's
 * *terms* — do the milestones add up to `contract_value_cents`, which
 * P3-09's editor has to say when they do not — in the same legal category
 * as a card's headline price (ADR-003's first exception). Backlog, what
 * remains to be billed, is a revenue rollup and reads `revenue_lines`;
 * computing it as this sum minus the completed ones would be exactly the
 * defect ADR-003 names, and the reason this sentence is here.
 */
export function sumMilestoneAmounts(db: Database.Database, input: unknown): MilestoneSum {
  const parsed = parseInput(sumMilestonesInputSchema, input)
  const row = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total, COUNT(*) AS count FROM milestones WHERE engagement_id = ?')
    .get(parsed.engagementId) as { total: number; count: number }
  return { engagementId: parsed.engagementId, totalCents: row.total, count: row.count }
}

// ---------------------------------------------------------------------------
// Writes — each one transaction, each ending in `afterMilestoneWrite`.
// ---------------------------------------------------------------------------

/**
 * Appends by default: with `sort` absent the new row takes one more than the
 * engagement's current highest `sort` (or `0` for the first). A caller that
 * passes `sort` gets exactly that value, collisions included — `listMilestones`
 * breaks a tie on `created_at`, and `reorderMilestones` is the way to make
 * positions unique again.
 *
 * An `engagementId` naming no engagement is refused by the foreign key, not
 * by a `SELECT` here — the same reasoning `links.ts` gives for the trigger.
 */
export function createMilestone(db: Database.Database, input: unknown): Milestone {
  const parsed = parseInput(createMilestoneInputSchema, input)
  const id = randomUUID()
  const timestamp = nowTimestamp()

  const insert = db.transaction(() => {
    const sort =
      parsed.sort ??
      ((db.prepare('SELECT MAX(sort) AS max FROM milestones WHERE engagement_id = ?').get(parsed.engagementId) as { max: number | null }).max ??
        -1) + 1
    db.prepare(
      `INSERT INTO milestones (id, engagement_id, name, sort, completed_at, amount_cents, expected_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run(id, parsed.engagementId, parsed.name, sort, parsed.amountCents, parsed.expectedMonth, timestamp, timestamp)
    afterMilestoneWrite(db, parsed.engagementId)
  })

  try {
    insert()
  } catch (error) {
    translateWriteError(CONSTRAINT_HANDLERS, error)
  }

  return getMilestone(db, id) as Milestone
}

/**
 * Patches only the keys present (`parseInput` strips explicitly-undefined
 * ones — `input.ts` explains why that matters). An empty patch is a no-op
 * that still returns the row, never an `UPDATE ... SET updated_at` alone,
 * and does not fire the write hook: nothing changed.
 */
export function updateMilestone(db: Database.Database, id: string, patch: unknown): Milestone {
  const parsed = parseInput(updateMilestoneInputSchema, patch)

  const update = db.transaction(() => {
    const row = requireRow(db, id)
    const sets: string[] = []
    const values: unknown[] = []
    if ('name' in parsed) {
      sets.push('name = ?')
      values.push(parsed.name)
    }
    if ('amountCents' in parsed) {
      sets.push('amount_cents = ?')
      values.push(parsed.amountCents)
    }
    if ('expectedMonth' in parsed) {
      sets.push('expected_month = ?')
      values.push(parsed.expectedMonth)
    }
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    values.push(nowTimestamp())
    db.prepare(`UPDATE milestones SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    afterMilestoneWrite(db, row.engagement_id)
  })
  update()

  return getMilestone(db, id) as Milestone
}

/** Sets `completed_at` to now. Completing an already-complete milestone keeps its original `completed_at` — the first completion is the fact. */
export function completeMilestone(db: Database.Database, id: string): Milestone {
  const complete = db.transaction(() => {
    const row = requireRow(db, id)
    if (row.completed_at !== null) return
    const timestamp = nowTimestamp()
    db.prepare('UPDATE milestones SET completed_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, id)
    afterMilestoneWrite(db, row.engagement_id)
  })
  complete()
  return getMilestone(db, id) as Milestone
}

/** Clears `completed_at`. A no-op on a milestone that is not complete. */
export function uncompleteMilestone(db: Database.Database, id: string): Milestone {
  const uncomplete = db.transaction(() => {
    const row = requireRow(db, id)
    if (row.completed_at === null) return
    db.prepare('UPDATE milestones SET completed_at = NULL, updated_at = ? WHERE id = ?').run(nowTimestamp(), id)
    afterMilestoneWrite(db, row.engagement_id)
  })
  uncomplete()
  return getMilestone(db, id) as Milestone
}

/**
 * Writes `sort = index` for each id in `ids`, in one transaction, and
 * touches no row of any other engagement (the plan: "does not renumber
 * unrelated rows"). `ids` must be exactly this engagement's milestones:
 * one that is not — a typo, a milestone of another engagement — or one
 * missing, or one repeated, refuses the whole call before any row is
 * written. A partial order is not an order (see `shared/milestones.ts`).
 *
 * Returns the engagement's milestones in their new order, so a caller has
 * the list it will render without a second read.
 */
export function reorderMilestones(db: Database.Database, input: unknown): readonly Milestone[] {
  const parsed = parseInput(reorderMilestonesInputSchema, input)

  const reorder = db.transaction((ids: readonly string[]) => {
    const owned = new Set(
      (db.prepare('SELECT id FROM milestones WHERE engagement_id = ?').all(parsed.engagementId) as { id: string }[]).map((r) => r.id)
    )
    const foreign = ids.filter((id) => !owned.has(id))
    if (foreign.length > 0) {
      throw new RefusalError(
        `Cannot reorder: ${foreign.length} of the ids ${foreign.length === 1 ? 'is' : 'are'} not a milestone of this engagement.`,
        { reason: 'foreign-milestone', count: foreign.length }
      )
    }
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) throw new RefusalError(`Cannot reorder: "${id}" appears more than once.`, { reason: 'duplicate-id' })
      seen.add(id)
    }
    if (seen.size !== owned.size) {
      const missing = owned.size - seen.size
      throw new RefusalError(
        `Cannot reorder: ${missing} of this engagement's milestones ${missing === 1 ? 'is' : 'are'} not in the list — a reorder names every one.`,
        { reason: 'incomplete-order', count: missing }
      )
    }
    const timestamp = nowTimestamp()
    const update = db.prepare('UPDATE milestones SET sort = ?, updated_at = ? WHERE id = ?')
    ids.forEach((id, index) => update.run(index, timestamp, id))
    afterMilestoneWrite(db, parsed.engagementId)
  })

  reorder(parsed.ids)
  return listMilestones(db, parsed.engagementId)
}

/**
 * No referential guard: nothing in migration 0001 points a foreign key at
 * `milestones.id` (`revenue_lines` names the engagement, not the
 * milestone), so there is nothing for `refuseIfReferenced` to check. What
 * deleting a milestone means for the `revenue_lines` row generated from it
 * is the generator's question, answered through `afterMilestoneWrite`
 * (T-260902-03: regenerate the engagement), not this function's.
 */
export function deleteMilestone(db: Database.Database, id: string): void {
  const remove = db.transaction(() => {
    const row = requireRow(db, id)
    db.prepare('DELETE FROM milestones WHERE id = ?').run(id)
    afterMilestoneWrite(db, row.engagement_id)
  })
  remove()
}
