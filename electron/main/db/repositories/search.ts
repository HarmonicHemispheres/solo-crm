import type Database from 'better-sqlite3'
import { type SearchKind, type SearchResult, searchQueryInputSchema } from '../../../shared/search'
import { parseInput } from './input'

/**
 * The `search` repository (T-260828-36 / P1-06) — reads `search_fts`, the
 * external-content FTS5 index `0002_search_fts.sql` creates and keeps in
 * sync via triggers on `companies`, `people`, `engagements`, `tasks` and
 * `activity`. That migration's own header carries the full design rationale
 * (why a view stands in for a single `content=` table, the rowid encoding,
 * why `AFTER UPDATE` is delete-then-insert); this module only ever reads
 * `search_fts` — it is not one of that migration's five trigger-driven
 * writers, `rebuildSearchIndex` below excepted.
 *
 * `SearchKind`, `SearchResult` and `searchQueryInputSchema` live in
 * `electron/shared/search.ts` (ADR-007's split, extended from an
 * entity-with-writes to a read-only repository) — see that module's header.
 * Re-exported here so nothing downstream of *this* module needs to know the
 * split happened.
 *
 * No `translateWriteError` handler map here: `searchAll` validates one flat,
 * non-partial schema through the shared `parseInput` (`input.ts`,
 * T-260828-43), and `rebuildSearchIndex` has no user input to translate a
 * constraint error for.
 *
 * `searchAll` takes one `input: unknown` argument — `{ query, limit? }` —
 * validated whole against `searchQueryInputSchema`, the same shape
 * `createCompany(db, input: unknown)` takes rather than separate positional
 * arguments: the query and its limit cross the IPC boundary as one
 * structured-clone object (T-260828-37's future request payload, per
 * ADR-007 rule 5), so they are validated as one.
 */
export { SEARCH_KINDS, searchQueryInputSchema } from '../../../shared/search'
export type { SearchKind, SearchQueryInput, SearchResult } from '../../../shared/search'

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

function parseQueryInput(input: unknown): { readonly query: string; readonly limit?: number } {
  return parseInput(searchQueryInputSchema, input)
}

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/** Rows `searchAll` returns with no `limit` in `input`. */
export const DEFAULT_SEARCH_LIMIT = 25

/**
 * Turns a caller's free-text `query` into an FTS5 `MATCH` argument, or
 * `null` if it has no searchable content (empty string, whitespace only, or
 * punctuation only — the acceptance criterion "a query matching nothing
 * returns an empty list, not an error" covers this exact input, and an empty
 * `MATCH` string is itself an FTS5 syntax error rather than a zero-row
 * result, so `searchAll` short-circuits before ever preparing a statement).
 *
 * Every token is extracted with a Unicode-aware "letters and digits" split —
 * discarding everything else, including every character FTS5's own query
 * grammar treats specially (`"`, `*`, `:`, `-`, parentheses, `OR`/`NOT`) —
 * and rebuilt as a double-quoted phrase-prefix (`"acme"*`), so nothing a
 * caller types can ever be interpreted as FTS5 query syntax rather than
 * literal search text. Multiple tokens are space-joined, which FTS5 treats
 * as an implicit `AND`: "acme corp" only matches a row containing a term
 * starting with "acme" *and* a term starting with "corp". This is the
 * prefix matching §6.9 asks for (this task's Out: the UI itself is
 * T-260828-37's, not built here).
 */
function buildMatchQuery(query: string): string | null {
  const tokens = query.match(/[\p{L}\p{N}]+/gu)
  if (!tokens || tokens.length === 0) return null
  return tokens.map((token) => `"${token}"*`).join(' ')
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

interface SearchRow {
  readonly kind: string
  readonly source_id: string
  readonly text: string | null
}

function mapRow(row: SearchRow): SearchResult {
  return { kind: row.kind as SearchKind, id: row.source_id, text: row.text }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Ranked matches across all five indexed tables, newest-relevance-first
 * (FTS5's built-in `rank`, ascending — the lower value is the better match).
 * A query with no searchable tokens (blank, whitespace, punctuation-only)
 * returns `[]` without touching the database — never a thrown error.
 */
export function searchAll(db: Database.Database, input: unknown): readonly SearchResult[] {
  const parsed = parseQueryInput(input)
  const matchQuery = buildMatchQuery(parsed.query)
  if (matchQuery === null) return []

  const limit = parsed.limit ?? DEFAULT_SEARCH_LIMIT
  const rows = db
    .prepare('SELECT kind, source_id, text FROM search_fts WHERE search_fts MATCH ? ORDER BY rank LIMIT ?')
    .all(matchQuery, limit) as SearchRow[]
  return rows.map(mapRow)
}

// ---------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------

/**
 * Drops every row from `search_fts` — FTS5's own `'delete-all'` special
 * command, the documented way to empty an external-content table without
 * dropping and recreating the virtual table — and repopulates it in one pass
 * by selecting straight out of `search_source`
 * (`0002_search_fts.sql`'s union view). That is the same view every
 * trigger's `rowid * 8 + <kind code>` formula targets, so a freshly rebuilt
 * index and an incrementally-triggered one hold identical rows for identical
 * source data — the equivalence this task's acceptance criteria and
 * `search.test.ts` check directly, and the recovery path if a trigger is
 * ever suspected of having drifted.
 */
export function rebuildSearchIndex(db: Database.Database): void {
  const run = db.transaction(() => {
    db.prepare("INSERT INTO search_fts(search_fts) VALUES ('delete-all')").run()
    db.prepare(
      'INSERT INTO search_fts(rowid, kind, source_id, text) SELECT content_rowid, kind, source_id, text FROM search_source'
    ).run()
  })
  run()
}
