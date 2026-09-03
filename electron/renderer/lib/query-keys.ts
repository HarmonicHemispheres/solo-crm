import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ActivityFilters } from '../../shared/activity'
import type { ListOfferingsFilter } from '../../shared/offerings'

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
    /**
     * `engagements:list({ billingCompanyId })` / `engagements:list({ clientCompanyId })`
     * (T-260828-29's company detail page: "billed here" / "delivered here,
     * billed elsewhere" are two independently-filtered queries, not one
     * unfiltered list sliced two ways client-side — see that task's own
     * Risks section on the direction bug that shortcut invites). Named
     * after the filter field each one passes, not "billed"/"delivered",
     * so a call site reads its own directionality straight off the key
     * rather than one more name to keep pointed the right way.
     */
    byBillingCompany: (companyId: string) => ['engagements', 'byBillingCompany', companyId] as const,
    byClientCompany: (companyId: string) => ['engagements', 'byClientCompany', companyId] as const
  },
  /**
   * `milestones:*` (T-260902-02). Both reads are scoped under the
   * engagement's id, not a bare `[entity, 'list']`, so one engagement's
   * milestones can be addressed without another's; `invalidate.milestones`
   * still covers the whole prefix, which is what a milestone mutation
   * calls — one helper, the way `offerings` covers its categories.
   */
  milestones: {
    all: () => ['milestones'] as const,
    list: (engagementId: string) => ['milestones', 'list', engagementId] as const,
    sum: (engagementId: string) => ['milestones', 'sum', engagementId] as const
  },
  /**
   * `revenue:summary` (T-260902-04). The payload carries all three rollups,
   * so the Revenue view's toggle and Today's tiles share an entry and a
   * toggle flip is a lookup, not a fetch.
   *
   * The **window and bucket** are part of the key, because they are part of
   * the answer: stepping the report back a year is a different set of
   * months, and caching it under the same key as the default view would
   * hand the chart the wrong twelve. `undefined` — the default window — has
   * its own entry, which is the one Today reads, so the two pages do not
   * evict each other every time the operator moves the chart.
   *
   * `revenue:setLineStatus` is the one renderer write in this entity
   * (`invalidate.revenue`); the engagement and milestone mutations that
   * regenerate lines in main invalidate it too, as does a settings write,
   * since the fiscal year start is one of them.
   */
  revenue: {
    all: () => ['revenue'] as const,
    summary: (scope?: { from: string; to: string; bucket: string }) =>
      scope === undefined ? (['revenue', 'summary'] as const) : (['revenue', 'summary', scope.from, scope.to, scope.bucket] as const),
    lines: (from: string, to: string) => ['revenue', 'lines', from, to] as const
  },
  /**
   * `offerings:*` (T-260901-07). The entity is the channel's own namespace, so
   * the categories read lives here as a *scope* rather than under an
   * `offeringCategories` entity of its own: `offerings:createCategory` and
   * `offerings:create` both come back through `invalidate.offerings`, and a
   * separate entity would need every category mutation to remember to
   * invalidate two prefixes (a rename changes what every offering row draws as
   * its chip).
   *
   * `list` is filter-aware for the same reason `activity.list` is — the
   * offerings view filters by type, category and archived-or-not, and a
   * filtered read is a genuinely different answer from the unfiltered one, not
   * one both queries should compete to populate. An absent or empty filter
   * collapses to the bare key, so `list()` and `list({})` address one entry.
   *
   * There is no `versions(id)` scope: `offerings:get` answers with the history
   * inline (`OfferingWithVersions`), so `detail(id)` is the only key a version
   * list could be read from or invalidated through.
   */
  offerings: {
    all: () => ['offerings'] as const,
    list: (filter?: ListOfferingsFilter) =>
      filter && Object.keys(filter).length > 0
        ? (['offerings', 'list', filter] as const)
        : (['offerings', 'list'] as const),
    detail: (id: string) => ['offerings', 'detail', id] as const,
    /** `offerings:listCategories` — one unfiltered read, so no id (this file's header: "id is present only when scope addresses one record"). */
    categories: () => ['offerings', 'categories'] as const
  },
  tasks: {
    all: () => ['tasks'] as const,
    list: () => ['tasks', 'list'] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    /**
     * `tasks:list({ open: true })` — the Todos view's (T-260828-33) working
     * set, built on the one exported "open" definition
     * (`OPEN_STATUS_SQL`/`isTaskOpen`, `electron/main/db/repositories/tasks.ts`)
     * rather than a filter this view writes itself. A distinct key from the
     * bare `list()` above (unfiltered) so the two caches never collide —
     * same reasoning as `engagements.byBillingCompany`/`byClientCompany`
     * below: a filtered variant earns its own named scope rather than
     * overloading `'list'`.
     */
    openList: () => ['tasks', 'openList'] as const,
    /**
     * `tasks:list({ status: 'waiting' })` — the Todos view's Waiting group.
     * Kept separate from `openList()` deliberately: `OPEN_STATUS_SQL`
     * already excludes `waiting` from "open" (T-260828-23), so a waiting
     * task is invisible to `openList()` and needs its own query to be shown
     * at all. Asking for the exact status `'waiting'` is not the same thing
     * as this view inventing its own approximation of "open" — it names one
     * literal status, not a second open/closed boundary.
     */
    waitingList: () => ['tasks', 'waitingList'] as const,
    /** `tasks:countOpen` — a summary, not a single record, so no id (this file's header: "id is present only when scope addresses one record"). */
    countOpen: () => ['tasks', 'countOpen'] as const,
    /**
     * `tasks:list({ companyId })` (T-260828-30's company detail Todos card) —
     * named after the filter field, matching `engagements.byBillingCompany`'s
     * own precedent above rather than a generic `list` a second scoped query
     * would collide with.
     */
    byCompany: (companyId: string) => ['tasks', 'byCompany', companyId] as const
  },
  /**
   * G8: no `activity` update or delete channel exists — no corresponding key
   * here either, only what `activity:list`/`activity:get` need.
   *
   * `list` takes an optional `ActivityFilters` (T-260828-34, the Activity
   * view's kind/date-range/entity filters) — a filtered read is a genuinely
   * different query result from the unfiltered one, so it needs a key TanStack
   * Query treats as distinct rather than one both compete to populate. Every
   * other entity's `list()` stays bare because `companies:list`/`people:list`
   * take no request at all and `engagements:list`'s own filtered call sites
   * (`byBillingCompany`/`byClientCompany` above) already have their own named
   * key rather than a raw filters object — activity's filter shape has no
   * such fixed small set of call sites to name individually.
   */
  activity: {
    all: () => ['activity'] as const,
    /**
     * T-260828-34: filter-aware, so the Activity view's filtered reads and an
     * unfiltered one never share a cache entry. An absent or empty filter set
     * collapses to the bare key rather than `['activity','list',{}]`, so
     * `list()` and `list({})` address the same entry.
     */
    list: (filters?: ActivityFilters) =>
      filters && Object.keys(filters).length > 0 ? (['activity', 'list', filters] as const) : (['activity', 'list'] as const),
    detail: (id: string) => ['activity', 'detail', id] as const,
    /**
     * `activity:list({ personId })` (T-260828-31: a person's page shows
     * activity involving them regardless of which company the row carries —
     * `activityFiltersSchema`'s `personId` is independent of its `companyId`,
     * so this is a person-scoped read, not a company one).
     *
     * Kept alongside the filter-aware `list` above rather than folded into it:
     * `list({ personId })` would now key correctly too, but PersonDetail calls
     * this and the distinct prefix keeps a person's timeline invalidatable on
     * its own, without touching the Activity view's cached pages.
     *
     * `byCompany`/`byEngagement` (T-260828-30) are the same idea for company
     * detail's Activity timeline, which merges three independently-filtered
     * calls — rows carrying the company's own id, rows hung on its people, and
     * rows hung on its engagements — rather than slicing one unfiltered list
     * client-side. A company detail page calls each once per contact or
     * engagement it has, not once total.
     */
    byCompany: (companyId: string) => ['activity', 'byCompany', companyId] as const,
    byPerson: (personId: string) => ['activity', 'byPerson', personId] as const,
    byEngagement: (engagementId: string) => ['activity', 'byEngagement', engagementId] as const
  },
  /**
   * `search:query` (T-260828-37's command palette). `scope` is the channel's
   * own word — a search is not a list of an entity, it is one answer to one
   * question — and the question itself is the third element, in the `id`
   * position, because that is exactly what it addresses: this query string,
   * at this row cap, and nothing else. Two different query strings are two
   * different cache entries, which is what lets the palette re-render an
   * already-typed prefix from cache instead of re-asking main (the one-frame
   * budget, §8/X-07).
   *
   * `limit` is part of the key rather than left implicit: the same query at a
   * different cap is a different answer, and a cache that conflated them
   * would serve a 5-row result to a caller that asked for 25.
   */
  search: {
    all: () => ['search'] as const,
    query: (query: string, limit: number) => ['search', 'query', { query, limit }] as const
  },
  /**
   * `links:list({ entityType, entityId })` (T-260828-50's link rows). A link
   * is polymorphic — it hangs off a company, a person or an engagement
   * (ADR-007, T-260828-48) — and there is no unfiltered read to give a bare
   * `list()` scope any meaning, so `forEntity` is the only read scope here.
   * Both halves of the polymorphic key are in the tuple because both are in
   * the request: keying on `entityId` alone would collide a company and an
   * engagement that happened to share an id, which is exactly the confusion
   * an FK-less `entity_type`/`entity_id` pair invites.
   */
  links: {
    all: () => ['links'] as const,
    forEntity: (entityType: string, entityId: string) => ['links', 'forEntity', { entityType, entityId }] as const
  },
  /**
   * `favicons:get({ url })` (T-260828-49). Keyed by the link's own URL, in
   * the `id` position, because that is precisely what the answer addresses.
   *
   * There is no invalidation path worth having and `invalidate.favicons`
   * below says so: main owns the cache and decides when a host is re-fetched,
   * and the read answers *immediately* either way — a `data:` URL or a named
   * absence, never a pending state (see `electron/shared/favicons.ts`'s
   * header). A row therefore draws once from whichever branch it gets. What
   * makes a later `ready` show up is a remount or a natural refetch, not a
   * renderer deciding the cache should be warmer than it is.
   */
  favicons: {
    all: () => ['favicons'] as const,
    forUrl: (url: string) => ['favicons', 'forUrl', url] as const
  },
  /**
   * `branding:get` (T-260829-07) — the operator's own icon and wordmark. One
   * singleton scope: the channel answers with *both* slots at once
   * (`BrandingSnapshot`), so there is nothing to address by id and no
   * per-slot key. A `current()` per slot would be two reads of one row set,
   * and — worse — two cache entries that can disagree about which of the two
   * images the rail is currently drawing.
   *
   * This key is read by `Rail.tsx` and by `WorkspaceSettings.tsx`'s Branding
   * card, and that sharing is the whole reason opening Settings does not
   * issue a second `branding:get` — same arrangement as
   * `queryKeys.settings.list()` between `Shell.tsx` and the same view.
   */
  branding: {
    all: () => ['branding'] as const,
    current: () => ['branding', 'current'] as const
  },
  /**
   * `companyImages:*` (T-260901-12, ADR-015) — a company's own logo and
   * banner. Two read scopes, matching the two channels and the two readers:
   * `thumbnails()` is the companies grid's one call (every present slot's
   * derivative, for every company, keyed by id), and `detail(companyId)` is
   * one company's originals, read by its detail page alone. They are one
   * entity so that `invalidate.companyImages` covers both — a pick or a clear
   * changes what the grid draws *and* what the header draws, and ADR-015
   * requires the two to agree without a reload.
   */
  companyImages: {
    all: () => ['companyImages'] as const,
    thumbnails: () => ['companyImages', 'thumbnails'] as const,
    detail: (companyId: string) => ['companyImages', 'detail', companyId] as const
  },
  /**
   * `<entity>:deleteImpact` — what deleting one record would take with it
   * (T-260902-09). Keyed by entity *and* id because the four impact channels
   * answer different questions about different tables, and the confirmation
   * dialog is mounted per record.
   *
   * There is no `invalidate.deletion`: this is read once, while a dialog is
   * open, and the record it describes does not exist afterwards. The
   * entity's own `invalidate` helper runs after the delete instead — see
   * `ConfirmDelete`'s `AFFECTED`.
   */
  deletion: {
    all: () => ['deletion'] as const,
    impact: (entity: string, id: string) => ['deletion', 'impact', entity, id] as const
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
  /**
   * Engagements *and* revenue (T-260902-03): every `engagements:*` mutation
   * regenerates the engagement's `revenue_lines` inside its own
   * transaction, so a cache of the summary is stale the moment the
   * mutation returns. Folding the second prefix in here, rather than at
   * each call site, is what keeps a sheet that invalidates "the entity it
   * wrote" correct without knowing what main derived from the write.
   */
  engagements: (queryClient) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.engagements.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revenue.all() })
    ]).then(() => undefined),
  /** Every milestone read — the per-engagement lists and sums at once — and revenue, for the same reason as `engagements` above: a fixed scope's lines are its milestones. */
  milestones: (queryClient) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.milestones.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revenue.all() })
    ]).then(() => undefined),
  /** The summary under every rollup. Called by nothing directly today — the two helpers above cover every write that changes it — and here so the entity map stays total. */
  revenue: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.revenue.all() }),
  /**
   * The whole `['offerings']` prefix — list, every filtered list, each
   * `detail`, and `categories`. Deliberately not narrower: every one of the
   * seven `offerings:*` mutations can change what another scope reads
   * (renaming a category changes the chip on every offering row; duplicating
   * adds a row to every filtered list it matches; archiving moves a row
   * between the `active: true` and `active: false` lists), so a call site
   * picking one scope would be picking wrong most of the time.
   */
  offerings: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.offerings.all() }),
  tasks: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all() }),
  activity: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.activity.all() }),
  /**
   * Every cached search answer at once — there is no useful narrower unit,
   * since a newly created company can match a query string nobody has typed
   * yet and the index is written by triggers rather than by anything this
   * layer can see. Nothing calls this today (the palette is the only reader,
   * and it holds its own short `staleTime` for the same reason); it exists so
   * a future create-and-search-again path has the entity's helper already
   * pointed at the whole prefix, per this file's header.
   */
  search: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.search.all() }),
  /**
   * Every entity's links at once. Narrower would be possible — the key
   * carries `entityType`/`entityId` — but a mutation's own call site is the
   * wrong place to re-derive which entity it just wrote to, and this file's
   * header is explicit that the entity helper covers the whole prefix so a
   * later sibling key is picked up with no call site edited.
   */
  links: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.links.all() }),
  /**
   * Deliberately a no-op beyond the mechanical prefix invalidation, and
   * called by nothing. Main owns the favicon cache and decides when a host
   * is re-fetched (T-260828-49); a renderer that invalidated this on a link
   * mutation would re-ask for a dozen icons every time a title was renamed,
   * for an answer that cannot have changed. It exists so the entity has its
   * helper pointed at the whole prefix — the same reason `search` above
   * does — not because anything should call it.
   */
  favicons: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.favicons.all() }),
  /**
   * Called by `branding:choose` and `branding:clear` (T-260829-07) — and
   * called rather than written to optimistically on purpose. A pick's result
   * depends on a native dialog the renderer cannot predict (the operator may
   * cancel) and on a refusal it cannot anticipate (the bytes are sniffed in
   * main, so a `.png` that is really an SVG is refused after the click). The
   * only honest cache entry is the one the channel came back with.
   */
  branding: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.branding.all() }),
  /**
   * Called by `companyImages:choose` and `companyImages:clear` (T-260901-12),
   * for `branding`'s reason — the result of a pick depends on a native dialog
   * and a sniff the renderer cannot predict, so the only honest cache entry is
   * the one the channel came back with. The prefix covers both the grid's
   * `thumbnails()` and the company's `detail(id)` in one call, which is what
   * ADR-015 asks of every write to this table.
   */
  companyImages: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.companyImages.all() }),
  /** Present so `invalidate` stays exhaustive over `queryKeys`; nothing calls it — see `queryKeys.deletion`'s comment. */
  deletion: (queryClient) => queryClient.invalidateQueries({ queryKey: queryKeys.deletion.all() }),
  /**
   * Settings, and revenue with them: `workspace.fiscalYearStartMonth` is
   * read inside `revenue:summary` (every YTD figure and the concentration
   * metric hang off it), so a settings write that left the summary cached
   * would show last year's boundary until some unrelated engagement edit.
   *
   * That used to read "a write that happens a few times in the life of a
   * workspace". T-260902-13 made it more than that: the rail's Reports
   * disclosure writes `nav.reportsExpanded` through here, so a toggle on the
   * Revenue page refetches the summary. Still the right trade — the summary
   * is a handful of aggregates over a local SQLite file, TanStack refetches
   * only mounted queries, and it keeps the previous data while it does, so
   * nothing on screen flashes. Splitting the prefix per key would trade a
   * cheap local query for two ways to reconcile one table.
   */
  settings: (queryClient) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.settings.all() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.revenue.all() })
    ]).then(() => undefined)
}

/** Re-exported so call sites can type a key without importing `@tanstack/react-query` directly. */
export type { QueryKey }
