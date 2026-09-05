import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
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
import { NotFoundError, RefusalError } from './errors'
import { boolToSql, parseInput } from './input'
import type { DeletionImpact } from '../../../shared/deletion'
import { impactOf, runCascade } from './cascade'
import { refuseIfReferenced } from './referential-guard'
import { type ConstraintHandler, PRIMARY_KEY_HANDLER, translateWriteError } from './sqlite-errors'

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
// SQLite constraint translation — the machinery (`translateWriteError`, the
// generic handlers) lives in sqlite-errors.ts; only the per-table maps below,
// scoped to the constraints these two tables can actually raise, are local.
// ---------------------------------------------------------------------------

/** `people` declares no `CHECK` or `UNIQUE` constraint (migration 0001) — only a primary-key collision is reachable. */
const PERSON_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
}

/** `affiliations` declares two foreign keys (`person_id`, `company_id`) and no `CHECK`/`UNIQUE` (migration 0001). */
const AFFILIATION_CONSTRAINT_HANDLERS: Record<string, ConstraintHandler> = {
  SQLITE_CONSTRAINT_FOREIGNKEY: () =>
    new RefusalError('This affiliation references a person or company that does not exist.', { reason: 'foreign-key' }),
  SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
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
/**
 * `cascade` is the operator's second, explicit confirmation (T-260902-09):
 * they were shown exactly what would go — `personDeleteImpact` below, which
 * derives its counts from the same declarations `runCascade` deletes by —
 * and said yes. It defaults to false, so every caller that does not opt in
 * keeps the refusing behaviour this function has always had.
 */

/**
 * What deleting this person would take with it — the counts the renderer's
 * confirmation shows before it asks again with `cascade: true`
 * (T-260902-09). Read-only, and derived from the same step declarations
 * `runCascade` deletes by, so the dialog cannot promise one thing and the
 * delete do another (`cascade.ts`'s header).
 */
export function personDeleteImpact(db: Database.Database, id: string): DeletionImpact {
  const row = getPersonRow(db, id)
  if (!row) {
    throw new NotFoundError('Person', id)
  }
  return impactOf(db, 'person', id, row.name)
}

export function deletePerson(db: Database.Database, id: string, cascade = false): void {
  const run = db.transaction(() => {
    const person = getPersonRow(db, id)
    if (!person) {
      throw new NotFoundError('Person', id)
    }

    if (cascade) {
      runCascade(db, 'person', id)
      return
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
      // `companies.introduced_by_person_id` (migration 0009). The route this
      // names exists: the company sheet's "Introduced by" picker has a
      // "— none —" option.
      {
        table: 'companies',
        column: 'introduced_by_person_id',
        reason: 'introduced-by',
        exampleColumn: 'name',
        describe: (count, example) =>
          `Cannot delete "${person.name}": they introduced ${count} compan${count === 1 ? 'y' : 'ies'}` +
          (example ? ` (e.g. "${example}")` : '') +
          '. Clear "Introduced by" on those companies before deleting this person.'
      },
      {
        table: 'affiliations',
        column: 'person_id',
        reason: 'affiliations',
        // The route this sentence names is `deleteAffiliation` below, which
        // exists (T-260828-46). Until it did, this message sent an operator
        // looking for a control nobody had built — the refusal was honest
        // about *why* and dishonest about *what to do next*. Never reword
        // this to promise a route without checking the route exists.
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
// Recorded outside this comment as ADR-010 (T-260828-46): §5 says only
// `is_primary boolean`, and the acceptance criterion this was built against
// reads equally well per-person, so the choice below is a decision, not a
// reading of the spec. T-260828-31 (person detail) and T-260828-26 (the IPC
// contract) both consume it. `people.test.ts`'s "is_primary is scoped to the
// company, not the person (ADR-010)" case fails if the per-person reading is
// ever implemented instead.
//
// A person's "current job" is already `ended IS NULL`; a second flag scoped
// to the person would only re-derive that. What is_primary answers instead
// is a real, separate question a company can have several open affiliations
// for at once (a board, several contacts at one client): which one is the
// main point of contact. So setting isPrimary on one affiliation clears it
// on every *other* affiliation at the same company — not the same person —
// in the same transaction. Scoped further to `ended IS NULL`: a closed
// affiliation is history, exactly like which company someone used to work
// for, and naming a new primary contact must not rewrite who was primary
// during a stint that already ended.
// ---------------------------------------------------------------------------

function clearOtherPrimaries(db: Database.Database, companyId: string, exceptId: string, timestamp: string): void {
  db.prepare(
    'UPDATE affiliations SET is_primary = 0, updated_at = ? WHERE company_id = ? AND id != ? AND is_primary = 1 AND ended IS NULL'
  ).run(timestamp, companyId, exceptId)
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

/**
 * The explicit correction verb for a stint's dates (T-260828-46, scope item
 * 3). Two edges that used to be unstated and untested are decided here:
 *
 * - `{ ended: <a date> }` on an **already-ended** affiliation overwrites the
 *   old `ended`. That is deliberate: a mistyped leaving date has no other
 *   way out, and this function is the place a caller says "I mean to change
 *   this date" in so many words. `endAffiliation` — the verb that reads as
 *   "close this stint", not "correct this date" — refuses that same write
 *   instead; see its own comment.
 * - `{ ended: null }` **reopens** a closed stint, for the same reason: an
 *   affiliation ended by accident (or by a `movePerson` that should not have
 *   run) is otherwise stuck closed forever. Reopening leaves `started`
 *   alone, so no history is lost, and the row rejoins the `ended IS NULL`
 *   set that `getPerson`'s `current` flag and `clearOtherPrimaries` read.
 *
 * Neither is a silent overwrite of history: `personId`/`companyId` remain
 * unpatchable (the schema rejects them), so the one fact §5 built this table
 * to keep — which company, from when — cannot be rewritten through here.
 */
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

/**
 * Convenience wrapper over `updateAffiliation` that only ever touches
 * `ended` — and, since T-260828-46, refuses on an affiliation that is
 * already closed rather than silently overwriting the date it closed on.
 *
 * Probing a real database found this verb turning a 2021 leaving date into a
 * 2023 one with no signal at all. "End this stint" applied to a stint that
 * already ended is far more often a stale id or a double-submit than an
 * intended correction, and the two are indistinguishable once the old value
 * is gone. Correcting the date is `updateAffiliation({ ended })`, which the
 * refusal names; reopening is `updateAffiliation({ ended: null })`.
 */
export function endAffiliation(db: Database.Database, id: string, endedOn: unknown): Affiliation {
  const parsedEndedOn = parseInput(endAffiliationInputSchema, endedOn)

  const existing = getAffiliationRow(db, id)
  if (!existing) {
    throw new NotFoundError('Affiliation', id)
  }
  if (existing.ended !== null) {
    throw new RefusalError(
      `This affiliation already ended on ${existing.ended}. ` +
        'Use updateAffiliation to change that date deliberately, or to reopen the stint with ended: null.',
      { reason: 'already-ended' }
    )
  }

  return updateAffiliation(db, id, { ended: parsedEndedOn })
}

/**
 * The one way an affiliation row leaves the database (T-260828-46) — and the
 * route `deletePerson`'s and `deleteCompany`'s refusal messages name. Before
 * it existed, a person or company that had ever been referenced by an
 * affiliation was permanently undeletable, because no caller had any way to
 * satisfy the refusal.
 *
 * This is for the affiliation that should never have existed: a typo, a row
 * attached to the wrong person, a duplicate. It is deliberately **not** how
 * a finished stint is recorded — that is `endAffiliation`, which keeps the
 * row and stamps `ended`, and `movePerson`, which closes the old stint
 * rather than replacing it. Deleting a real stint erases the fact that
 * someone worked somewhere, which is the history §5 gave affiliations their
 * own table to keep. The repository cannot tell a typo from a stint, so the
 * choice stays with the caller and this function does exactly what it is
 * asked, nothing more.
 *
 * No cascade in either direction, on purpose. Nothing in migration 0001 has
 * a foreign key pointing at `affiliations.id`, so there is no blocker list
 * to run; and `deletePerson`/`deleteCompany` still refuse rather than
 * sweeping affiliations away on the caller's behalf — every erased stint is
 * an explicit call to this function, one row at a time.
 */
export function deleteAffiliation(db: Database.Database, id: string): void {
  const run = db.transaction(() => {
    if (!getAffiliationRow(db, id)) {
      throw new NotFoundError('Affiliation', id)
    }
    db.prepare('DELETE FROM affiliations WHERE id = ?').run(id)
  })

  run()
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
