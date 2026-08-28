import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * The query-key convention (documented alongside it in CONVENTIONS.md's
 * "Query keys" section): every key is a tuple of
 *
 *   [entity, scope, id?]
 *
 * - `entity` — the domain noun a channel answers about (`'companies'`,
 *   `'todos'`, `'app'`). Matches the channel's namespace in
 *   `electron/shared/ipc-types.ts`'s `CHANNEL_CONTRACTS`, not a UI concept.
 * - `scope` — what shape of answer within that entity (`'list'`, `'detail'`,
 *   `'summary'`, or — for the singleton proof channels this task has to work
 *   with — the channel's own word, `'version'` / `'schemaVersion'`).
 * - `id` — present only when `scope` addresses one record (`'detail'` with a
 *   company id). Omitted entirely for list/summary/singleton scopes rather
 *   than passed as `undefined`, so `['companies', 'list']` and
 *   `['companies', 'list', undefined]` are never both live at once.
 *
 * `queryKeys.<entity>.all()` is always just `[entity]` — the TanStack Query
 * key-matching rule that a shorter key is a prefix match for every longer key
 * starting with it means `invalidateQueries({ queryKey: ['companies'] })`
 * invalidates `['companies', 'list']`, `['companies', 'detail', id]`, all of
 * it, with one call. That prefix property is *why* entity is the first
 * element and not, say, scope.
 *
 * P1-07 (the entity-channel task) adds `queryKeys.companies`,
 * `queryKeys.todos`, etc. following this exact shape — this file's job is to
 * fix the shape before there are twenty call sites free to each invent their
 * own.
 */
export const queryKeys = {
  app: {
    all: () => ['app'] as const,
    /** `app:version` — a singleton, so `scope` is the channel's own name and there is no id. */
    version: () => ['app', 'version'] as const
  },
  db: {
    all: () => ['db'] as const,
    /** `db:schemaVersion` — same singleton shape as `app.version()`. */
    schemaVersion: () => ['db', 'schemaVersion'] as const
  }
} as const

/**
 * Invalidation helpers per entity: a mutation that touches the `app` entity
 * calls `invalidate.app(queryClient)` and names *what* it invalidates,
 * rather than every mutation call site having to know (and keep in sync)
 * which exact key tuple `queryKeys.app.version()` produces. One helper per
 * entity here is one place to widen later — an `app` mutation that starts
 * affecting a second `app`-scoped query invalidates both the moment it is
 * added to `queryKeys.app`, with no call site edited.
 *
 * `ipc.ts`'s `optimisticUpdate` takes one of these (e.g. `invalidate.todos`,
 * once P1-07 adds it) as its required `reconcile` argument rather than
 * invalidating its own single `queryKey` — an optimistic todo-completion
 * mutation reconciling only `['todos', 'detail', id]` would leave
 * `['todos', 'list']` showing the pre-completion state.
 *
 * Typed as `Record<keyof typeof queryKeys, ...>` rather than a bare object
 * literal so adding an entity to `queryKeys` without adding its matching
 * `invalidate` entry (or vice versa) fails `tsc`, the same drift guard
 * `electron/shared/ipc-types.ts`'s `CHANNEL_NAMES` gives the channel
 * registry.
 */
export const invalidate: Record<keyof typeof queryKeys, (queryClient: QueryClient) => Promise<void>> = {
  app: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.app.all() }),
  db: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.db.all() })
}

/** Re-exported so call sites can type a key without importing `@tanstack/react-query` directly. */
export type { QueryKey }
