import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import {
  COMPANY_KINDS,
  type Company,
  type CompanyKind,
  type CreateCompanyInput,
  createCompanyInputSchema,
  type UpdateCompanyInput,
  updateCompanyInputSchema
} from '../../../shared/companies'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import { refuseIfReferenced } from './referential-guard'

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
 *
 * `Company`, `COMPANY_KINDS` and the create/update zod schemas live in
 * `electron/shared/companies.ts` (ADR-007), not here — that module is pure
 * zod with no Node imports so it can be typechecked under both
 * `tsconfig.node.json` and `tsconfig.web.json`, and T-260828-26's IPC
 * channels import it directly rather than redeclaring the wire shape. This
 * file re-exports the pieces its own call sites already use so nothing
 * downstream of *this* module (tests, eventually the IPC layer) needs to
 * know the split happened.
 */
export { COMPANY_KINDS, createCompanyInputSchema, updateCompanyInputSchema }
export type { Company, CompanyKind, CreateCompanyInput, UpdateCompanyInput }

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new ValidationError(message, result.error.issues)
  }
  // zod's `.partial()` marks a field optional, not absent: a patch that sets
  // a key to the literal value `undefined` (the shape a renderer's
  // `{ field: dirty ? value : undefined }` naturally produces, and the shape
  // Electron's structured clone preserves across the IPC boundary) still
  // parses with that key present, holding `undefined`. Every write path
  // below distinguishes "key absent" from "key present" via `in`, so an
  // undefined-valued key left in `result.data` would read as "the caller
  // explicitly set this" and either wipe a column to NULL (updateCompany) or
  // skip a documented CREATE_DEFAULTS default (createCompany). Stripping
  // undefined-valued keys here, once, makes "absent" and "explicitly
  // undefined" the same thing for every caller, which is what a JS object
  // literal actually means.
  return stripUndefinedValues(result.data)
}

function stripUndefinedValues<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value
  const cleaned = { ...(value as Record<string, unknown>) }
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === undefined) delete cleaned[key]
  }
  return cleaned as T
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
 * `key in parsed` below distinguishes the two, now that `parseInput` has
 * already stripped explicitly-`undefined` keys down to genuinely absent
 * ones — and is honoured as `null`, not upgraded to the default.
 */
const CREATE_DEFAULTS: Partial<Record<WritableKey, unknown>> = {
  billsDirectly: true,
  cadenceDays: 14
}

// ---------------------------------------------------------------------------
// SQLite constraint translation
// ---------------------------------------------------------------------------

interface SqliteConstraintError {
  readonly code: string
  readonly message: string
}

function isSqliteConstraintError(error: unknown): error is SqliteConstraintError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    (error as { code: string }).code.startsWith('SQLITE_CONSTRAINT')
  )
}

/** The one named `CHECK` constraint `companies` currently declares (migration 0001). */
const SELF_REFERENCE_CHECK_NAME = 'companies_billed_via_company_not_self'

type ConstraintHandler = (error: SqliteConstraintError) => RefusalError

/**
 * One entry per `SQLITE_CONSTRAINT_*` subcode this table can actually raise,
 * dispatched on the code (and, for `CHECK`, on the constraint name) rather
 * than by forwarding `error.message` into user-facing text. better-sqlite3's
 * message is an implementation detail of the SQLite build it links — not
 * something to show an operator or to string-match on later — so nothing
 * here reads it except this one `includes()` check against a name this
 * repository itself defined in the migration.
 *
 * Adding a second `CHECK` constraint to `companies` means adding a branch
 * here, not editing the fallback: the previous version of this table mapped
 * *every* `SQLITE_CONSTRAINT_CHECK` to the self-reference sentence, which
 * was only ever correct because there was exactly one `CHECK` to confuse it
 * with.
 */
const CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_CHECK: (error) => {
    if (error.message.includes(SELF_REFERENCE_CHECK_NAME)) {
      return new RefusalError(
        'billedViaCompanyId cannot reference the company\'s own id — enforced by the database ' +
          `(CHECK ${SELF_REFERENCE_CHECK_NAME}).`,
        { reason: 'self-reference' }
      )
    }
    return new RefusalError('This write violates a data rule enforced by the database.', { reason: 'check' })
  },
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError(
      'This write references a company that does not exist — check billedViaCompanyId and introducedByCompanyId.',
      { reason: 'foreign-key' }
    ),
  SQLITE_CONSTRAINT_NOTNULL: () => new RefusalError('A required field was left empty.', { reason: 'not-null' }),
  SQLITE_CONSTRAINT_UNIQUE: () => new RefusalError('This value conflicts with an existing row.', { reason: 'unique' }),
  SQLITE_CONSTRAINT_PRIMARYKEY: () => new RefusalError('This id is already in use.', { reason: 'primary-key' })
}

/** Turns a thrown `SqliteError` from an insert/update into a `RefusalError`. Anything else propagates unchanged. */
function translateWriteError(error: unknown): never {
  if (isSqliteConstraintError(error)) {
    const handler = CONSTRAINT_HANDLERS[error.code]
    if (handler) throw handler(error)
    // A `SQLITE_CONSTRAINT_*` subcode this table cannot currently raise
    // (e.g. `SQLITE_CONSTRAINT_TRIGGER`, `_VTAB`). Still a refusal, not a
    // crash — but still no raw driver text in the user-facing message.
    throw new RefusalError('This write violates a database constraint.', { reason: 'constraint' })
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
    // distinction this task's Risks note calls out for `billsDirectly`,
    // applied uniformly to every column rather than special-cased for one,
    // and correct now that `parseInput` has already stripped
    // explicitly-`undefined` keys down to genuinely absent ones.
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
 * task's Risks: catching a constraint error after the fact only covers
 * whichever single foreign key fired, produces a raw SQLite string for it,
 * and — since migration 0001 declares every foreign key `ON DELETE no
 * action`, not `RESTRICT` — is the *only* thing standing between a caller
 * and a bare `SQLITE_CONSTRAINT_FOREIGNKEY` with no table, column or row
 * count attached).
 *
 * Eight references can block a company delete: two self-referencing
 * columns on `companies` itself, plus one column each on `activity`,
 * `engagements` (twice), `tasks`, `affiliations` and `time_entries` —
 * every foreign key migration 0001 points at `companies.id`.
 * `refuseIfReferenced` (`referential-guard.ts`) runs them in order inside
 * one `db.transaction()` so nothing can change between the check and the
 * delete, and stops at the first one that blocks.
 */
export function deleteCompany(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    const company = getCompanyRow(db, id)
    if (!company) {
      throw new NotFoundError('Company', id)
    }

    refuseIfReferenced(db, id, [
      {
        table: 'companies',
        column: 'billed_via_company_id',
        reason: 'billed-via',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${company.name}": ${count} compan${count === 1 ? 'y bills' : 'ies bill'} through it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign their billing before deleting this company.'
      },
      {
        table: 'companies',
        column: 'introduced_by_company_id',
        reason: 'introduced-by',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${company.name}": it introduced ${count} other compan${count === 1 ? 'y' : 'ies'}` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Clear that reference before deleting this company.'
      },
      {
        table: 'activity',
        column: 'company_id',
        reason: 'activity',
        describe: (count) =>
          `Cannot delete "${company.name}": it has ${count} activity record${count === 1 ? '' : 's'}. ` +
          'Activity is append-only (G8) and cannot be reassigned or removed to make room.'
      },
      {
        table: 'engagements',
        column: 'billing_company_id',
        reason: 'engagement-billing',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${company.name}": ${count} engagement${count === 1 ? '' : 's'} bill${count === 1 ? 's' : ''} through it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign billing before deleting this company.'
      },
      {
        table: 'engagements',
        column: 'client_company_id',
        reason: 'engagement-client',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${company.name}": it is the client on ${count} engagement${count === 1 ? '' : 's'}` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign or close those engagements before deleting this company.'
      },
      {
        table: 'tasks',
        column: 'company_id',
        reason: 'tasks',
        exampleColumn: 'title',
        describe: (count, example) =>
          `Cannot delete "${company.name}": ${count} task${count === 1 ? '' : 's'} reference it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign or remove those tasks before deleting this company.'
      },
      {
        table: 'affiliations',
        column: 'company_id',
        reason: 'affiliations',
        describe: (count) =>
          `Cannot delete "${company.name}": ${count} affiliation${count === 1 ? '' : 's'} reference it. ` +
          'Reassign or remove those affiliations before deleting this company.'
      },
      {
        table: 'time_entries',
        column: 'company_id',
        reason: 'time-entries',
        describe: (count) =>
          `Cannot delete "${company.name}": ${count} time entr${count === 1 ? 'y' : 'ies'} reference it. ` +
          'Reassign or remove those time entries before deleting this company.'
      }
    ])

    db.prepare('DELETE FROM companies WHERE id = ?').run(id)
  })

  run()
}
