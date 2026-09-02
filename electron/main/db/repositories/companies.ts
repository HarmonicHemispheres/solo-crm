import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { ChainCycleError, ChainDepthExceededError, MAX_CHAIN_DEPTH, walkChain } from '../chain-walk'
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
import { NotFoundError, RefusalError } from './errors'
import { boolToSql, parseInput } from './input'
import type { DeletionImpact } from '../../../shared/deletion'
import { impactOf, runCascade } from './cascade'
import { refuseIfReferenced } from './referential-guard'
import {
  type ConstraintHandler,
  NOT_NULL_HANDLER,
  PRIMARY_KEY_HANDLER,
  translateWriteError,
  UNIQUE_HANDLER
} from './sqlite-errors'

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
// Column mapping — shared between createCompany and updateCompany so the two
// can never disagree on a column name or a value transform.
// ---------------------------------------------------------------------------

type WritableKey = keyof CreateCompanyInput

interface FieldSpec {
  readonly key: WritableKey
  readonly column: string
  readonly toSql?: (value: unknown) => unknown
}

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

/** The one named `CHECK` constraint `companies` currently declares (migration 0001). */
const SELF_REFERENCE_CHECK_NAME = 'companies_billed_via_company_not_self'

/**
 * One entry per `SQLITE_CONSTRAINT_*` subcode this table can actually raise,
 * dispatched on the code (and, for `CHECK`, on the constraint name) rather
 * than by forwarding `error.message` into user-facing text — see
 * `sqlite-errors.ts` for that discipline, and for the three generic handlers
 * this map opts into. Nothing here reads `error.message` except the one
 * `includes()` check against a name this repository itself defined in the
 * migration.
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
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
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
// Billed-via / introduced-by cycle guard (T-260828-42)
//
// The database `CHECK` (`SELF_REFERENCE_CHECK_NAME` above) blocks only a
// direct self-reference on `billed_via_company_id`, and nothing at all on
// `introduced_by_company_id` — SQLite cannot express reachability in a
// `CHECK`. A two-step cycle passes both: create B billed via A, then update A
// to be billed via B, and the pointer chain is A -> B -> A. This walks the
// EXISTING chain from the proposed target, using the same `walkChain`
// traversal `seed/index.ts`'s `orderCompaniesForInsert` uses (../chain-walk),
// and refuses before the write if that chain would reach the row being
// written.
//
// Deliberately not exported and not a `getBilledCompanies()`-style reader:
// per this file's header comment and T-260828-20's Risks, nothing here walks
// the pointer as if companies had parents outside of this one refusal check.
// ---------------------------------------------------------------------------

type ChainColumn = 'billed_via_company_id' | 'introduced_by_company_id'

interface ChainGuardSpec {
  readonly column: ChainColumn
  readonly fieldLabel: 'billedViaCompanyId' | 'introducedByCompanyId'
  /** Matches the existing `SELF_REFERENCE_CHECK_NAME` refusal's `reason` for `billed_via_company_id` (T-260828-20) — preserved so a caller that already switches on it does not see the reason change out from under it. `introduced_by_company_id` has no such precedent (no database `CHECK` ever guarded it), so it gets its own. */
  readonly selfReferenceReason: string
  readonly transitiveCycleReason: string
  /** The chain ALREADY sitting in the database loops back on itself, independent of this write. A different fact from `depthExceededReason` — the walk closed a loop at a known node, it did not merely run out of steps (T-260828-56). */
  readonly preexistingCycleReason: string
  /** The chain ALREADY sitting in the database ran past `MAX_CHAIN_DEPTH` without terminating and without repeating a node — absurdly long, not (as far as the walk saw) looping. */
  readonly depthExceededReason: string
}

const BILLED_VIA_CHAIN_GUARD: ChainGuardSpec = {
  column: 'billed_via_company_id',
  fieldLabel: 'billedViaCompanyId',
  selfReferenceReason: 'self-reference',
  transitiveCycleReason: 'billed-via-cycle',
  preexistingCycleReason: 'billed-via-chain-cycle',
  depthExceededReason: 'billed-via-chain-depth-exceeded'
}

const INTRODUCED_BY_CHAIN_GUARD: ChainGuardSpec = {
  column: 'introduced_by_company_id',
  fieldLabel: 'introducedByCompanyId',
  // Distinct from the transitive reason: "you pointed this row at itself" and
  // "this pointer would close a loop through other rows" are different facts
  // and a caller may want to say different things about them (T-260828-56).
  selfReferenceReason: 'introduced-by-self-reference',
  transitiveCycleReason: 'introduced-by-cycle',
  preexistingCycleReason: 'introduced-by-chain-cycle',
  depthExceededReason: 'introduced-by-chain-depth-exceeded'
}

/**
 * Refuses if writing `targetId` into `spec.column` on the row `selfId` (named
 * `selfLabel` for the message — `createCompany` has no row yet to read a name
 * back from, so it passes the input's own `name`) would make that column's
 * chain loop back to `selfId`. Runs before the write, in the same style
 * `deleteCompany`'s `refuseIfReferenced` checks before deleting — a check,
 * not a catch-and-translate of a constraint SQLite has no way to express.
 *
 * A no-op when `targetId` is `null`/`undefined` — callers only invoke this
 * when the column is actually part of the patch AND non-null (this file's
 * Risks: running a recursive query behind every company rename would be the
 * tempting, wrong default).
 */
function assertNoChainCycle(db: Database.Database, spec: ChainGuardSpec, selfId: string, selfLabel: string, targetId: string | null): void {
  if (!targetId) return

  if (targetId === selfId) {
    throw new RefusalError(
      `${spec.fieldLabel} cannot reference "${selfLabel}"'s own id.`,
      { reason: spec.selfReferenceReason }
    )
  }

  // Prepared once per guarded write, not once per step of the walk: a
  // 50-deep chain compiled this identical one-column SELECT 50 times before
  // T-260828-56. better-sqlite3 statements are reusable, and `spec.column`
  // is a fixed literal from the two specs above — never caller input.
  const selectParent = db.prepare(`SELECT ${spec.column} AS parent FROM companies WHERE id = ?`)
  const getParentId = (id: string): string | null => {
    const row = selectParent.get(id) as { parent: string | null } | undefined
    return row?.parent ?? null
  }

  let chain: readonly string[]
  try {
    chain = walkChain(targetId, getParentId, (id) => id, MAX_CHAIN_DEPTH)
  } catch (error) {
    // Two different facts about a chain this write did not create, each with
    // its own discriminator and its own sentence (T-260828-56). Conflating
    // them told the operator their data "already exceeds 50 steps" when the
    // walk had in fact closed a 3-cycle at step 3.
    if (error instanceof ChainCycleError) {
      // The EXISTING chain from the proposed target loops back on itself,
      // independent of this write — a bad chain already sitting in the
      // database, which nothing here could have refused going in.
      throw new RefusalError(
        `${spec.fieldLabel} could not be set: the existing ${spec.column} chain starting from the ` +
          'proposed company already loops back on itself, so this write cannot be verified safe. ' +
          'That pre-existing cycle needs fixing on its own first.',
        { reason: spec.preexistingCycleReason }
      )
    }
    if (error instanceof ChainDepthExceededError) {
      // Not looping as far as the walk saw — just longer than the runaway
      // bound, so the walk stopped rather than running on unbounded.
      throw new RefusalError(
        `${spec.fieldLabel} could not be set: the existing ${spec.column} chain starting from the ` +
          `proposed company runs more than ${MAX_CHAIN_DEPTH} steps without reaching a company that ` +
          'bills directly. Refusing rather than walking it unbounded; that pre-existing chain needs ' +
          'fixing on its own before this write can be verified safe.',
        { reason: spec.depthExceededReason }
      )
    }
    throw error
  }

  if (chain.includes(selfId)) {
    const targetRow = getCompanyRow(db, targetId)
    const targetLabel = targetRow?.name ?? targetId
    throw new RefusalError(
      `${spec.fieldLabel} cannot be set to "${targetLabel}": that would make "${selfLabel}"'s ${spec.column} ` +
        `chain loop back to itself through "${targetLabel}".`,
      { reason: spec.transitiveCycleReason }
    )
  }
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

  if (parsed.billedViaCompanyId) {
    assertNoChainCycle(db, BILLED_VIA_CHAIN_GUARD, id, parsed.name, parsed.billedViaCompanyId)
  }
  if (parsed.introducedByCompanyId) {
    assertNoChainCycle(db, INTRODUCED_BY_CHAIN_GUARD, id, parsed.name, parsed.introducedByCompanyId)
  }

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
    translateWriteError(CONSTRAINT_HANDLERS, error)
  }

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return getCompany(db, id) as Company
}

export function updateCompany(db: Database.Database, id: string, patch: unknown): Company {
  const parsed = parseInput(updateCompanyInputSchema, patch)

  const existing = getCompanyRow(db, id)
  if (!existing) {
    throw new NotFoundError('Company', id)
  }

  if ('billedViaCompanyId' in parsed && parsed.billedViaCompanyId) {
    assertNoChainCycle(db, BILLED_VIA_CHAIN_GUARD, id, existing.name, parsed.billedViaCompanyId)
  }
  if ('introducedByCompanyId' in parsed && parsed.introducedByCompanyId) {
    assertNoChainCycle(db, INTRODUCED_BY_CHAIN_GUARD, id, existing.name, parsed.introducedByCompanyId)
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
    translateWriteError(CONSTRAINT_HANDLERS, error)
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
/**
 * `cascade` is the operator's second, explicit confirmation (T-260902-09):
 * they were shown exactly what would go — `companyDeleteImpact` below, which
 * derives its counts from the same declarations `runCascade` deletes by —
 * and said yes. It defaults to false, so every caller that does not opt in
 * keeps the refusing behaviour this function has always had.
 */

/**
 * What deleting this company would take with it — the counts the renderer's
 * confirmation shows before it asks again with `cascade: true`
 * (T-260902-09). Read-only, and derived from the same step declarations
 * `runCascade` deletes by, so the dialog cannot promise one thing and the
 * delete do another (`cascade.ts`'s header).
 */
export function companyDeleteImpact(db: Database.Database, id: string): DeletionImpact {
  const row = getCompanyRow(db, id)
  if (!row) {
    throw new NotFoundError('Company', id)
  }
  return impactOf(db, 'company', id, row.name)
}

export function deleteCompany(db: Database.Database, id: string, cascade = false): void {
  const run = db.transaction(() => {
    const company = getCompanyRow(db, id)
    if (!company) {
      throw new NotFoundError('Company', id)
    }

    if (cascade) {
      runCascade(db, 'company', id)
      return
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
        // Was "Reassign or remove those affiliations" — reassigning is not a
        // route that exists: `updateAffiliation` rejects `personId` and
        // `companyId`, the pair being fixed at creation. Removing is, since
        // T-260828-46 added `deleteAffiliation`, so this now names the one
        // real way out and matches `deletePerson`'s wording exactly.
        describe: (count) =>
          `Cannot delete "${company.name}": ${count} affiliation${count === 1 ? '' : 's'} reference it. ` +
          'Remove those affiliations before deleting this company.'
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
