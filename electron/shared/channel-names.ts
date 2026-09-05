/**
 * The channel names, and nothing else — the one module `electron/preload/
 * index.ts` is allowed to import besides `electron` itself.
 *
 * **Why this file exists at all.** `CHANNEL_NAMES` used to live in
 * `ipc-types.ts` as `Object.keys(CHANNEL_CONTRACTS)`, and the preload's own
 * header claimed it was "a plain array of string literals with no runtime
 * dependency beyond itself". That was true of the *value* and false of the
 * *module*: an import of `CHANNEL_NAMES` pulled in `CHANNEL_CONTRACTS`, and
 * `CHANNEL_CONTRACTS` is built out of every entity schema in
 * `electron/shared/`, which is built out of zod. The preload bundle was
 * 204 KB, 337 of whose identifiers were zod's, and every one of those
 * schemas was *constructed* — `z.object(...)` called, refinements attached
 * — in the sandboxed preload context before the window could load, on every
 * window creation, to produce a list of sixty-eight strings.
 *
 * Nothing was insecure about it (the preload still exposed only the generic
 * `invoke` loop, and `sandbox: true` still held), and nothing was visibly
 * broken. It was simply the whole schema layer being evaluated in the one
 * process that has no use for it. Splitting the names out is the entire fix:
 * this module imports nothing, so the preload bundle is the preload.
 *
 * **What replaces "mechanically derived, not hand-duplicated".** The old
 * `Object.keys` was worth something — it made a channel added to
 * `CHANNEL_CONTRACTS` and forgotten here impossible. That guarantee moves to
 * a test rather than to the runtime: `ipc-types.test.ts` asserts this array
 * equals `Object.keys(CHANNEL_CONTRACTS)` **in order**, and `ChannelName`
 * below is still `keyof typeof CHANNEL_CONTRACTS`, so a name that is in one
 * and not the other fails to compile as well as failing that test. It is the
 * same arrangement `registry.ts` already lives under: two hand-written
 * descriptions of one set, with a check that they agree.
 *
 * Adding a channel therefore means three edits, not two: `CHANNEL_CONTRACTS`
 * (its wire shape), `registry.ts` (its behaviour), and this list (its name).
 * The tests name the third one for you if you miss it.
 */

/**
 * Every channel `window.crm` exposes, in `CHANNEL_CONTRACTS` declaration
 * order. Grouped by namespace exactly as that object groups them, so the two
 * read side by side.
 */
export const CHANNEL_NAMES = [
  // -- proof / database --------------------------------------------------
  'app:version',
  'db:schemaVersion',
  'db:stats',
  'db:query',

  // -- companies ---------------------------------------------------------
  'companies:list',
  'companies:get',
  'companies:create',
  'companies:update',
  'companies:delete',
  'companies:deleteImpact',

  // -- people and affiliations -------------------------------------------
  'people:list',
  'people:get',
  'people:create',
  'people:update',
  'people:delete',
  'people:deleteImpact',
  'people:addAffiliation',
  'people:updateAffiliation',
  'people:endAffiliation',
  'people:move',

  // -- engagements -------------------------------------------------------
  'engagements:list',
  'engagements:get',
  'engagements:create',
  'engagements:update',
  'engagements:delete',
  'engagements:deleteImpact',

  // -- milestones --------------------------------------------------------
  'milestones:list',
  'milestones:create',
  'milestones:update',
  'milestones:complete',
  'milestones:uncomplete',
  'milestones:reorder',
  'milestones:delete',
  'milestones:sum',

  // -- revenue -----------------------------------------------------------
  'revenue:summary',
  'revenue:lines',
  'revenue:setLineStatus',

  // -- offerings ---------------------------------------------------------
  'offerings:listCategories',
  'offerings:list',
  'offerings:get',
  'offerings:createCategory',
  'offerings:updateCategory',
  'offerings:deleteCategory',
  'offerings:create',
  'offerings:update',
  'offerings:archive',
  'offerings:delete',
  'offerings:deleteImpact',
  'offerings:duplicate',

  // -- tasks -------------------------------------------------------------
  'tasks:list',
  'tasks:get',
  'tasks:create',
  'tasks:update',
  'tasks:delete',
  'tasks:setNextStep',
  'tasks:countOpen',

  // -- activity ----------------------------------------------------------
  'activity:list',
  'activity:get',
  'activity:log',

  // -- search ------------------------------------------------------------
  'search:query',

  // -- links and favicons ------------------------------------------------
  'links:list',
  'links:add',
  'links:update',
  'links:delete',
  'favicons:get',

  // -- branding ----------------------------------------------------------
  'branding:get',
  'branding:choose',
  'branding:clear',

  // -- company images ----------------------------------------------------
  'companyImages:thumbnails',
  'companyImages:get',
  'companyImages:choose',
  'companyImages:clear',

  // -- settings ----------------------------------------------------------
  'settings:get',
  'settings:getAll',
  'settings:set',
  'settings:reset',

  // -- backup ------------------------------------------------------------
  'backup:run'
] as const
