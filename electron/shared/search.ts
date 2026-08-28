import { z } from 'zod'

/**
 * `search`'s wire contract (ADR-007's pattern, extended to a read-only
 * repository): pure zod, no Node imports, so this module typechecks under
 * both `tsconfig.node.json` (main + preload) and `tsconfig.web.json`
 * (renderer) exactly like `electron/shared/companies.ts`. There is no
 * create/update input here — `searchAll` is a read — but the same split
 * still holds: the query's wire shape lives here, the SQL and row mapping
 * live in `electron/main/db/repositories/search.ts`, and T-260828-37's IPC
 * channel (out of this task's scope) imports `searchQueryInputSchema`
 * directly rather than redeclaring it, the same way T-260828-26 imports
 * `createCompanyInputSchema`.
 *
 * The five kinds and their order below are fixed by the migration's kind
 * codes (`0002_search_fts.sql`'s header) — `SEARCH_KINDS[n]` names the same
 * source table as kind code `n`. This array is not consulted by the SQL
 * (the codes are baked into the migration's view and triggers), but keeping
 * the two in the same order means a reviewer never has to hold them apart.
 */
export const SEARCH_KINDS = ['company', 'person', 'engagement', 'task', 'activity'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

/** One `search_fts` match: which source table it came from, that row's id, and the text that was indexed. */
export interface SearchResult {
  readonly kind: SearchKind
  readonly id: string
  readonly text: string | null
}

/**
 * `.strict()`, matching every other wire schema in this codebase (ADR-007
 * rule 4's reasoning applied to a read instead of a write): an unknown key
 * crossing the IPC boundary is a caller bug worth surfacing as a
 * `ValidationError`, not something to silently ignore.
 */
export const searchQueryInputSchema = z
  .object({
    query: z.string(),
    /** Caps the row count `searchAll` returns. Omitted = the repository's own default. */
    limit: z.number().int().positive().max(200).optional()
  })
  .strict()
export type SearchQueryInput = z.infer<typeof searchQueryInputSchema>
