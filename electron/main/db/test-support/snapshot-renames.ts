import type { MigrationDefinition } from '../migrations'

/**
 * Reads the renames a set of migrations performs, and replays them over a
 * drizzle-kit snapshot **structurally** — by walking the parsed object and
 * moving only the places an identifier can legitimately appear.
 *
 * Extracted from `schema.test.ts` by T-260829-12 so it can be tested on its
 * own. That test file spawns `drizzle-kit generate` and therefore lives in
 * the serial `runtime-boot-node` pool (vitest.config.ts); a pure function
 * does not belong behind a 60-second child process, and the case worth
 * testing here — a rename whose source is a token that appears everywhere —
 * needs a hand-built fragment rather than the real snapshot.
 *
 * This is test-support, not production code: nothing under `electron/main`
 * imports it at runtime. The runtime applies the checked-in SQL and never
 * reads a snapshot at all.
 *
 * ## Why this replaced a string substitution
 *
 * The first version (T-260829-10) substituted over the snapshot's raw JSON
 * text, longest `from` first, parking each match on a U+0000 sentinel so a
 * rename whose target was another rename's source could not be applied
 * twice. It worked, and the longest-first ordering existed precisely because
 * these identifiers nest: `service_versions` contains `service_version`, and
 * drizzle's own foreign-key names concatenate several of them
 * (`engagements_service_version_id_service_versions_id_fk`).
 *
 * What it could not do is tell an identifier from a coincidence. A future
 * column renamed *from* `name` or `type` would have rewritten every table's
 * `"name"` key and every column's `"type"` — the base would stop matching
 * the checked-in migrations and the drift test would go red somewhere with
 * no relation to the change that broke it. Structurally, `from` is compared
 * with `===` against one field at a time, so a whole-identifier match is not
 * something to arrange: it is the only kind of match there is.
 */

/** A single `ALTER TABLE ... RENAME ...` a migration performs. */
export type SnapshotRename =
  | { kind: 'table'; from: string; to: string }
  | { kind: 'column'; table: string; from: string; to: string }

interface SnapshotForeignKey {
  name: string
  tableFrom: string
  tableTo: string
  columnsFrom: string[]
  columnsTo: string[]
  [key: string]: unknown
}

interface SnapshotColumn {
  name: string
  [key: string]: unknown
}

interface NamedColumnList {
  name: string
  columns: string[]
  [key: string]: unknown
}

interface SnapshotCheckConstraint {
  name: string
  value: string
  [key: string]: unknown
}

interface SnapshotTable {
  name: string
  columns: Record<string, SnapshotColumn>
  indexes?: Record<string, NamedColumnList>
  foreignKeys?: Record<string, SnapshotForeignKey>
  compositePrimaryKeys?: Record<string, { columns: string[]; [key: string]: unknown }>
  uniqueConstraints?: Record<string, NamedColumnList>
  checkConstraints?: Record<string, SnapshotCheckConstraint>
  [key: string]: unknown
}

export interface DrizzleSnapshot {
  tables: Record<string, SnapshotTable>
  [key: string]: unknown
}

/**
 * Every `ALTER TABLE ... RENAME TO ...` / `ALTER TABLE ... RENAME COLUMN ...
 * TO ...` a checked-in migration performs, **in the order the statements
 * appear** — read out of the migrations themselves rather than restated
 * here, so a future rename cannot land in a migration and be forgotten in
 * the test that derives its base from them.
 *
 * Statement order is load-bearing now that renames are applied structurally.
 * 0006 renames `service_versions` to `offering_versions` and then renames a
 * column of the *new* name: `ALTER TABLE offering_versions RENAME COLUMN
 * service_id TO offering_id`. Applied in source order against an evolving
 * snapshot that resolves — the table has already moved by the time the
 * column rename looks it up. Grouped by kind, as this function used to
 * return them, it would look up a table that does not exist yet.
 *
 * Backticks are optional in the patterns because a hand-written migration
 * may quote identifiers the way drizzle-kit does or not at all.
 */
export function renamesInMigrations(migrations: readonly MigrationDefinition[]): SnapshotRename[] {
  const renameTablePattern = /ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+TO\s+`?(\w+)`?/gi
  const renameColumnPattern = /ALTER\s+TABLE\s+`?(\w+)`?\s+RENAME\s+COLUMN\s+`?(\w+)`?\s+TO\s+`?(\w+)`?/gi
  const renames: SnapshotRename[] = []
  for (const migration of migrations) {
    // Both patterns over the same text, then sorted by where they matched.
    // `matchAll` is per-pattern, and interleaving them is what statement
    // order means when the two kinds alternate.
    const found: { at: number; rename: SnapshotRename }[] = []
    renameTablePattern.lastIndex = 0
    for (const match of migration.sql.matchAll(renameTablePattern)) {
      found.push({ at: match.index ?? 0, rename: { kind: 'table', from: match[1], to: match[2] } })
    }
    renameColumnPattern.lastIndex = 0
    for (const match of migration.sql.matchAll(renameColumnPattern)) {
      found.push({ at: match.index ?? 0, rename: { kind: 'column', table: match[1], from: match[2], to: match[3] } })
    }
    found.sort((a, b) => a.at - b.at)
    renames.push(...found.map((entry) => entry.rename))
  }
  return renames
}

/**
 * `name` under the table name it carries once every given rename has run.
 *
 * For lists of table names written against the pre-rename schema — the
 * `EXPECTED_TABLES` guard in `schema.test.ts` derives itself this way rather
 * than restating a rename that is already spelled out in a migration. Whole
 * names only, compared with `===`: `service_versions` is not `services` with
 * a suffix, it is a different table.
 */
export function renamedTableName(name: string, renames: readonly SnapshotRename[]): string {
  let current = name
  for (const rename of renames) {
    if (rename.kind === 'table' && rename.from === current) current = rename.to
  }
  return current
}

/** Drizzle's own name for a foreign key, derived from the parts it joins. */
function conventionalForeignKeyName(fk: SnapshotForeignKey): string {
  return [fk.tableFrom, ...fk.columnsFrom, fk.tableTo, ...fk.columnsTo, 'fk'].join('_')
}

/** Every foreign key in the snapshot, with the table and key that hold it. */
function allForeignKeys(snapshot: DrizzleSnapshot): { table: SnapshotTable; key: string; fk: SnapshotForeignKey }[] {
  const entries: { table: SnapshotTable; key: string; fk: SnapshotForeignKey }[] = []
  for (const table of Object.values(snapshot.tables)) {
    for (const [key, fk] of Object.entries(table.foreignKeys ?? {})) {
      entries.push({ table, key, fk })
    }
  }
  return entries
}

/**
 * Rewrites a quoted identifier inside a check constraint's SQL text.
 *
 * The one place a rename has to reach text rather than structure: drizzle
 * stores a check as the SQL it will emit, e.g.
 * `("companies"."billed_via_company_id" IS NULL OR ...)`. Only the
 * double-quoted form is rewritten, and an *unquoted* whole-word occurrence
 * throws rather than being guessed at — a bare `companies` in a check could
 * be a column, an alias or part of a string literal, and silently rewriting
 * it is the exact failure this module exists to remove. No checked-in check
 * constraint is written that way; if one ever is, this stops at the line
 * that caused it rather than corrupting the base.
 */
function renameInCheckValue(value: string, from: string, to: string): string {
  const unquoted = new RegExp(`(?<!["\\w])${from}(?!["\\w])`)
  if (unquoted.test(value)) {
    throw new Error(
      `Check constraint SQL contains an unquoted \`${from}\`, which this rename cannot resolve ` +
        `structurally: ${value}. Quote the identifier in schema.ts, or handle it here explicitly.`
    )
  }
  return value.split(`"${from}"`).join(`"${to}"`)
}

/** Rebuilds a record, replacing one key in place so insertion order survives. */
function withRenamedKey<T>(record: Record<string, T>, from: string, to: string): Record<string, T> {
  const rebuilt: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    rebuilt[key === from ? to : key] = value
  }
  return rebuilt
}

function renameTableIn(snapshot: DrizzleSnapshot, from: string, to: string): void {
  const table = snapshot.tables[from]
  if (!table) {
    throw new Error(
      `A migration renames table \`${from}\`, which the snapshot does not have. ` +
        `It has: ${Object.keys(snapshot.tables).sort().join(', ')}`
    )
  }
  if (snapshot.tables[to]) {
    throw new Error(`A migration renames table \`${from}\` to \`${to}\`, which the snapshot already has.`)
  }
  snapshot.tables = withRenamedKey(snapshot.tables, from, to)
  table.name = to
  // A rename reaches every foreign key naming the table on either side —
  // including ones held by *other* tables, which is why this walks all of
  // them rather than only the renamed table's own.
  for (const { fk } of allForeignKeys(snapshot)) {
    if (fk.tableFrom === from) fk.tableFrom = to
    if (fk.tableTo === from) fk.tableTo = to
  }
  for (const check of Object.values(table.checkConstraints ?? {})) {
    check.value = renameInCheckValue(check.value, from, to)
  }
}

function renameColumnIn(snapshot: DrizzleSnapshot, tableName: string, from: string, to: string): void {
  const table = snapshot.tables[tableName]
  if (!table) {
    throw new Error(
      `A migration renames \`${tableName}.${from}\`, but the snapshot has no table \`${tableName}\`. ` +
        `When a migration renames the table before the column, these renames must be applied in SQL order.`
    )
  }
  const column = table.columns[from]
  if (!column) {
    throw new Error(
      `A migration renames \`${tableName}.${from}\`, which the snapshot's \`${tableName}\` does not have. ` +
        `It has: ${Object.keys(table.columns).join(', ')}`
    )
  }
  table.columns = withRenamedKey(table.columns, from, to)
  column.name = to
  const swap = (columns: string[]): string[] => columns.map((name) => (name === from ? to : name))
  for (const { fk } of allForeignKeys(snapshot)) {
    if (fk.tableFrom === tableName) fk.columnsFrom = swap(fk.columnsFrom)
    if (fk.tableTo === tableName) fk.columnsTo = swap(fk.columnsTo)
  }
  for (const index of Object.values(table.indexes ?? {})) index.columns = swap(index.columns)
  for (const unique of Object.values(table.uniqueConstraints ?? {})) unique.columns = swap(unique.columns)
  for (const pk of Object.values(table.compositePrimaryKeys ?? {})) pk.columns = swap(pk.columns)
  for (const check of Object.values(table.checkConstraints ?? {})) {
    check.value = renameInCheckValue(check.value, from, to)
  }
}

/**
 * `snapshot` with every rename applied, in the order given, as a new object.
 *
 * Foreign-key names are **recomputed** rather than substituted: drizzle
 * derives them from the parts they join, so once `tableFrom`, `columnsFrom`,
 * `tableTo` and `columnsTo` have moved, the name follows. That is what the
 * old textual version was really doing when it rewrote
 * `engagements_service_version_id_service_versions_id_fk`, and it is the one
 * place a rename genuinely has to reach a compound identifier.
 *
 * A foreign key whose stored name is *not* drizzle's conventional one was
 * named by hand and keeps its name — SQLite's `ALTER TABLE ... RENAME` does
 * not rename constraints either. The same reasoning leaves index, unique and
 * check constraint *names* alone: those are literals a developer writes in
 * `schema.ts`, and renaming a table does not change what they wrote.
 */
export function applyRenames(snapshot: DrizzleSnapshot, renames: readonly SnapshotRename[]): DrizzleSnapshot {
  const next = structuredClone(snapshot)
  // Which foreign keys drizzle named, decided *before* anything moves —
  // afterwards there is no telling a hand-written name from a conventional
  // one that has gone stale.
  const derived = new Map<SnapshotForeignKey, { conventional: boolean; keyWasName: boolean }>()
  for (const { key, fk } of allForeignKeys(next)) {
    derived.set(fk, { conventional: fk.name === conventionalForeignKeyName(fk), keyWasName: key === fk.name })
  }

  for (const rename of renames) {
    if (rename.kind === 'table') renameTableIn(next, rename.from, rename.to)
    else renameColumnIn(next, rename.table, rename.from, rename.to)
  }

  for (const table of Object.values(next.tables)) {
    if (!table.foreignKeys) continue
    const rebuilt: Record<string, SnapshotForeignKey> = {}
    for (const [key, fk] of Object.entries(table.foreignKeys)) {
      const how = derived.get(fk)
      if (how?.conventional) fk.name = conventionalForeignKeyName(fk)
      rebuilt[how?.keyWasName ? fk.name : key] = fk
    }
    table.foreignKeys = rebuilt
  }
  return next
}
