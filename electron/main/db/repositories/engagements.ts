import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import {
  BILLING_MODELS,
  type BillingModel,
  type CreateEngagementInput,
  createEngagementInputSchema,
  ENGAGEMENT_STATUSES,
  type Engagement,
  type EngagementStatus,
  type ListEngagementsFilter,
  listEngagementsFilterSchema,
  type Milestone,
  type UpdateEngagementInput,
  updateEngagementInputSchema
} from '../../../shared/engagements'
import { NotFoundError, RefusalError } from './errors'
import { parseInput, type ParseInputOptions } from './input'
import { type ConstraintHandler, NOT_NULL_HANDLER, PRIMARY_KEY_HANDLER, translateWriteError, UNIQUE_HANDLER } from './sqlite-errors'
import { refuseIfReferenced } from './referential-guard'

/**
 * The `engagements` repository (T-260828-22), built on `companies.ts`'s
 * pattern (T-260828-20). Deliberately raw `db.prepare(...).run(...)`
 * throughout, matching that file's own header note on why — `schema.ts`
 * exists only to generate migrations, not to be imported here.
 *
 * `Engagement`, `Milestone`, the status/billing-model unions and the
 * create/update zod schemas live in `electron/shared/engagements.ts`
 * (ADR-007), not here — see that file's header for why. This module
 * re-exports the pieces its own call sites already use so nothing
 * downstream needs to know the split happened.
 *
 * This file computes no money beyond returning stored columns — no `SUM`,
 * no per-month or projected figure, no `monthlyValue`-shaped helper. ADR-003
 * puts every revenue question through `revenue_lines` (P3-05); branching on
 * `billingModel` to produce a figure anywhere else is the defect this
 * task's Risks section names as the highest-risk carry-over in the project.
 */
export { BILLING_MODELS, createEngagementInputSchema, ENGAGEMENT_STATUSES, listEngagementsFilterSchema, updateEngagementInputSchema }
export type { BillingModel, CreateEngagementInput, Engagement, EngagementStatus, ListEngagementsFilter, Milestone, UpdateEngagementInput }

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Every schema in this file parses through the shared `parseInput`
 * (`input.ts`) with both of its options set, because `engagements` is the one
 * table whose schemas are unions:
 *
 * - `stripBeforeParse` — undefined-valued keys must be stripped BEFORE
 *   `safeParse`, not after. `updateEngagementInputSchema` is a
 *   `z.union([engagementCommonPatchSchema, engagementModelPatchSchema])`, and
 *   stripping after parsing cannot influence which union branch was chosen.
 *   `{ billingModel: undefined, notes: 'x' }` defeats both branches as parsed
 *   — `engagementCommonPatchSchema` is `.strict()` with no `billingModel` key
 *   at all, and `engagementModelPatchSchema`'s `discriminatedUnion` looks up
 *   `billingModel`, finds `undefined`, and matches no branch — even though
 *   the caller's actual intent ("leave billingModel alone") is exactly what
 *   an absent key means. Stripping first makes that patch parse as
 *   `{ notes: 'x' }`, which `engagementCommonPatchSchema` accepts.
 * - `transformIssues` — `flattenIssues` below, for the same union reason.
 */
const PARSE_OPTIONS: ParseInputOptions = { stripBeforeParse: true, transformIssues: flattenIssues }

/**
 * zod v4 nests a union branch's own issues inside `issue.errors` (one array
 * per branch) rather than flattening them onto the top-level issues array,
 * so a plain `.error.issues` read on a `z.union` (`updateEngagementInputSchema`)
 * or `z.discriminatedUnion` (its `engagementModelPatchSchema` member) sees
 * only a single top-level `invalid_union` issue with message "Invalid
 * input" — a mismatched model field, an unknown key and a bad date all
 * collapse to the same useless message. This recurses into `issue.errors`
 * to surface what actually failed in each branch. A branch that failed with
 * an empty `errors` array (a discriminator that matched no option at all) is
 * kept as-is — that issue, naming the discriminator and the values it
 * accepts, IS the useful signal in that case.
 */
function flattenIssues(issues: readonly z.ZodIssue[]): z.ZodIssue[] {
  const flat: z.ZodIssue[] = []
  for (const issue of issues) {
    if (issue.code === 'invalid_union') {
      const nested = issue.errors.flatMap((branch) => flattenIssues(branch))
      flat.push(...(nested.length > 0 ? nested : [issue]))
    } else {
      flat.push(issue)
    }
  }
  return flat
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

/**
 * Every writable column except `id`/`created_at`/`updated_at` (assigned by
 * this repository) — `agreedRateCents` included, so `createEngagement` can
 * iterate this same list. `updateEngagement` below deliberately does NOT
 * iterate `agreedRateCents` through this list; see that function's own
 * comment.
 *
 * `key` was a bare `string` until T-260828-46, for a correct reason with a
 * wrong conclusion: `keyof CreateEngagementInput` collapses to only the keys
 * every branch of the discriminated union shares (`name`,
 * `billingCompanyId`, …, `billingModel`), so it cannot express "the
 * `hoursIncluded` this specific branch happened to validate". But `string`
 * severs the compile-time link entirely — renaming a field in
 * `electron/shared/engagements.ts` typechecked clean and failed at runtime,
 * as a column silently written `NULL`. `EngagementWritableKey` below is the
 * per-branch answer: a *distributive* `keyof` over the union, which is the
 * union of every branch's own keys rather than their intersection.
 */
type KeysOfUnion<T> = T extends unknown ? keyof T : never

/** Every key any create branch can carry — the union of the branches' keys, not `keyof` on the union. */
type EngagementWritableKey = KeysOfUnion<CreateEngagementInput>

/** Every key any update branch can carry — the same distributive read over the patch union. */
type EngagementPatchKey = KeysOfUnion<UpdateEngagementInput>

interface ColumnSpec<Key extends string> {
  readonly key: Key
  readonly column: string
}

/**
 * Fails typecheck with "Type 'X' does not satisfy the constraint 'never'"
 * naming any writable key no entry below maps — the other half of the link:
 * `satisfies` catches a key that was renamed or deleted, this catches one
 * that was added to `electron/shared/engagements.ts` and never wired to a
 * column here.
 */
type AssertNever<T extends never> = T

const ALL_WRITABLE_COLUMNS = [
  { key: 'name', column: 'name' },
  { key: 'billingCompanyId', column: 'billing_company_id' },
  { key: 'clientCompanyId', column: 'client_company_id' },
  { key: 'serviceVersionId', column: 'service_version_id' },
  { key: 'agreedRateCents', column: 'agreed_rate_cents' },
  { key: 'billingModel', column: 'billing_model' },
  { key: 'status', column: 'status' },
  { key: 'startedOn', column: 'started_on' },
  { key: 'endsOn', column: 'ends_on' },
  { key: 'renewsOn', column: 'renews_on' },
  { key: 'hoursIncluded', column: 'hours_included' },
  { key: 'contractValueCents', column: 'contract_value_cents' },
  { key: 'hourlyRateCents', column: 'hourly_rate_cents' },
  { key: 'estimatedHours', column: 'estimated_hours' },
  { key: 'notToExceedCents', column: 'not_to_exceed_cents' },
  { key: 'notes', column: 'notes' }
] as const satisfies ReadonlyArray<ColumnSpec<EngagementWritableKey>>

// Exported only because `noUnusedLocals` would otherwise delete the check by
// erroring on it — nothing imports this, and nothing should. It is a
// compile-time assertion, not an API.
export type EveryWritableKeyHasAColumn = AssertNever<
  Exclude<EngagementWritableKey, (typeof ALL_WRITABLE_COLUMNS)[number]['key']>
>

/** Common fields a patch may set regardless of whether it also touches the billing model. Excludes `agreedRateCents` — see `updateEngagement`. */
const UPDATE_COMMON_COLUMNS = [
  { key: 'name', column: 'name' },
  { key: 'billingCompanyId', column: 'billing_company_id' },
  { key: 'clientCompanyId', column: 'client_company_id' },
  { key: 'serviceVersionId', column: 'service_version_id' },
  { key: 'status', column: 'status' },
  { key: 'startedOn', column: 'started_on' },
  { key: 'endsOn', column: 'ends_on' },
  { key: 'renewsOn', column: 'renews_on' },
  { key: 'notes', column: 'notes' }
] as const satisfies ReadonlyArray<ColumnSpec<EngagementPatchKey>>

/** The five model-specific columns, written together (with the non-matching four reset to `NULL`) whenever a patch changes `billingModel`. */
const MODEL_SPECIFIC_COLUMNS = [
  { key: 'hoursIncluded', column: 'hours_included' },
  { key: 'contractValueCents', column: 'contract_value_cents' },
  { key: 'hourlyRateCents', column: 'hourly_rate_cents' },
  { key: 'estimatedHours', column: 'estimated_hours' },
  { key: 'notToExceedCents', column: 'not_to_exceed_cents' }
] as const satisfies ReadonlyArray<ColumnSpec<EngagementPatchKey>>

// ---------------------------------------------------------------------------
// SQLite constraint translation
// ---------------------------------------------------------------------------

/**
 * Migration 0001 declares no `CHECK` constraint on `engagements` (unlike
 * `companies`' self-reference check), so there is no name-dispatched `CHECK`
 * branch here — only the constraint kinds this table can actually raise.
 * Adding a `CHECK` constraint to `engagements` later means adding a branch
 * here, not editing the fallback (`companies.ts`'s header makes the same
 * point).
 */
const CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError(
      'This write references a company or service version that does not exist — check billingCompanyId, clientCompanyId and serviceVersionId.',
      { reason: 'foreign-key' }
    ),
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface EngagementRow {
  readonly id: string
  readonly name: string
  readonly billing_company_id: string | null
  readonly client_company_id: string | null
  readonly service_version_id: string | null
  readonly agreed_rate_cents: number | null
  readonly billing_model: string | null
  readonly status: string | null
  readonly started_on: string
  readonly ends_on: string | null
  readonly renews_on: string | null
  readonly hours_included: number | null
  readonly contract_value_cents: number | null
  readonly hourly_rate_cents: number | null
  readonly estimated_hours: number | null
  readonly not_to_exceed_cents: number | null
  readonly notes: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapEngagementRow(row: EngagementRow): Engagement {
  return {
    id: row.id,
    name: row.name,
    billingCompanyId: row.billing_company_id,
    clientCompanyId: row.client_company_id,
    serviceVersionId: row.service_version_id,
    agreedRateCents: row.agreed_rate_cents,
    billingModel: row.billing_model as BillingModel | null,
    status: row.status as EngagementStatus | null,
    startedOn: row.started_on,
    endsOn: row.ends_on,
    renewsOn: row.renews_on,
    hoursIncluded: row.hours_included,
    contractValueCents: row.contract_value_cents,
    hourlyRateCents: row.hourly_rate_cents,
    estimatedHours: row.estimated_hours,
    notToExceedCents: row.not_to_exceed_cents,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getEngagementRow(db: Database.Database, id: string): EngagementRow | undefined {
  return db.prepare('SELECT * FROM engagements WHERE id = ?').get(id) as EngagementRow | undefined
}

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

function mapMilestoneRow(row: MilestoneRow): Milestone {
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

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `filter.billingCompanyId` and `filter.clientCompanyId` are separate
 * clauses, never coalesced into "any company on this engagement" — a query
 * from either side of a split billing arrangement returns the engagement
 * that side actually names, and only that side.
 */
export function listEngagements(db: Database.Database, filter: ListEngagementsFilter = {}): readonly Engagement[] {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filter.status !== undefined) {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  if (filter.billingCompanyId !== undefined) {
    clauses.push('billing_company_id = ?')
    params.push(filter.billingCompanyId)
  }
  if (filter.clientCompanyId !== undefined) {
    clauses.push('client_company_id = ?')
    params.push(filter.clientCompanyId)
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(`SELECT * FROM engagements ${where} ORDER BY started_on DESC, name COLLATE NOCASE`)
    .all(...params) as EngagementRow[]
  return rows.map(mapEngagementRow)
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getEngagement(db: Database.Database, id: string): Engagement | null {
  const row = getEngagementRow(db, id)
  return row ? mapEngagementRow(row) : null
}

/**
 * Milestone *editing* stays P3-09 (this task's Scope) — this is a read-only
 * list for a fixed-scope detail view to render.
 *
 * `milestones.sort` is nullable, and plain `ORDER BY sort ASC` sorts SQLite
 * NULLs first — an unsorted milestone would lead the list ahead of every
 * milestone that actually has a position. `sort IS NULL` evaluates to 0 for
 * a sorted row and 1 for an unsorted one, so ordering by that first pushes
 * NULLs to the end; `sort ASC` then orders the sorted rows among themselves,
 * and `created_at ASC` breaks ties (including among unsorted rows).
 */
export function listMilestones(db: Database.Database, engagementId: string): readonly Milestone[] {
  const rows = db
    .prepare('SELECT * FROM milestones WHERE engagement_id = ? ORDER BY sort IS NULL, sort ASC, created_at ASC')
    .all(engagementId) as MilestoneRow[]
  return rows.map(mapMilestoneRow)
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function createEngagement(db: Database.Database, input: unknown): Engagement {
  const parsed = parseInput(createEngagementInputSchema, input, PARSE_OPTIONS) as unknown as Record<string, unknown>

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const columns = ['id', ...ALL_WRITABLE_COLUMNS.map((spec) => spec.column), 'created_at', 'updated_at']
  const placeholders = columns.map(() => '?').join(', ')
  const values: unknown[] = [id]
  for (const spec of ALL_WRITABLE_COLUMNS) {
    values.push(spec.key in parsed ? (parsed[spec.key] ?? null) : null)
  }
  values.push(timestamp, timestamp)

  try {
    db.prepare(`INSERT INTO engagements (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  } catch (error) {
    translateWriteError(CONSTRAINT_HANDLERS, error)
  }

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return getEngagement(db, id) as Engagement
}

export function updateEngagement(db: Database.Database, id: string, patch: unknown): Engagement {
  const parsed = parseInput(updateEngagementInputSchema, patch, PARSE_OPTIONS) as unknown as Record<string, unknown>

  const currentRow = getEngagementRow(db, id)
  if (!currentRow) {
    throw new NotFoundError('Engagement', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []

  // Common fields: present means "set it", absent means "leave it" — the
  // same `in` distinction companies.ts uses, correct now that `parseInput`
  // has already stripped explicitly-`undefined` keys down to genuinely
  // absent ones.
  for (const spec of UPDATE_COMMON_COLUMNS) {
    if (!(spec.key in parsed)) continue
    setClauses.push(`${spec.column} = ?`)
    values.push(parsed[spec.key] ?? null)
  }

  // `agreedRateCents` is deliberately never read out of `parsed` here, even
  // though `updateEngagementInputSchema` accepts the key (so a caller that
  // echoes a full record back does not get a spurious `ValidationError`).
  // This is the one line that makes "ignored on update" true: the snapshot
  // taken at signature cannot drift by accident, and there is no re-rate
  // path in this task's Scope — see electron/shared/engagements.ts's header.

  // Model-specific columns only move as a set — and only reset to NULL the
  // ones the patch does not carry — when the patch actually *changes* the
  // billing model. Switching `billingModel` writes the matching column(s)
  // from the patch and resets the other model's stale columns to NULL,
  // rather than leaving e.g. a retainer's `hoursIncluded` sitting on a row
  // that just became `fixed`. But a patch that names the *same* model the
  // row already has — `{ billingModel: 'tm', hourlyRateCents: 30000 }` on an
  // already-`tm` engagement — is a partial patch within that model, not a
  // switch: unnamed columns (`estimatedHours`, `notToExceedCents`) must be
  // left alone, exactly like `UPDATE_COMMON_COLUMNS` above, not NULLed out.
  // A patch that does not mention `billingModel` at all leaves every one of
  // these five columns untouched, same as before.
  if ('billingModel' in parsed) {
    setClauses.push('billing_model = ?')
    values.push(parsed.billingModel)
    const modelIsChanging = parsed.billingModel !== currentRow.billing_model
    for (const spec of MODEL_SPECIFIC_COLUMNS) {
      if (modelIsChanging) {
        setClauses.push(`${spec.column} = ?`)
        values.push(spec.key in parsed ? (parsed[spec.key] ?? null) : null)
      } else if (spec.key in parsed) {
        setClauses.push(`${spec.column} = ?`)
        values.push(parsed[spec.key] ?? null)
      }
    }
  }

  const timestamp = nowTimestamp()
  setClauses.push('updated_at = ?')
  values.push(timestamp)
  values.push(id)

  try {
    db.prepare(`UPDATE engagements SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(CONSTRAINT_HANDLERS, error)
  }

  return getEngagement(db, id) as Engagement
}

/**
 * Refuses before deleting, in the same transaction as the delete —
 * `referential-guard.ts`'s header and `companies.ts`'s `deleteCompany` make
 * the same point: migration 0001 uses `ON DELETE no action`, not
 * `RESTRICT`, so this pre-check is the only thing standing between a caller
 * and a bare `SQLITE_CONSTRAINT_FOREIGNKEY`.
 *
 * Five references can block an engagement delete — every foreign key
 * migration 0001 points at `engagements.id`: `milestones.engagement_id`,
 * `revenue_lines.engagement_id`, `time_entries.engagement_id`,
 * `tasks.engagement_id`, `activity.engagement_id`.
 */
export function deleteEngagement(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    const engagement = getEngagementRow(db, id)
    if (!engagement) {
      throw new NotFoundError('Engagement', id)
    }

    refuseIfReferenced(db, id, [
      {
        table: 'milestones',
        column: 'engagement_id',
        reason: 'milestones',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${engagement.name}": ${count} milestone${count === 1 ? '' : 's'} reference it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Remove those milestones before deleting this engagement.'
      },
      {
        table: 'revenue_lines',
        column: 'engagement_id',
        reason: 'revenue-lines',
        describe: (count) =>
          `Cannot delete "${engagement.name}": ${count} revenue line${count === 1 ? '' : 's'} reference it. ` +
          'Revenue lines are the materialised record ADR-003 relies on and cannot be reassigned or removed to make room.'
      },
      {
        table: 'time_entries',
        column: 'engagement_id',
        reason: 'time-entries',
        describe: (count) =>
          `Cannot delete "${engagement.name}": ${count} time entr${count === 1 ? 'y' : 'ies'} reference it. ` +
          'Reassign or remove those time entries before deleting this engagement.'
      },
      {
        table: 'tasks',
        column: 'engagement_id',
        reason: 'tasks',
        exampleColumn: 'title',
        describe: (count, example) =>
          `Cannot delete "${engagement.name}": ${count} task${count === 1 ? '' : 's'} reference it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign or remove those tasks before deleting this engagement.'
      },
      {
        table: 'activity',
        column: 'engagement_id',
        reason: 'activity',
        describe: (count) =>
          `Cannot delete "${engagement.name}": it has ${count} activity record${count === 1 ? '' : 's'}. ` +
          'Activity is append-only (G8) and cannot be reassigned or removed to make room.'
      }
    ])

    db.prepare('DELETE FROM engagements WHERE id = ?').run(id)
  })

  run()
}
