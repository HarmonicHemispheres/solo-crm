import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { nowTimestamp } from '../../../shared/format'
import {
  type Affiliation,
  type CreateAffiliationInput,
  createAffiliationInputSchema,
  type CreatePersonInput,
  createPersonInputSchema,
  type EndAffiliationInput,
  endAffiliationInputSchema,
  type MovePersonOptions,
  movePersonOptionsSchema,
  type Person,
  type PersonAffiliation,
  type PersonWithAffiliations,
  type UpdateAffiliationInput,
  updateAffiliationInputSchema,
  type UpdatePersonInput,
  updatePersonInputSchema
} from '../../../shared/people'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import { refuseIfReferenced } from './referential-guard'

/**
 * The `people` + `affiliations` repository (T-260828-21) — copies
 * T-260828-20's `companies.ts` pattern (raw `db.prepare(...).run(...)`, not
 * `drizzle-orm`'s query builder; ids and timestamps assigned in JS, never a
 * SQL-side default; `.strict()` schemas; undefined-valued keys stripped
 * after parse; referential refusals as data run inside the same transaction
 * as the delete).
 *
 * The one thing this file does that `companies.ts` does not: `affiliations`
 * is history, not a foreign key. §5's modelling note — restated in this
 * task's Why — is that `company_id` does not live on `people`, because a
 * person's employer changes and every prior stint still matters. The
 * consequence for this file is `movePerson`: closing the currently open
 * affiliation(s) and opening a new one, in one transaction, rather than
 * `UPDATE affiliations SET company_id = ?` on the existing row. The latter
 * is the exact failure this task's Risks section names — it leaves the
 * schema looking right (the person is "at" the new company) while quietly
 * discarding which company they used to be at and when they left.
 *
 * `Person`, `Affiliation` and the create/update zod schemas live in
 * `electron/shared/people.ts` (ADR-007), not here, for the same reason
 * `companies.ts` re-exports rather than redeclares them: this file is the
 * only thing downstream call sites (tests, eventually T-260828-26's IPC
 * layer) need to import.
 */
export {
  createAffiliationInputSchema,
  createPersonInputSchema,
  endAffiliationInputSchema,
  movePersonOptionsSchema,
  updateAffiliationInputSchema,
  updatePersonInputSchema
}
export type {
  Affiliation,
  CreateAffiliationInput,
  CreatePersonInput,
  EndAffiliationInput,
  MovePersonOptions,
  Person,
  PersonAffiliation,
  PersonWithAffiliations,
  UpdateAffiliationInput,
  UpdatePersonInput
}

// ---------------------------------------------------------------------------
// Input parsing — identical discipline to companies.ts's parseInput; see that
// file's comment for why undefined-valued keys must be stripped after parse
// rather than left for zod's `.partial()` to keep them present-but-undefined.
// ---------------------------------------------------------------------------

function parseInput<Schema extends z.ZodType>(schema: Schema, input: unknown): z.infer<Schema> {
  const result = schema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')
    throw new ValidationError(message, result.error.issues)
  }
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
// SQLite constraint translation — same shape as companies.ts's, scoped to
// the constraints these two tables can actually raise.
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

type ConstraintHandler = (error: SqliteConstraintError) => RefusalError

/** `people` declares no `CHECK` or `UNIQUE` constraint (migration 0001) — only a primary-key collision is reachable. */
const PERSON_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_PRIMARYKEY: () => new RefusalError('This id is already in use.', { reason: 'primary-key' })
}

/** `affiliations` declares two foreign keys (`person_id`, `company_id`) and no `CHECK`/`UNIQUE` (migration 0001). */
const AFFILIATION_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This affiliation references a person or company that does not exist.', { reason: 'foreign-key' }),
  SQLITE_CONSTRAINT_PRIMARYKEY: () => new RefusalError('This id is already in use.', { reason: 'primary-key' })
}

function translateWriteError(handlers: Record<string, ConstraintHandler>, error: unknown): never {
  if (isSqliteConstraintError(error)) {
    const handler = handlers[error.code]
    if (handler) throw handler(error)
    throw new RefusalError('This write violates a database constraint.', { reason: 'constraint' })
  }
  throw error
}

// ---------------------------------------------------------------------------
// people: row <-> domain mapping
// ---------------------------------------------------------------------------

interface PersonRow {
  readonly id: string
  readonly name: string
  readonly email: string | null
  readonly phone: string | null
  readonly notes: string | null
  readonly last_contact_at: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapPersonRow(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    lastContactAt: row.last_contact_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getPersonRow(db: Database.Database, id: string): PersonRow | undefined {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(id) as PersonRow | undefined
}

type PersonWritableKey = keyof CreatePersonInput

const PERSON_COLUMNS: readonly { readonly key: PersonWritableKey; readonly column: string }[] = [
  { key: 'name', column: 'name' },
  { key: 'email', column: 'email' },
  { key: 'phone', column: 'phone' },
  { key: 'notes', column: 'notes' }
]

// ---------------------------------------------------------------------------
// people: reads
// ---------------------------------------------------------------------------

export function listPeople(db: Database.Database): readonly Person[] {
  const rows = db.prepare('SELECT * FROM people ORDER BY name COLLATE NOCASE').all() as PersonRow[]
  return rows.map(mapPersonRow)
}

/**
 * `null` when no row matches `id` — not an error; callers that need one own
 * the "not found" decision, same as `companies.ts`'s `getCompany`.
 *
 * Unlike `getCompany`, this also loads every affiliation the person has ever
 * had (`listAffiliationsForPerson`, ordered `started` ascending) and marks
 * each with `current` — the Scope requirement that a caller never has to
 * infer "historical" from an `ended === null` check it might get backwards.
 */
export function getPerson(db: Database.Database, id: string): PersonWithAffiliations | null {
  const row = getPersonRow(db, id)
  if (!row) return null

  const affiliations: readonly PersonAffiliation[] = listAffiliationsForPerson(db, id).map((affiliation) => ({
    ...affiliation,
    current: affiliation.ended === null
  }))

  return { ...mapPersonRow(row), affiliations }
}

// ---------------------------------------------------------------------------
// people: writes
// ---------------------------------------------------------------------------

export function createPerson(db: Database.Database, input: unknown): Person {
  const parsed = parseInput(createPersonInputSchema, input)

  const id = randomUUID()
  const timestamp = nowTimestamp()

  const columns = ['id', ...PERSON_COLUMNS.map((spec) => spec.column), 'created_at', 'updated_at']
  const placeholders = columns.map(() => '?').join(', ')
  const values: unknown[] = [id]
  for (const spec of PERSON_COLUMNS) {
    values.push(spec.key in parsed ? parsed[spec.key] : null)
  }
  values.push(timestamp, timestamp)

  try {
    db.prepare(`INSERT INTO people (${columns.join(', ')}) VALUES (${placeholders})`).run(...values)
  } catch (error) {
    translateWriteError(PERSON_CONSTRAINT_HANDLERS, error)
  }

  // Guaranteed to exist: this connection just inserted it and nothing here
  // is concurrent (better-sqlite3 is synchronous, single connection).
  return mapPersonRow(getPersonRow(db, id) as PersonRow)
}

export function updatePerson(db: Database.Database, id: string, patch: unknown): Person {
  const parsed = parseInput(updatePersonInputSchema, patch)

  if (!getPersonRow(db, id)) {
    throw new NotFoundError('Person', id)
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  for (const spec of PERSON_COLUMNS) {
    // `in`, not a truthiness/undefined check — distinguishes "explicitly set
    // to null" from "not mentioned", the same distinction companies.ts's
    // updateCompany draws, now that parseInput has stripped
    // explicitly-undefined keys down to genuinely absent ones.
    if (!(spec.key in parsed)) continue
    setClauses.push(`${spec.column} = ?`)
    values.push(parsed[spec.key])
  }

  const timestamp = nowTimestamp()
  setClauses.push('updated_at = ?')
  values.push(timestamp)
  values.push(id)

  try {
    db.prepare(`UPDATE people SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
  } catch (error) {
    translateWriteError(PERSON_CONSTRAINT_HANDLERS, error)
  }

  return mapPersonRow(getPersonRow(db, id) as PersonRow)
}

/**
 * Refuses before deleting, in the same transaction as the delete — migration
 * 0001 declares every foreign key `ON DELETE no action`, not `RESTRICT`
 * (see `referential-guard.ts`'s header), so this pre-check is the only thing
 * standing between a caller and a bare `SQLITE_CONSTRAINT_FOREIGNKEY`.
 *
 * Three references can block a person delete — every foreign key migration
 * 0001 points at `people.id`: `activity.person_id`, `affiliations.person_id`
 * and `tasks.person_id`. (`people` itself has no self-referencing column,
 * unlike `companies`.)
 */
export function deletePerson(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    const person = getPersonRow(db, id)
    if (!person) {
      throw new NotFoundError('Person', id)
    }

    refuseIfReferenced(db, id, [
      {
        table: 'activity',
        column: 'person_id',
        reason: 'activity',
        describe: (count) =>
          `Cannot delete "${person.name}": ${count} activity record${count === 1 ? '' : 's'} reference them. ` +
          'Activity is append-only (G8) and cannot be reassigned or removed to make room.'
      },
      {
        table: 'affiliations',
        column: 'person_id',
        reason: 'affiliations',
        describe: (count) =>
          `Cannot delete "${person.name}": ${count} affiliation${count === 1 ? '' : 's'} reference them. ` +
          'Remove those affiliations before deleting this person.'
      },
      {
        table: 'tasks',
        column: 'person_id',
        reason: 'tasks',
        exampleColumn: 'title',
        describe: (count, example) =>
          `Cannot delete "${person.name}": ${count} task${count === 1 ? '' : 's'} reference them` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Reassign or remove those tasks before deleting this person.'
      }
    ])

    db.prepare('DELETE FROM people WHERE id = ?').run(id)
  })

  run()
}

// ---------------------------------------------------------------------------
// affiliations: row <-> domain mapping
// ---------------------------------------------------------------------------

interface AffiliationRow {
  readonly id: string
  readonly person_id: string
  readonly company_id: string
  readonly title: string | null
  readonly is_primary: number | null
  readonly started: string
  readonly ended: string | null
  readonly created_at: string
  readonly updated_at: string
}

function mapAffiliationRow(row: AffiliationRow): Affiliation {
  return {
    id: row.id,
    personId: row.person_id,
    companyId: row.company_id,
    title: row.title,
    isPrimary: row.is_primary === null ? null : row.is_primary === 1,
    started: row.started,
    ended: row.ended,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function getAffiliationRow(db: Database.Database, id: string): AffiliationRow | undefined {
  return db.prepare('SELECT * FROM affiliations WHERE id = ?').get(id) as AffiliationRow | undefined
}

const boolToSql = (value: unknown): unknown => (value === null || value === undefined ? null : value ? 1 : 0)

// ---------------------------------------------------------------------------
// affiliations: reads
// ---------------------------------------------------------------------------

/** Every affiliation `personId` has ever had, oldest stint first. */
export function listAffiliationsForPerson(db: Database.Database, personId: string): readonly Affiliation[] {
  const rows = db
    .prepare('SELECT * FROM affiliations WHERE person_id = ? ORDER BY started ASC, created_at ASC')
    .all(personId) as AffiliationRow[]
  return rows.map(mapAffiliationRow)
}

/** Every affiliation `companyId` has ever had, oldest stint first. */
export function listAffiliationsForCompany(db: Database.Database, companyId: string): readonly Affiliation[] {
  const rows = db
    .prepare('SELECT * FROM affiliations WHERE company_id = ? ORDER BY started ASC, created_at ASC')
    .all(companyId) as AffiliationRow[]
  return rows.map(mapAffiliationRow)
}

// ---------------------------------------------------------------------------
// affiliations: is_primary — scoped to the company, not the person
//
// A person's "current job" is already `ended IS NULL`; a second flag scoped
// to the person would only re-derive that. What is_primary answers instead
// is a real, separate question a company can have several open affiliations
// for at once (a board, several contacts at one client): which one is the
// main point of contact. So setting isPrimary on one affiliation clears it
// on every *other* affiliation at the same company — not the same person —
// in the same transaction.
// ---------------------------------------------------------------------------

function clearOtherPrimaries(db: Database.Database, companyId: string, exceptId: string, timestamp: string): void {
  db.prepare('UPDATE affiliations SET is_primary = 0, updated_at = ? WHERE company_id = ? AND id != ? AND is_primary = 1').run(
    timestamp,
    companyId,
    exceptId
  )
}

/**
 * Nothing in the DDL stops `ended` preceding `started` (this task's Risks) —
 * validated here, at the one place both values are known, rather than as a
 * zod `.refine()` on the input schema, because `updateAffiliation` and
 * `endAffiliation` each may see only one of the two values in their own
 * input and must merge it against the row already in the database.
 */
function assertEndedNotBeforeStarted(started: string, ended: string | null): void {
  if (ended !== null && ended < started) {
    throw new RefusalError(`endedOn (${ended}) cannot be before this affiliation started (${started}).`, {
      reason: 'ended-before-started'
    })
  }
}

// ---------------------------------------------------------------------------
// affiliations: writes
// ---------------------------------------------------------------------------

export function addAffiliation(db: Database.Database, input: unknown): Affiliation {
  const parsed = parseInput(createAffiliationInputSchema, input)
  assertEndedNotBeforeStarted(parsed.started, parsed.ended ?? null)

  const id = randomUUID()
  const timestamp = nowTimestamp()
  // Absent -> false (the natural "not primary unless said so" default).
  // Explicit `null`/`true`/`false` from the caller is honoured as-is — same
  // "in, not ??" distinction companies.ts's CREATE_DEFAULTS draws.
  const isPrimary: boolean | null = 'isPrimary' in parsed ? (parsed.isPrimary ?? null) : false

  const run = db.transaction(() => {
    try {
      db.prepare(
        `INSERT INTO affiliations (id, person_id, company_id, title, is_primary, started, ended, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        parsed.personId,
        parsed.companyId,
        parsed.title ?? null,
        boolToSql(isPrimary),
        parsed.started,
        parsed.ended ?? null,
        timestamp,
        timestamp
      )
    } catch (error) {
      translateWriteError(AFFILIATION_CONSTRAINT_HANDLERS, error)
    }

    if (isPrimary === true) {
      clearOtherPrimaries(db, parsed.companyId, id, timestamp)
    }

    return getAffiliationRow(db, id) as AffiliationRow
  })

  return mapAffiliationRow(run())
}

export function updateAffiliation(db: Database.Database, id: string, patch: unknown): Affiliation {
  const parsed = parseInput(updateAffiliationInputSchema, patch)

  const existing = getAffiliationRow(db, id)
  if (!existing) {
    throw new NotFoundError('Affiliation', id)
  }

  const effectiveStarted = 'started' in parsed ? (parsed.started as string) : existing.started
  const effectiveEnded = 'ended' in parsed ? ((parsed.ended ?? null) as string | null) : existing.ended
  assertEndedNotBeforeStarted(effectiveStarted, effectiveEnded)

  const run = db.transaction(() => {
    const setClauses: string[] = []
    const values: unknown[] = []

    if ('title' in parsed) {
      setClauses.push('title = ?')
      values.push(parsed.title)
    }
    if ('isPrimary' in parsed) {
      setClauses.push('is_primary = ?')
      values.push(boolToSql(parsed.isPrimary))
    }
    if ('started' in parsed) {
      setClauses.push('started = ?')
      values.push(parsed.started)
    }
    if ('ended' in parsed) {
      setClauses.push('ended = ?')
      values.push(parsed.ended)
    }

    const timestamp = nowTimestamp()
    setClauses.push('updated_at = ?')
    values.push(timestamp)
    values.push(id)

    try {
      db.prepare(`UPDATE affiliations SET ${setClauses.join(', ')} WHERE id = ?`).run(...values)
    } catch (error) {
      translateWriteError(AFFILIATION_CONSTRAINT_HANDLERS, error)
    }

    if (parsed.isPrimary === true) {
      clearOtherPrimaries(db, existing.company_id, id, timestamp)
    }

    return getAffiliationRow(db, id) as AffiliationRow
  })

  return mapAffiliationRow(run())
}

/** Convenience wrapper over `updateAffiliation` that only ever touches `ended`. */
export function endAffiliation(db: Database.Database, id: string, endedOn: unknown): Affiliation {
  const parsedEndedOn = parseInput(endAffiliationInputSchema, endedOn)
  return updateAffiliation(db, id, { ended: parsedEndedOn })
}

/**
 * The one transaction this task exists to get right (this task's Why and
 * Risks): stamps `ended` on every affiliation `personId` currently has open
 * (`ended IS NULL`) and inserts one new open affiliation at `toCompanyId`,
 * dated `on`. Either both halves land or neither does — a throw from either
 * half (a bad `toCompanyId`, an `on` date before some open affiliation's
 * `started`) rolls back the whole transaction via better-sqlite3's
 * `db.transaction()`, which is what makes "forcing a failure on the insert
 * half leaves the old affiliation still open" true without any manual
 * rollback code here.
 *
 * Deliberately never `UPDATE affiliations SET company_id = ?` on the
 * existing row — that is the move-as-update shortcut this task's Risks
 * section forbids: it would erase which company the person used to be at
 * and when they left, the exact history §5's modelling note exists to keep.
 */
export function movePerson(db: Database.Database, personId: string, toCompanyId: string, options: unknown): Affiliation {
  const parsed = parseInput(movePersonOptionsSchema, options)

  const run = db.transaction(() => {
    if (!getPersonRow(db, personId)) {
      throw new NotFoundError('Person', personId)
    }

    const openRows = db.prepare('SELECT * FROM affiliations WHERE person_id = ? AND ended IS NULL').all(personId) as AffiliationRow[]
    const timestamp = nowTimestamp()

    for (const row of openRows) {
      assertEndedNotBeforeStarted(row.started, parsed.on)
      db.prepare('UPDATE affiliations SET ended = ?, updated_at = ? WHERE id = ?').run(parsed.on, timestamp, row.id)
    }

    const newId = randomUUID()
    const isPrimary: boolean | null = 'isPrimary' in parsed ? (parsed.isPrimary ?? null) : false
    try {
      db.prepare(
        `INSERT INTO affiliations (id, person_id, company_id, title, is_primary, started, ended, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(newId, personId, toCompanyId, parsed.title ?? null, boolToSql(isPrimary), parsed.on, null, timestamp, timestamp)
    } catch (error) {
      translateWriteError(AFFILIATION_CONSTRAINT_HANDLERS, error)
    }

    if (isPrimary === true) {
      clearOtherPrimaries(db, toCompanyId, newId, timestamp)
    }

    return getAffiliationRow(db, newId) as AffiliationRow
  })

  return mapAffiliationRow(run())
}
