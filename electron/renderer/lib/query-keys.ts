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
  },

  // -- T-260828-26's entity surface — each following the exact [entity,
  // scope, id?] shape above; `detail(id)` is the one scope that carries an
  // id, matching `companies:get`/`people:get`/etc.'s single-record shape. --

  companies: {
    all: () => ['companies'] as const,
    list: () => ['companies', 'list'] as const,
    detail: (id: string) => ['companies', 'detail', id] as const
  },
  people: {
    all: () => ['people'] as const,
    list: () => ['people', 'list'] as const,
    /** Includes the person's affiliations (`people:get`'s own return shape) — there is no separate affiliations key to invalidate alongside it. */
    detail: (id: string) => ['people', 'detail', id] as const
  },
  engagements: {
    all: () => ['engagements'] as const,
    list: () => ['engagements', 'list'] as const,
    detail: (id: string) => ['engagements', 'detail', id] as const,
    /** `engagements:milestones` — scoped under its engagement's id, not a bare `[entity, 'list']`, so invalidating one engagement's milestones never touches another's. */
    milestones: (engagementId: string) => ['engagements', 'milestones', engagementId] as const
  },
  tasks: {
    all: () => ['tasks'] as const,
    list: () => ['tasks', 'list'] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    /** `tasks:countOpen` — a summary, not a single record, so no id (this file's header: "id is present only when scope addresses one record"). */
    countOpen: () => ['tasks', 'countOpen'] as const
  },
  /** G8: no `activity` update or delete channel exists — no corresponding key here either, only what `activity:list`/`activity:get` need. */
  activity: {
    all: () => ['activity'] as const,
    list: () => ['activity', 'list'] as const,
    detail: (id: string) => ['activity', 'detail', id] as const
  },
  /** `settings` is ADR-002's one-row-per-key registry, not create/update/delete — `detail(key)` addresses one declared key, `all()`/`list()` cover `settings:getAll`'s snapshot. */
  settings: {
    all: () => ['settings'] as const,
    list: () => ['settings', 'list'] as const,
    detail: (key: string) => ['settings', 'detail', key] as const
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
  db: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.db.all() }),
  companies: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.companies.all() }),
  people: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.people.all() }),
  engagements: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.engagements.all() }),
  tasks: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all() }),
  activity: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.activity.all() }),
  settings: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() })
}

/** Re-exported so call sites can type a key without importing `@tanstack/react-query` directly. */
export type { QueryKey }
