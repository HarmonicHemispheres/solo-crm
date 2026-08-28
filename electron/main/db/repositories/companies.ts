import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import { dateOnlySchema, timestampSchema } from '../../../shared/types'
import { NotFoundError, RefusalError, ValidationError } from './errors'

/**
 * The `companies` repository (T-260828-20) — the first module in this
 * codebase that reads or writes a domain row. `schema.ts`'s header comment
 * explains why every write below sets `created_at`/`updated_at` from JS
 * (`nowTimestamp()`) and never relies on a SQL-side default, and why ids are
 * `crypto.randomUUID()` assigned here, never a caller-supplied value or a
 * SQL `DEFAULT`.
 *
 * Deliberately raw `db.prepare(...).run(...)` throughout, matching
 * `seed/index.ts`'s existing pattern — this repo is not built on
 * `drizzle-orm`'s query builder; `schema.ts` exists only to generate
 * migrations (see that file's header), not to be imported here.
 *
 * `billed_via_company_id` is a billing pointer, not a company hierarchy —
 * §5's modelling note, restated in this task's Risks. There is deliberately
 * no `getSubsidiaries()`/`getBilledCompanies()` helper here: a convenience
 * reader over that column is exactly the kind of thing that quietly turns a
 * flat pointer into an implied tree. A caller that needs "who bills through
 * this company" can query it directly.
 */

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** schema.ts's comment on `kind`: "client | prospect | end_client | advisory | channel". */
export const COMPANY_KINDS = ['client', 'prospect', 'end_client', 'advisory', 'channel'] as const
export type CompanyKind = (typeof COMPANY_KINDS)[number]

/** A `companies` row, camelCased, as read back from the database. */
export interface Company {
  readonly id: string
  readonly name: string
  readonly kind: CompanyKind | null
  readonly website: string | null
  readonly billsDirectly: boolean | null
  readonly billedViaCompanyId: string | null
  readonly introducedByCompanyId: string | null
  readonly cadenceDays: number | null
  /** ADR-001: maintained by the activity repository (P1-05) and the Gmail adapter, not derived here. */
  readonly lastTouchAt: string | null
  readonly budgetNote: string | null
  readonly notes: string | null
  readonly since: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

// ---------------------------------------------------------------------------
// Zod input schemas
// ---------------------------------------------------------------------------

/**
 * Every writable column except `id`/`created_at`/`updated_at` (assigned by
 * this repository, never by a caller). `.partial()` below derives the
 * update schema from this one so the two can never drift on which fields
 * exist or how each is validated.
 */
const companyWritableFieldsSchema = z.object({
  name: z.string().min(1, 'name is required'),
  kind: z.enum(COMPANY_KINDS).nullable(),
  website: z.string().nullable(),
  billsDirectly: z.boolean().nullable(),
  billedViaCompanyId: z.string().min(1).nullable(),
  introducedByCompanyId: z.string().min(1).nullable(),
  cadenceDays: z.number().int().positive().nullable(),
  // A timestamp, not `since`'s bare date — occurred_at-shaped, matching
  // schema.ts's `lastTouchAt: text('last_touch_at')` alongside
  // `activity.occurred_at`.
  lastTouchAt: timestampSchema.nullable(),
  budgetNote: z.string().nullable(),
  notes: z.string().nullable(),
  since: dateOnlySchema.nullable()
})

export const createCompanyInputSchema = companyWritableFieldsSchema.partial({
  kind: true,
  website: true,
  billsDirectly: true,
  billedViaCompanyId: true,
  introducedByCompanyId: true,
  cadenceDays: true,
  lastTouchAt: true,
  budgetNote: true,
  notes: true,
  since: true
})
export type CreateCompanyInput = z.infer<typeof createCompanyInputSchema>

export const updateCompanyInputSchema = companyWritableFieldsSchema.partial()
export type UpdateCompanyInput = z.infer<typeof updateCompanyInputSchema>

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new ValidationError(message, result.error.issues)
  }
  return result.data
}

// ---------------------------------------------------------------------------
// Column mapping — shared between createCompany and updateCompany so the two
// can never disagree on a column name or a value transform.
// ---------------------------------------------------------------------------

type WritableKey = keyof CreateCompanyInput

interface FieldSpec {
  readonly key: WritableKey
  readonly column: string
  readonly toSql?: (value: unknown) => unknown
}

const boolToSql = (value: unknown): unknown => (value === null || value === undefined ? null : value ? 1 : 0)

const FIELD_SPECS: readonly FieldSpec[] = [
  { key: 'name', column: 'name' },
  { key: 'kind', column: 'kind' },
  { key: 'website', column: 'website' },
  { key: 'billsDirectly', column: 'bills_directly', toSql: boolToSql },
  { key: 'billedViaCompanyId', column: 'billed_via_company_id' },
  { key: 'introducedByCompanyId', column: 'introduced_by_company_id' },
  { key: 'cadenceDays', column: 'cadence_days' },
  { key: 'lastTouchAt', column: 'last_touch_at' },
  { key: 'budgetNote', column: 'budget_note' },
  { key: 'notes', column: 'notes' },
  { key: 'since', column: 'since' }
]

/**
 * Defaults applied on create only, when the caller omits the field — the
 * same values `schema.ts`'s `DEFAULT true` / `DEFAULT 14` describe. These
 * exist in JS, not SQL, because `createCompany` always names every column
 * explicitly in its `INSERT` (this task's Risks: an omitted column must not
 * silently fall through to something other than this exact default). An
 * explicit `null` from the caller is a different thing from an omitted key —
 * `key in parsed` below distinguishes the two — and is honoured as `null`,
 * not upgraded to the default.
 */
const CREATE_DEFAULTS: Partial<Record<WritableKey, unknown>> = {
  billsDirectly: true,
  cadenceDays: 14
}

// ---------------------------------------------------------------------------
// SQLite constraint translation
// ---------------------------------------------------------------------------

function isSqliteConstraintError(error: unknown): error is { readonly code: string; readonly message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  )
}

/** Turns a thrown `SqliteError` from an insert/update into a `RefusalError`. Anything else propagates unchanged. */
function translateWriteError(error: unknown): never {
  if (isSqliteConstraintError(error)) {
    if (error.code === 'SQLITE_CONSTRAINT_CHECK') {
      throw new RefusalError(
        'billedViaCompanyId cannot reference the company\'s own id — enforced by the database ' +
          '(CHECK companies_billed_via_company_not_self).'
      )
    }
    throw new RefusalError(`This write violates a database constraint: ${error.message}`)
  }
  throw error
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface CompanyRow {
  readonly id: string
  readonly name: string
  readonly kind: string | null
  readonly website: string | null
  readonly bills_directly: number | null
  readonly billed_via_company_id: string | null
  readonly introduced_by_company_id: string | null
  readonly cadence_days: number | null
  readonly last_touch_at: string | null
  readonly budget_note: string | null
  readonly notes: string | null
  readonly since: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapRow(row: CompanyRow): Company {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as CompanyKind | null,
    website: row.website,
    billsDirectly: row.bills_directly === null ? null : row.bills_directly === 1,
    billedViaCompanyId: row.billed_via_company_id,
    introducedByCompanyId: row.introduced_by_company_id,
    cadenceDays: row.cadence_days,
    lastTouchAt: row.last_touch_at,
    budgetNote: row.budget_note,
    notes: row.notes,
    since: row.since,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getCompanyRow(db: Database.Database, id: string): CompanyRow | undefined {
  return db.prepare('SELECT * FROM companies WHERE id = ?').get(id) as CompanyRow | undefined
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function listCompanies(db: Database.Database): readonly Company[] {
  const rows = db.prepare('SELECT * FROM companies ORDER BY name COLLATE NOCASE').all() as CompanyRow[]
  return rows.map(mapRow)
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getCompany(db: Database.Database, id: string): Company | null {
  const row = getCompanyRow(db, id)
  return row ? mapRow(row) : null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function createCompany(db: Database.Database, input: unknown): Company {
  const parsed = parseInput(createCompanyInputSchema, input)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const columns = ['id', ...FIELD_SPECS.map((spec) => spec.column), 'created_at', 'updated_at']
  const placeholders = columns.map(() => '?').join(', ')
  const values: unknown[] = [id]
  for (const spec of FIELD_SPECS) {
    const raw = spec.key in parsed ? parsed[spec.key] : (CREATE_DEFAULTS[spec.key] ?? null)
    values.push(spec.toSql ? spec.toSql(raw) : raw)
  }
  values.push(timestamp, timestamp)

  try {
    db.prepare(`INSERT INTO companies (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  } catch (error) {
    translateWriteError(error)
  }

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return getCompany(db, id) as Company
}

export function updateCompany(db: Database.Database, id: string, patch: unknown): Company {
  const parsed = parseInput(updateCompanyInputSchema, patch)

  if (!getCompanyRow(db, id)) {
    throw new NotFoundError('Company', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  for (const spec of FIELD_SPECS) {
    // `in`, not a truthiness/undefined check: distinguishes "the caller
    // explicitly set this to null" (write NULL) from "the caller did not
    // mention this field" (leave the column untouched) — the exact
    // distinction this task's Risks note calls out for `billsDirectly`, and
    // applied uniformly to every column rather than special-cased for one.
    if (!(spec.key in parsed)) continue
    const raw = parsed[spec.key]
    setClauses.push(`${spec.column} = ?`)
    values.push(spec.toSql ? spec.toSql(raw) : raw)
  }

  const timestamp = nowTimestamp()
  setClauses.push('updated_at = ?')
  values.push(timestamp)
  values.push(id)

  try {
    db.prepare(`UPDATE companies SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(error)
  }

  return getCompany(db, id) as Company
}

/**
 * Refuses before deleting, in the same transaction as the delete (this
 * task's Risks: catching `SQLITE_CONSTRAINT_FOREIGNKEY` after the fact would
 * only cover the FK-backed cases — `billed_via_company_id` and
 * `introduced_by_company_id` — and produce a raw SQLite string for whichever
 * case fires, while `activity`'s block has to be checked explicitly either
 * way since its rows are never deleted or reassigned to make room). All
 * three checks run inside one `db.transaction()` so nothing can change
 * between the check and the delete.
 */
export function deleteCompany(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    const company = getCompanyRow(db, id)
    if (!company) {
      throw new NotFoundError('Company', id)
    }

    const billedViaCount = (
      db.prepare('SELECT COUNT(*) AS count FROM companies WHERE billed_via_company_id = ?').get(id) as {
        count: number
      }
    ).count
    if (billedViaCount > 0) {
      const example = db
        .prepare('SELECT name FROM companies WHERE billed_via_company_id = ? LIMIT 1')
        .get(id) as { name: string }
      throw new RefusalError(
        `Cannot delete "${company.name}": ${billedViaCount} compan${billedViaCount === 1 ? 'y bills' : 'ies bill'} ` +
          `through it (e.g. "${example.name}"). Reassign their billing before deleting this company.`,
        { reason: 'billed-via', count: billedViaCount }
      )
    }

    const introducedByCount = (
      db.prepare('SELECT COUNT(*) AS count FROM companies WHERE introduced_by_company_id = ?').get(id) as {
        count: number
      }
    ).count
    if (introducedByCount > 0) {
      const example = db
        .prepare('SELECT name FROM companies WHERE introduced_by_company_id = ? LIMIT 1')
        .get(id) as { name: string }
      throw new RefusalError(
        `Cannot delete "${company.name}": it introduced ${introducedByCount} other ` +
          `compan${introducedByCount === 1 ? 'y' : 'ies'} (e.g. "${example.name}"). ` +
          'Clear that reference before deleting this company.',
        { reason: 'introduced-by', count: introducedByCount }
      )
    }

    const activityCount = (
      db.prepare('SELECT COUNT(*) AS count FROM activity WHERE company_id = ?').get(id) as { count: number }
    ).count
    if (activityCount > 0) {
      throw new RefusalError(
        `Cannot delete "${company.name}": it has ${activityCount} activity record${activityCount === 1 ? '' : 's'}. ` +
          'Activity is append-only (G8) and cannot be reassigned or removed to make room.',
        { reason: 'activity', count: activityCount }
      )
    }

    db.prepare('DELETE FROM companies WHERE id = ?').run(id)
  })

  run()
}
