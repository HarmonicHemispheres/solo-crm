import migration0001Sql from './0001_init.sql?raw'
import migration0002Sql from './0002_search_fts.sql?raw'
import migration0003Sql from './0003_search_content_table.sql?raw'
import migration0004Sql from './0004_fk_indexes_polymorphic_cascade.sql?raw'
import migration0005Sql from './0005_branding.sql?raw'
import migration0006Sql from './0006_offerings_rename.sql?raw'
import migration0007Sql from './0007_company_images.sql?raw'
import migration0008Sql from './0008_retainer_basis.sql?raw'
import migration0009Sql from './0009_introduced_by_person.sql?raw'

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
  { version: 3, name: '0003_search_content_table', sql: migration0003Sql },
  // T-260828-41: the foreign-key indexes every delete pre-check needs, and
  // the polymorphic cascade (ADR-011) that stops a delete stranding `links`,
  // `taggings` or `external_refs` rows. The index half is drizzle-kit output
  // diffed against 0001's snapshot; the trigger half is hand-written, because
  // no schema-diffing tool expresses a cascade whose parent table is chosen
  // by a string column.
  { version: 4, name: '0004_fk_indexes_polymorphic_cascade', sql: migration0004Sql },
  // T-260829-04: the `branding` table — the operator's own icon and wordmark
  // for the rail, two rows at most, keyed by slot under ADR-002's
  // natural-identity exemption (ADR-012). Declared in `schema.ts`, so
  // `schema.test.ts`'s regeneration check sees it in the delta and asserts it
  // matches this file rather than treating it as drift.
  { version: 5, name: '0005_branding', sql: migration0005Sql },
  // T-260829-10: the catalogue's three tables and the two columns naming them
  // become `offering_categories` / `offerings` / `offering_versions` /
  // `offering_versions.offering_id` / `engagements.offering_version_id`, so the
  // schema says what the rail says (T-260829-09). Hand-written `ALTER TABLE
  // ... RENAME`, not drizzle-kit output: drizzle-kit reads a rename as a drop
  // and a create, which would discard every row. `schema.test.ts` asserts the
  // regenerated delta against this file all the same.
  { version: 6, name: '0006_offerings_rename', sql: migration0006Sql },
  // T-260901-08: the `company_images` table — one company's operator-supplied
  // logo and banner, each stored beside a downscaled derivative that is the
  // only rendition a list ever reads (ADR-015). Declared in `schema.ts`, so
  // `schema.test.ts`'s regeneration check sees the table and its unique index
  // in the delta and asserts they match this file rather than treating them as
  // drift. Its foreign key is the schema's first `ON DELETE cascade`.
  { version: 7, name: '0007_company_images', sql: migration0007Sql },
  // T-260902-08: `engagements.retainer_basis` and `.monthly_amount_cents` —
  // a retainer states whether it is a flat monthly fee or hours at a rate,
  // and carries the fee when it is the former. Declared in `schema.ts`, so
  // `schema.test.ts`'s regeneration check sees both columns in the delta and
  // asserts they match this file rather than treating them as drift. See the
  // migration's own header for why the basis is a stored column and not
  // inferred from which of the amount/hours columns happen to be filled.
  { version: 8, name: '0008_retainer_basis', sql: migration0008Sql },
  // `companies.introduced_by_person_id` and its index: an introduction is
  // made by a person, and the old company-valued column is retired in place
  // rather than dropped. See the migration's own header.
  { version: 9, name: '0009_introduced_by_person', sql: migration0009Sql }
]
