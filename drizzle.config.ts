import { defineConfig } from 'drizzle-kit'

/**
 * Dev-tool config for `drizzle-kit generate` only — this project does not use
 * `drizzle-kit push` or `drizzle-kit migrate`: `electron/main/db/migrate.ts`
 * is the runtime migration runner (T-260828-07), hand-written so it can
 * write timestamps with `nowTimestamp()` (CONVENTIONS.md) instead of
 * drizzle-kit's own epoch-based `__drizzle_migrations` bookkeeping, wrap
 * each migration in its own transaction, and expose a schema version shaped
 * for X-01. `drizzle-kit generate` only turns `schema.ts` into the checked-in
 * SQL under `electron/main/db/migrations/`; nothing in this repo runs
 * `drizzle-kit migrate` against a real database.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './electron/main/db/schema.ts',
  out: './electron/main/db/migrations'
})
