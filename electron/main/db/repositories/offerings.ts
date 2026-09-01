import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { nowTimestamp } from '../../../shared/format'
import {
  type CreateOfferingCategoryInput,
  createOfferingCategoryInputSchema,
  type CreateOfferingInput,
  createOfferingInputSchema,
  type DuplicateOfferingInput,
  duplicateOfferingInputSchema,
  type ListOfferingsFilter,
  listOfferingsFilterSchema,
  OFFERING_BILLING_MODELS,
  OFFERING_TYPES,
  OFFERING_UNITS,
  type Offering,
  type OfferingBillingModel,
  type OfferingCategory,
  type OfferingListItem,
  type OfferingType,
  type OfferingUnit,
  type OfferingVersion,
  type OfferingWithVersions,
  type UpdateOfferingCategoryInput,
  updateOfferingCategoryInputSchema,
  type UpdateOfferingInput,
  updateOfferingInputSchema
} from '../../../shared/offerings'
import { NotFoundError, RefusalError } from './errors'
import { boolToSql, parseInput } from './input'
import { refuseIfReferenced } from './referential-guard'
import { type ConstraintHandler, NOT_NULL_HANDLER, PRIMARY_KEY_HANDLER, translateWriteError, UNIQUE_HANDLER } from './sqlite-errors'

/**
 * The offerings repository (T-260901-05, plan P3-01) — the first module to
 * read or write `offering_categories`, `offerings` and `offering_versions`.
 * Until this file existed the dev seed was their only writer, which is why
 * `0006_offerings_rename.sql` could rename all three with a plain `ALTER
 * TABLE`.
 *
 * Built on the shape `companies.ts` and `engagements.ts` already use, with
 * the machinery T-260828-43 extracted (`input.ts`, `sqlite-errors.ts`,
 * `referential-guard.ts`) imported rather than re-copied: deliberately raw
 * `db.prepare(...).run(...)` throughout, ids from `crypto.randomUUID()`
 * assigned here, timestamps from `nowTimestamp()` and never a SQL-side
 * default. `schema.ts` exists to generate migrations, not to be imported
 * here.
 *
 * The types, the create/update zod schemas and the three closed vocabularies
 * live in `electron/shared/offerings.ts` (ADR-007), not here. This module
 * re-exports the pieces its own call sites already use so nothing downstream
 * needs to know the split happened.
 *
 * **This file computes no money.** It returns `rate_cents` as stored, which
 * ADR-003 permits explicitly ("reading an offering's price for display is a
 * legal read of an offering column"); it never sums, projects, annualises, or
 * branches on `billingModel`/`unit` to derive a figure. Every revenue
 * question goes through `revenue_lines` (P3-05).
 *
 * **Nothing here deletes an offering.** `archiveOffering` sets `active = 0`
 * and the row stays readable by id and still resolvable from an engagement's
 * `offering_version_id` — a price an engagement was signed against cannot
 * stop existing because the catalogue moved on. The one delete in this file
 * is `deleteOfferingCategory`, and it refuses while any offering still names
 * the category.
 *
 * **Changing a price is not here.** Closing the current version and
 * appending the next is P3-02, which carries its own architecture review.
 * This file creates an offering's *first* version and reads the history;
 * `assertNoOverlappingVersion` below is the rule P3-02 will enforce its
 * append with, exported for exactly that reason.
 */
export {
  createOfferingCategoryInputSchema,
  createOfferingInputSchema,
  duplicateOfferingInputSchema,
  listOfferingsFilterSchema,
  OFFERING_BILLING_MODELS,
  OFFERING_TYPES,
  OFFERING_UNITS,
  updateOfferingCategoryInputSchema,
  updateOfferingInputSchema
}
export type {
  CreateOfferingCategoryInput,
  CreateOfferingInput,
  DuplicateOfferingInput,
  ListOfferingsFilter,
  Offering,
  OfferingBillingModel,
  OfferingCategory,
  OfferingListItem,
  OfferingType,
  OfferingUnit,
  OfferingVersion,
  OfferingWithVersions,
  UpdateOfferingCategoryInput,
  UpdateOfferingInput
}

// ---------------------------------------------------------------------------
// Column mapping — shared between create and update so the two can never
// disagree on a column name or a value transform.
// ---------------------------------------------------------------------------

interface ColumnSpec<Key extends string> {
  readonly key: Key
  readonly column: string
}

/** Fails typecheck naming any writable key no entry below maps to a column. */
type AssertNever<T extends never> = T

type CategoryWritableKey = keyof CreateOfferingCategoryInput

const CATEGORY_COLUMNS = [
  { key: 'name', column: 'name' },
  { key: 'color', column: 'color' },
  { key: 'sort', column: 'sort' }
] as const satisfies ReadonlyArray<ColumnSpec<CategoryWritableKey>>

// Exported only because `noUnusedLocals` would otherwise error on it. Nothing
// imports these; they are compile-time assertions, not API.
export type EveryCategoryKeyHasAColumn = AssertNever<Exclude<CategoryWritableKey, (typeof CATEGORY_COLUMNS)[number]['key']>>

/** Every writable `offerings` column except `active` (moved only by `archiveOffering`) and the three the repository assigns. */
type OfferingWritableKey = keyof UpdateOfferingInput

const OFFERING_COLUMNS = [
  { key: 'name', column: 'name' },
  { key: 'type', column: 'type' },
  { key: 'categoryId', column: 'category_id' },
  { key: 'billingModel', column: 'billing_model' },
  { key: 'unit', column: 'unit' },
  { key: 'blurb', column: 'blurb' }
] as const satisfies ReadonlyArray<ColumnSpec<OfferingWritableKey>>

export type EveryOfferingKeyHasAColumn = AssertNever<Exclude<OfferingWritableKey, (typeof OFFERING_COLUMNS)[number]['key']>>

// ---------------------------------------------------------------------------
// SQLite constraint translation
// ---------------------------------------------------------------------------

/**
 * Migration 0001 declares no `CHECK` constraint on any of the three tables
 * (see its `services` / `service_versions` / `service_categories` DDL), so
 * there is no `CHECK` branch here — only the constraint kinds these tables
 * can actually raise. Adding one later means adding a branch, not editing a
 * fallback, which is the discipline `companies.ts`'s header explains.
 *
 * Two separate handler maps because the two `FOREIGNKEY` sentences name
 * different columns, and naming the wrong one is the whole reason
 * `sqlite-errors.ts` keeps that message per-repository.
 */
const OFFERING_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This write references an offering category that does not exist — check categoryId.', { reason: 'foreign-key' }),
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

const VERSION_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This version references an offering that does not exist — check offeringId.', { reason: 'foreign-key' }),
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

const CATEGORY_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
  SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface OfferingCategoryRow {
  readonly id: string
  readonly name: string | null
  readonly color: string | null
  readonly sort: number | null
  readonly created_at: string
  readonly updated_at: string
}

function mapCategoryRow(row: OfferingCategoryRow): OfferingCategory {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

interface OfferingRow {
  readonly id: string
  readonly name: string
  readonly type: string | null
  readonly category_id: string | null
  readonly billing_model: string | null
  readonly unit: string | null
  readonly blurb: string | null
  readonly active: number | null
  readonly created_at: string
  readonly updated_at: string
}

function mapOfferingRow(row: OfferingRow): Offering {
  return {
    id: row.id,
    name: row.name,
    type: row.type as OfferingType | null,
    categoryId: row.category_id,
    billingModel: row.billing_model as OfferingBillingModel | null,
    unit: row.unit as OfferingUnit | null,
    blurb: row.blurb,
    // Same `=== null ? null : === 1` shape `companies.ts` uses for
    // `bills_directly`: SQLite has no boolean, and a NULL must stay NULL
    // rather than collapsing to `false`.
    active: row.active === null ? null : row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

interface OfferingVersionRow {
  readonly id: string
  readonly offering_id: string | null
  readonly version: number | null
  readonly rate_cents: number | null
  readonly effective_from: string | null
  readonly effective_to: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapVersionRow(row: OfferingVersionRow): OfferingVersion {
  return {
    id: row.id,
    offeringId: row.offering_id,
    version: row.version,
    rateCents: row.rate_cents,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getCategoryRow(db: Database.Database, id: string): OfferingCategoryRow | undefined {
  return db.prepare('SELECT * FROM offering_categories WHERE id = ?').get(id) as OfferingCategoryRow | undefined
}

function getOfferingRow(db: Database.Database, id: string): OfferingRow | undefined {
  return db.prepare('SELECT * FROM offerings WHERE id = ?').get(id) as OfferingRow | undefined
}

/**
 * Newest first, so `[0]` is the current version. `effective_to IS NULL`
 * evaluates to 1 for the open-ended row and 0 otherwise, and `DESC` puts the
 * 1 first — the open-ended version is by definition the one in force, and
 * `assertNoOverlappingVersion` guarantees there is at most one of them per
 * offering (a second open-ended range would overlap the first). `sort IS
 * NULL`-style ordering is the same idiom `listMilestones` uses for a nullable
 * ordering column. `effective_from DESC` then orders closed ranges latest
 * first, and `version DESC` breaks ties for versions that carry no dates at
 * all.
 */
const VERSION_ORDER = 'ORDER BY effective_to IS NULL DESC, effective_from DESC, version DESC, created_at DESC'

// ---------------------------------------------------------------------------
// The version-range rule
// ---------------------------------------------------------------------------

/**
 * Refuses if a version spanning `effectiveFrom`..`effectiveTo` would overlap
 * a version already recorded for `offeringId`. Both ends are **inclusive**,
 * and `null` on either end means unbounded — so `[2026-01-01, 2026-06-30]`
 * and `[2026-07-01, null]` (the seed's own `Discovery Audit` pair) do not
 * overlap, while `[2026-01-01, null]` and `[2026-03-01, null]` do.
 *
 * This is a pre-check, not a translated constraint: `offering_versions` has
 * no `CHECK` and no exclusion constraint SQLite could express, and adding one
 * would be a migration. It runs inside the same `db.transaction()` as the
 * insert it guards, so nothing can slip in between the check and the write.
 *
 * Exported because P3-02 — closing the current version and appending the next
 * — is exactly the caller that needs it, and a second hand-written copy of
 * this predicate is how one of the two ends up exclusive. `excludeVersionId`
 * exists for that caller: an update that re-dates an existing row must not
 * find that row overlapping itself.
 */
export function assertNoOverlappingVersion(
  db: Database.Database,
  offeringId: string,
  effectiveFrom: string | null,
  effectiveTo: string | null,
  excludeVersionId?: string
): void {
  // Two half-open comparisons ANDed: the candidate starts on or before the
  // existing row ends, AND the existing row starts on or before the candidate
  // ends. A NULL on either side of either comparison makes that side
  // unbounded and the comparison vacuously true.
  const clauses = [
    'offering_id = ?',
    '(? IS NULL OR effective_to IS NULL OR ? <= effective_to)',
    '(? IS NULL OR effective_from IS NULL OR effective_from <= ?)'
  ]
  const params: unknown[] = [offeringId, effectiveFrom, effectiveFrom, effectiveTo, effectiveTo]
  if (excludeVersionId !== undefined) {
    clauses.push('id != ?')
    params.push(excludeVersionId)
  }

  const clash = db
    .prepare(`SELECT id, version, effective_from, effective_to FROM offering_versions WHERE ${clauses.join(' AND ')} LIMIT 1`)
    .get(...params) as Pick<OfferingVersionRow, 'id' | 'version' | 'effective_from' | 'effective_to'> | undefined
  if (!clash) return

  throw new RefusalError(
    `This version's effective range (${describeRange(effectiveFrom, effectiveTo)}) overlaps version ` +
      `${clash.version ?? '?'} of the same offering (${describeRange(clash.effective_from, clash.effective_to)}). ` +
      'Close the existing version before the new one starts.',
    { reason: 'version-overlap' }
  )
}

function describeRange(from: string | null, to: string | null): string {
  return `${from ?? 'always'} to ${to ?? 'open-ended'}`
}

/**
 * Inserts one `offering_versions` row, refusing an overlapping range first
 * and deriving the version number rather than taking one from a caller.
 *
 * Deliberately **not** exported, and deliberately not a price-versioning API:
 * P3-02 owns appending a next version, which also has to close the current
 * one, and that is a decision with its own review. What this gives the two
 * callers here (`createOffering`, `duplicateOffering`) is a first version for
 * an offering that has none.
 *
 * `MAX(version) + 1` rather than a hardcoded `1` is this task's answer to its
 * own Risks note: `offering_versions.version` has no per-offering uniqueness
 * constraint and two version 1s are representable in the schema. A `UNIQUE
 * (offering_id, version)` index would be the real fix and is a migration this
 * task does not have, so the guarantee is made where the writes are —
 * deriving the number means this repository cannot produce a duplicate, which
 * is a narrower claim than the schema enforcing it, and an honest one.
 *
 * Callers run this inside their own `db.transaction()`.
 */
function insertOfferingVersion(
  db: Database.Database,
  offeringId: string,
  rateCents: number,
  effectiveFrom: string | null,
  effectiveTo: string | null,
  timestamp: string
): void {
  assertNoOverlappingVersion(db, offeringId, effectiveFrom, effectiveTo)

  const highest = db.prepare('SELECT MAX(version) AS highest FROM offering_versions WHERE offering_id = ?').get(offeringId) as {
    highest: number | null
  }
  const version = (highest.highest ?? 0) + 1

  try {
    db.prepare(
      `INSERT INTO offering_versions (id, offering_id, version, rate_cents, effective_from, effective_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), offeringId, version, rateCents, effectiveFrom, effectiveTo, timestamp, timestamp)
  } catch (error) {
    translateWriteError(VERSION_CONSTRAINT_HANDLERS, error)
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * `sort` is nullable, and plain `ORDER BY sort ASC` sorts SQLite NULLs first,
 * which would lead an unsorted category ahead of every category that has a
 * position. `sort IS NULL` is 0 for a sorted row and 1 for an unsorted one,
 * so ordering by that first pushes NULLs to the end — the same idiom
 * `listMilestones` uses. `name` breaks ties, including among unsorted rows.
 */
export function listOfferingCategories(db: Database.Database): readonly OfferingCategory[] {
  const rows = db
    .prepare('SELECT * FROM offering_categories ORDER BY sort IS NULL, sort ASC, name COLLATE NOCASE')
    .all() as OfferingCategoryRow[]
  return rows.map(mapCategoryRow)
}

/** `null` when no row matches `id` — not an error; callers that need one own the "not found" decision. */
export function getOfferingCategory(db: Database.Database, id: string): OfferingCategory | null {
  const row = getCategoryRow(db, id)
  return row ? mapCategoryRow(row) : null
}

/**
 * Every offering matching `filter`, each with its current version joined on
 * so a list can show a price without a query per row.
 *
 * No filter means every offering, **archived included** — there is no
 * implicit `active = 1`, because the offerings view has to be able to show
 * what was archived in order to offer restoring it, and a default that hides
 * rows is the kind of thing a caller discovers by miscounting.
 *
 * The current version is picked by `VERSION_ORDER` inside a `ROW_NUMBER()`
 * window rather than by a correlated subquery per row: one pass over
 * `offering_versions` regardless of how many offerings match.
 */
export function listOfferings(db: Database.Database, filter: ListOfferingsFilter = {}): readonly OfferingListItem[] {
  const parsed = parseInput(listOfferingsFilterSchema, filter)

  const clauses: string[] = []
  const params: unknown[] = []
  if (parsed.type !== undefined) {
    clauses.push('o.type = ?')
    params.push(parsed.type)
  }
  if (parsed.categoryId !== undefined) {
    clauses.push('o.category_id = ?')
    params.push(parsed.categoryId)
  }
  if (parsed.active !== undefined) {
    clauses.push('o.active = ?')
    params.push(boolToSql(parsed.active))
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''

  const rows = db
    .prepare(
      `SELECT o.*,
              v.id AS v_id,
              v.offering_id AS v_offering_id,
              v.version AS v_version,
              v.rate_cents AS v_rate_cents,
              v.effective_from AS v_effective_from,
              v.effective_to AS v_effective_to,
              v.created_at AS v_created_at,
              v.updated_at AS v_updated_at
       FROM offerings o
       LEFT JOIN (
         SELECT * FROM (
           SELECT *, ROW_NUMBER() OVER (PARTITION BY offering_id ${VERSION_ORDER}) AS rn
           FROM offering_versions
         ) WHERE rn = 1
       ) v ON v.offering_id = o.id
       ${where}
       ORDER BY o.name COLLATE NOCASE`
    )
    .all(...params) as Array<OfferingRow & Record<string, unknown>>

  return rows.map((row) => ({
    ...mapOfferingRow(row),
    currentVersion:
      row.v_id === null || row.v_id === undefined
        ? null
        : mapVersionRow({
            id: row.v_id as string,
            offering_id: row.v_offering_id as string | null,
            version: row.v_version as number | null,
            rate_cents: row.v_rate_cents as number | null,
            effective_from: row.v_effective_from as string | null,
            effective_to: row.v_effective_to as string | null,
            created_at: row.v_created_at as string,
            updated_at: row.v_updated_at as string
          })
  }))
}

/**
 * Every version recorded for `offeringId`, newest first — see
 * `VERSION_ORDER`. Not exported: the history is reached through
 * `getOffering`, which is the read this task's Scope names ("get one offering
 * with its full version history"), and a second public entry point into the
 * same rows is surface P3-02 and T-260901-07 have not asked for.
 */
function listOfferingVersions(db: Database.Database, offeringId: string): readonly OfferingVersion[] {
  const rows = db
    .prepare(`SELECT * FROM offering_versions WHERE offering_id = ? ${VERSION_ORDER}`)
    .all(offeringId) as OfferingVersionRow[]
  return rows.map(mapVersionRow)
}

/**
 * One offering with its full version history. `null` when no row matches
 * `id`, including when the offering is archived — archiving does not hide a
 * row from a read by id, which is what makes an engagement signed against an
 * archived offering still resolvable.
 */
export function getOffering(db: Database.Database, id: string): OfferingWithVersions | null {
  const row = getOfferingRow(db, id)
  if (!row) return null
  return { ...mapOfferingRow(row), versions: [...listOfferingVersions(db, id)] }
}

// ---------------------------------------------------------------------------
// Category writes
// ---------------------------------------------------------------------------

export function createOfferingCategory(db: Database.Database, input: unknown): OfferingCategory {
  const parsed = parseInput(createOfferingCategoryInputSchema, input) as Record<string, unknown>

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const columns = ['id', ...CATEGORY_COLUMNS.map((spec) => spec.column), 'created_at', 'updated_at']
  const values: unknown[] = [id, ...CATEGORY_COLUMNS.map((spec) => (spec.key in parsed ? (parsed[spec.key] ?? null) : null)), timestamp, timestamp]

  try {
    db.prepare(`INSERT INTO offering_categories (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
  } catch (error) {
    translateWriteError(CATEGORY_CONSTRAINT_HANDLERS, error)
  }

  return getOfferingCategory(db, id) as OfferingCategory
}

/** Renaming is the common case; `color` and `sort` move through the same patch. Present means "set it", absent means "leave it". */
export function updateOfferingCategory(db: Database.Database, id: string, patch: unknown): OfferingCategory {
  const parsed = parseInput(updateOfferingCategoryInputSchema, patch) as Record<string, unknown>

  if (!getCategoryRow(db, id)) {
    throw new NotFoundError('Offering category', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  for (const spec of CATEGORY_COLUMNS) {
    // `in`, not a truthiness check: "explicitly set to null" and "not
    // mentioned" are different requests, and `parseInput` has already
    // stripped explicitly-`undefined` keys down to genuinely absent ones.
    if (!(spec.key in parsed)) continue
    setClauses.push(`${spec.column} = ?`)
    values.push(parsed[spec.key] ?? null)
  }

  const timestamp = nowTimestamp()
  setClauses.push('updated_at = ?')
  values.push(timestamp, id)

  try {
    db.prepare(`UPDATE offering_categories SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(CATEGORY_CONSTRAINT_HANDLERS, error)
  }

  return getOfferingCategory(db, id) as OfferingCategory
}

/**
 * Refuses before deleting, in the same transaction as the delete —
 * `referential-guard.ts`'s header makes the point every `deleteX` here
 * repeats: migration 0001 uses `ON DELETE no action`, not `RESTRICT`, so this
 * pre-check is the only thing between a caller and a bare
 * `SQLITE_CONSTRAINT_FOREIGNKEY` with no table, column or row count attached.
 *
 * Exactly one reference can block it — `offerings.category_id`, the only
 * foreign key migration 0001 points at `offering_categories.id`. The refusal
 * names the count and an example, which is P3-01's acceptance and §6.5's
 * rule: a category holding offerings is not deletable, and the operator is
 * told how many are in the way rather than being told "no".
 */
export function deleteOfferingCategory(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    const category = getCategoryRow(db, id)
    if (!category) {
      throw new NotFoundError('Offering category', id)
    }
    const label = category.name ?? id

    refuseIfReferenced(db, id, [
      {
        table: 'offerings',
        column: 'category_id',
        reason: 'offerings',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${label}": ${count} offering${count === 1 ? '' : 's'} ${count === 1 ? 'is' : 'are'} in it` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Move them to another category before deleting this one.'
      }
    ])

    db.prepare('DELETE FROM offering_categories WHERE id = ?').run(id)
  })

  run()
}

// ---------------------------------------------------------------------------
// Offering writes
// ---------------------------------------------------------------------------

/**
 * Creates an offering **and its first version**, in one transaction, so a
 * version-less offering is not representable rather than merely discouraged.
 * A missing `rateCents` never reaches SQL — `createOfferingInputSchema` makes
 * it required, so the call throws a `ValidationError` whose issue path names
 * `rateCents` and no `offerings` row is written. A failure at the version
 * insert (an overlapping range, a constraint) rolls the `offerings` insert
 * back with it.
 *
 * `active` is not a create field: a new offering is active, which is the only
 * thing creating one can mean. Archiving is `archiveOffering`.
 */
export function createOffering(db: Database.Database, input: unknown): OfferingWithVersions {
  const parsed = parseInput(createOfferingInputSchema, input) as Record<string, unknown>

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const run = db.transaction(() => {
    const columns = ['id', ...OFFERING_COLUMNS.map((spec) => spec.column), 'active', 'created_at', 'updated_at']
    const values: unknown[] = [
      id,
      ...OFFERING_COLUMNS.map((spec) => (spec.key in parsed ? (parsed[spec.key] ?? null) : null)),
      boolToSql(true),
      timestamp,
      timestamp
    ]

    try {
      db.prepare(`INSERT INTO offerings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
    } catch (error) {
      translateWriteError(OFFERING_CONSTRAINT_HANDLERS, error)
    }

    insertOfferingVersion(
      db,
      id,
      parsed.rateCents as number,
      (parsed.effectiveFrom as string | undefined) ?? null,
      (parsed.effectiveTo as string | undefined) ?? null,
      timestamp
    )
  })

  run()

  return getOffering(db, id) as OfferingWithVersions
}

/**
 * Updates an offering's non-price fields. `rateCents` is not a key this patch
 * accepts (`updateOfferingInputSchema` is `.strict()`), so a caller that
 * tries to change a price here gets a `ValidationError` naming the
 * unrecognised key rather than a silently ignored field — §6.5 makes changing
 * a price a distinct action, and P3-02 owns it.
 */
export function updateOffering(db: Database.Database, id: string, patch: unknown): OfferingWithVersions {
  const parsed = parseInput(updateOfferingInputSchema, patch) as Record<string, unknown>

  if (!getOfferingRow(db, id)) {
    throw new NotFoundError('Offering', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  for (const spec of OFFERING_COLUMNS) {
    if (!(spec.key in parsed)) continue
    setClauses.push(`${spec.column} = ?`)
    values.push(parsed[spec.key] ?? null)
  }

  const timestamp = nowTimestamp()
  setClauses.push('updated_at = ?')
  values.push(timestamp, id)

  try {
    db.prepare(`UPDATE offerings SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(OFFERING_CONSTRAINT_HANDLERS, error)
  }

  return getOffering(db, id) as OfferingWithVersions
}

/**
 * Sets `active = 0`. **Nothing is deleted, ever** — the row stays readable by
 * id, its versions stay readable, and an engagement's `offering_version_id`
 * still resolves through it. That is the point: a price an engagement was
 * signed against is a historical fact, and removing it would either orphan
 * the engagement or silently rewrite what was agreed.
 *
 * Idempotent: archiving an already-archived offering succeeds and moves only
 * `updated_at`.
 *
 * There is deliberately no `restoreOffering` here. Un-archiving is not in
 * this task's Scope, and the view that would need it (P3-07,
 * T-260901-11) is not built; adding the inverse now would be an untested
 * channel waiting for a caller.
 */
export function archiveOffering(db: Database.Database, id: string): OfferingWithVersions {
  if (!getOfferingRow(db, id)) {
    throw new NotFoundError('Offering', id)
  }
  db.prepare('UPDATE offerings SET active = ?, updated_at = ? WHERE id = ?').run(boolToSql(false), nowTimestamp(), id)
  return getOffering(db, id) as OfferingWithVersions
}

/**
 * Copies an offering into a new one whose first version carries the
 * original's **current** rate (`versions[0]`, per `VERSION_ORDER`) — §6.5's
 * "duplicate", which exists because a catalogue of near-identical retainers
 * is otherwise retyped every time.
 *
 * What is copied: name (with " (copy)" appended unless `overrides.name` says
 * otherwise), type, category, billing model, unit, blurb, and one version at
 * the current rate. What is **not** copied: the version *history*. The new
 * offering starts at version 1 with a single version — the original's older
 * prices are facts about the original, and carrying them over would invent a
 * price history for a thing that has never been sold.
 *
 * The copied version's effective range is deliberately left unbounded
 * (`null`/`null`, "this is the price") rather than inheriting the original's
 * dates, which describe when the *original* was sold at that rate.
 *
 * The original is not read again after the copy and not written at all.
 */
export function duplicateOffering(db: Database.Database, id: string, overrides: unknown = {}): OfferingWithVersions {
  const parsed = parseInput(duplicateOfferingInputSchema, overrides)

  const newId = randomUUID()
  const timestamp = nowTimestamp()

  const run = db.transaction(() => {
    const source = getOfferingRow(db, id)
    if (!source) {
      throw new NotFoundError('Offering', id)
    }

    const current = db
      .prepare(`SELECT * FROM offering_versions WHERE offering_id = ? ${VERSION_ORDER} LIMIT 1`)
      .get(id) as OfferingVersionRow | undefined
    if (!current || current.rate_cents === null) {
      throw new RefusalError(
        `Cannot duplicate "${source.name}": it has no version carrying a rate, and an offering always has at least one. ` +
          'Give the original a rate first.',
        { reason: 'missing-rate' }
      )
    }

    const columns = ['id', 'name', 'type', 'category_id', 'billing_model', 'unit', 'blurb', 'active', 'created_at', 'updated_at']
    const values: unknown[] = [
      newId,
      parsed.name ?? `${source.name} (copy)`,
      source.type,
      source.category_id,
      source.billing_model,
      source.unit,
      source.blurb,
      boolToSql(true),
      timestamp,
      timestamp
    ]

    try {
      db.prepare(`INSERT INTO offerings (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...values)
    } catch (error) {
      translateWriteError(OFFERING_CONSTRAINT_HANDLERS, error)
    }

    insertOfferingVersion(db, newId, current.rate_cents, null, null, timestamp)
  })

  run()

  return getOffering(db, newId) as OfferingWithVersions
}
