import migration0001Sql from './0001_init.sql?raw'
import migration0002Sql from './0002_search_fts.sql?raw'
import migration0003Sql from './0003_search_content_table.sql?raw'

/**
 * The ordered, explicit manifest of every migration `migrate.ts` knows how
 * to apply. Deliberately a hand-maintained list rather than a runtime
 * directory scan (`readdirSync` against `electron/main/db/migrations`):
 * electron-vite bundles `electron/main/**` into the single file
 * `out/main/index.js` (`package.json`'s `"main"`), so a path resolved at
 * runtime relative to the compiled output would not find sibling `.sql`
 * files that were never copied into `out/`. Importing each file with
 * Vite's `?raw` suffix (see `sql-raw.d.ts`) bundles its text directly into
 * the JS output instead, so there is nothing to copy and nothing that can
 * go missing from a packaged build.
 *
 * The cost is explicitness: a future migration (0002, ...) needs a line
 * here as well as the checked-in `.sql` file drizzle-kit generates. That
 * matches this project's existing preference for a single, greppable place
 * that says what exists (ADR-002 rule 3, about `settings` keys) over a
 * directory listing standing in for one.
 */
export interface MigrationDefinition {
  /** The migration's number, and its schema version once applied. */
  readonly version: number
  /** The migration's file stem, recorded in `schema_migrations.name`. */
  readonly name: string
  /** The migration's full SQL text, applied verbatim inside one transaction. */
  readonly sql: string
}

export const MIGRATIONS: readonly MigrationDefinition[] = [
  { version: 1, name: '0001_init', sql: migration0001Sql },
  // P1-06 (T-260828-36): search_fts and its five triggers. Hand-written SQL,
  // not drizzle-kit output — see the migration file's own header for why.
  { version: 2, name: '0002_search_fts', sql: migration0002Sql },
  // P1-06 (T-260828-51): `search_source` becomes a real table with an
  // INTEGER PRIMARY KEY content_rowid, so FTS5's per-result lookup is a
  // rowid seek instead of a five-table scan. Hand-written for the same
  // reason as 0002. See ADR-009.
  { version: 3, name: '0003_search_content_table', sql: migration0003Sql }
]
