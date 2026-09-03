import { z } from 'zod'
import { activityFiltersSchema, activitySchema, logActivityInputSchema } from './activity'
import {
  brandingChoiceSchema,
  brandingSlotRequestSchema,
  brandingSlotStateSchema,
  brandingSnapshotSchema
} from './branding'
import { companySchema, createCompanyInputSchema, updateCompanyInputSchema } from './companies'
import {
  companyImageChoiceSchema,
  companyImageSlotRequestSchema,
  companyImageSlotStateSchema,
  companyImagesRequestSchema,
  companyImagesSnapshotSchema,
  companyImageThumbnailsSchema
} from './company-images'
import { faviconRequestSchema, faviconResultSchema } from './favicons'
import {
  createEngagementInputSchema,
  engagementSchema,
  engagementWithOfferingSchema,
  listEngagementsFilterSchema,
  milestoneSchema,
  updateEngagementInputSchema
} from './engagements'
import { createLinkInputSchema, linkSchema, listLinksInputSchema, updateLinkInputSchema } from './links'
import {
  createMilestoneInputSchema,
  listMilestonesInputSchema,
  milestoneSumSchema,
  reorderMilestonesInputSchema,
  sumMilestonesInputSchema,
  updateMilestoneInputSchema
} from './milestones'
import {
  createOfferingCategoryInputSchema,
  createOfferingInputSchema,
  duplicateOfferingInputSchema,
  listOfferingsFilterSchema,
  offeringCategorySchema,
  offeringListItemSchema,
  offeringWithVersionsSchema,
  updateOfferingCategoryInputSchema,
  updateOfferingInputSchema
} from './offerings'
import {
  affiliationSchema,
  createAffiliationInputSchema,
  createPersonInputSchema,
  endAffiliationInputSchema,
  movePersonOptionsSchema,
  personSchema,
  personWithAffiliationsSchema,
  updateAffiliationInputSchema,
  updatePersonInputSchema
} from './people'
import { revenueSummaryRequestSchema, revenueSummarySchema } from './revenue'
import type { CHANNEL_NAMES as CHANNEL_NAMES_LIST } from './channel-names'
import { deleteRequestSchema, deletionImpactSchema } from './deletion'
import { SEARCH_KINDS, searchQueryInputSchema } from './search'
import { SETTINGS_KEYS, SETTINGS_REGISTRY } from './settings'
import type { SettingKey, SettingsSnapshot, SettingValue } from './settings'
import { createTaskInputSchema, taskFilterSchema, taskSchema, updateTaskInputSchema } from './tasks'
import { timestampSchema } from './types'

/**
 * The typed IPC bridge's shared wire contract (T-260828-09): channel name
 * plus request/response zod schema, for every channel — self-contained,
 * with no reference to `electron/main/ipc/registry.ts`. That is not a style
 * choice: `electron/shared/**` is typechecked under BOTH tsconfig.node.json
 * (main + preload) and tsconfig.web.json (renderer), T-260828-08's boundary
 * gate, and both are `composite: true` projects — TypeScript's composite
 * mode rejects *any* reference to a file outside a project's own `include`
 * list, even a type-only one that would be fully erased at build time
 * (verified while building this task: `import type { Registry } from
 * '../main/ipc/registry'` here failed `tsc -p tsconfig.web.json` with
 * TS6307, "Projects must list all files or use an 'include' pattern",
 * because registry.ts sits outside tsconfig.web.json's include). So this
 * file can only ever look *toward* registry.ts, never the other way —
 * `registry.ts` imports `CHANNEL_CONTRACTS` below and attaches one handler
 * per channel; this file has no idea registry.ts exists.
 *
 * Composes CONVENTIONS.md's shared primitives (T-260828-08) — the response
 * schemas below are built from `electron/shared/types.ts`, not redefined.
 *
 * T-260828-26 adds the whole entity surface at once (ADR-007 binds this, all
 * five rules): every request schema that validates a create/update payload,
 * a read filter, or an id/patch envelope, AND every response schema that
 * describes an entity's read shape (`companySchema`, `personSchema`, …)
 * imports it from the entity's own `electron/shared/<entity>.ts` module
 * rather than redeclaring a single field here. That module owns the
 * entity's whole wire surface — create input, update input, read shape,
 * list filter — with the TypeScript type always `z.infer`'d from the zod
 * schema beside it, never a hand-maintained interface the schema could
 * drift from silently (review fix: `registry.ts`'s `satisfies` catches a
 * renamed or retyped field but not an *added* one — a column added to a
 * repository's return type with no matching schema field passes both
 * tsconfigs and never crosses IPC). This file only ever composes those
 * imports (`z.array(...)`, `z.object({ id, patch }).strict()`,
 * `mutationResultSchema(...)`) into a channel's request/response pair; it
 * declares no entity field itself.
 */

const schemaVersionResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  lastMigrationAt: timestampSchema.nullable()
})

// ---------------------------------------------------------------------------
// db:stats — the Data view's live file facts (T-260828-40, plan item X-01).
//
// Every field is read from the file at call time (`electron/main/db/stats.ts`
// — read its header): X-01's first acceptance criterion is that changing the
// database and revisiting the view shows the new size and counts with no
// restart, so there is nothing cached on either side of this wire and the
// response carries `readAt` so the view can show *when* it looked rather
// than imply "now".
//
// `path` crosses the boundary deliberately. T-260828-09's rule is that no
// filesystem path rides in an *error* envelope; this is the page whose whole
// subject is which file on this machine holds the data, and a path nobody
// can copy is not a file anybody owns.
//
// `portable` (T-260831-06) rides alongside it for the same reason and adds
// no new exposure — it is one boolean, and the path it qualifies already
// crossed. It is here rather than on a channel of its own because the scope
// that added it says not to open an IPC channel where an existing payload
// already carries what the renderer needs, and this is the payload that
// names the data location. The renderer must not re-derive it: it has no
// filesystem (AGENTS.md), and ADR-013 Decision 2 allows exactly one
// portability predicate, which lives in `electron/main/db/portable.ts`.
//
// `schemaVersion`/`lastMigrationAt` are the same two values `db:schemaVersion`
// answers with, from the same `getSchemaVersion` reader — that channel is
// still the one to call when those are all you want; this one exists so the
// facts panel is one round trip rather than four.
// ---------------------------------------------------------------------------

const tableRowCountSchema = z.object({ name: z.string(), rowCount: z.number().int().nonnegative() }).strict()

const databaseStatsResponseSchema = z
  .object({
    path: z.string(),
    /**
     * T-260831-06 / ADR-013 Decision 6: `path` above is a portable copy's
     * data root — beside the launched `.exe` — rather than this machine's
     * user-data folder. See `DatabaseStats.portable` for why the verdict
     * crosses instead of the view inferring it from the path.
     */
    portable: z.boolean(),
    fileBytes: z.number().int().nonnegative(),
    /** The `-wal` sidecar, separately: a just-written row lives there until a checkpoint moves it. */
    walBytes: z.number().int().nonnegative(),
    pageSize: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    journalMode: z.string(),
    schemaVersion: z.number().int().nonnegative(),
    lastMigrationAt: timestampSchema.nullable(),
    /** X-04's nightly export; `null` until that task exists, so the view says "never" rather than omitting the fact. */
    lastBackupAt: timestampSchema.nullable(),
    /** X-05's `integrity_check`; `null` for the same reason. This page may display a result, never run one. */
    lastIntegrityCheckAt: timestampSchema.nullable(),
    lastIntegrityCheckOk: z.boolean().nullable(),
    tables: z.array(tableRowCountSchema).readonly(),
    readAt: timestampSchema
  })
  .strict()

/** `db:stats`'s response as the renderer sees it, exported so the Data view can name the type without re-deriving it. */
export type DatabaseStatsResponse = z.infer<typeof databaseStatsResponseSchema>

// ---------------------------------------------------------------------------
// db:query — the read-only query channel (T-260828-39, plan item X-02).
//
// The one channel that takes SQL from the renderer. Everything that makes
// that safe lives in `electron/main/db/readonly-connection.ts` (a second
// connection opened readonly, plus a `stmt.readonly` and a `stmt.reader`
// check on the *compiled* statement — read that file's header before
// changing anything here). This file only describes the wire.
//
// Two things are deliberately absent from the request shape: a timeout and
// a row cap. Both exist, both are enforced, and both are main-side
// constants — a renderer that could name its own ceiling could name a
// useless one, and the cap is what stops a cartesian join freezing the main
// process.
// ---------------------------------------------------------------------------

/** Mirrors `electron/main/db/readonly-connection.ts`'s `QueryRefusalCode` — that file is main-only and cannot be imported here (TS6307, this file's own header), the same way `REPOSITORY_ERROR_CODES` below mirrors `db/repositories/errors.ts`. */
const QUERY_REFUSAL_CODES = [
  'empty-statement',
  'invalid-statement',
  'writes-data',
  'no-result-set',
  'bad-parameters',
  'timeout'
] as const
export type QueryRefusalCode = (typeof QUERY_REFUSAL_CODES)[number]

/** One SQLite value, in and out: text, a number, `NULL`, or a BLOB. Everything here survives Electron's structured clone unchanged. */
const queryCellSchema = z.union([
  z.string(),
  z.number(),
  z.bigint(),
  z.boolean(),
  z.null(),
  // `z.custom<Uint8Array>` rather than `z.instanceof(Uint8Array)`: the
  // latter infers `Uint8Array<ArrayBuffer>`, and better-sqlite3 hands back a
  // Node `Buffer`, which is `Uint8Array<ArrayBufferLike>` and not assignable
  // to it — the handler's return type stops matching this contract for a
  // reason that has nothing to do with the wire. The runtime check is the
  // same `instanceof` either way.
  z.custom<Uint8Array>((value) => value instanceof Uint8Array, { message: 'Expected a BLOB (Uint8Array)' })
])

const queryRequestSchema = z
  .object({
    statement: z.string().min(1).max(20_000),
    /** Positional (`?`) or named (`:name`) bind values. Optional — most console statements have none. */
    params: z.union([z.array(queryCellSchema), z.record(z.string(), queryCellSchema)]).optional()
  })
  .strict()

const queryResultSchema = z
  .object({
    /**
     * Rows are positional arrays keyed by `columns`, not objects: a
     * four-table join names `id` four times and an object row would keep
     * one of them, silently losing data in exactly the query this channel
     * exists to make possible.
     */
    columns: z.array(z.string()).readonly(),
    rows: z.array(z.array(queryCellSchema).readonly()).readonly(),
    rowCount: z.number().int().nonnegative(),
    /** True when the result was cut off at `rowLimit`. Stated, never silent. */
    truncated: z.boolean(),
    rowLimit: z.number().int().positive(),
    durationMs: z.number().nonnegative()
  })
  .strict()

/**
 * A refusal is *data*, exactly like `mutationResultSchema`'s and for
 * exactly the same reason (see the section below): `index.ts` discards a
 * thrown error's message, and §6.12 requires a refused statement to say
 * what was refused and on what grounds.
 */
const queryResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: queryResultSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.enum(QUERY_REFUSAL_CODES), message: z.string() })
  })
])

/** The `db:query` result as the renderer sees it, exported so a caller can name the type without re-deriving it from the schema. */
export type QueryChannelResponse = z.infer<typeof queryResponseSchema>

// ---------------------------------------------------------------------------
// Repository refusals, as data.
//
// `electron/main/ipc/index.ts` (out of this task's scope — see AGENTS.md/the
// task file's Touches) wraps a thrown handler error in a single generic
// sentence — "<channel>: something went wrong handling this request" — and
// discards whatever `.message` the thrown error actually carried, by design
// (T-260828-09's Risks: no stack trace, no filesystem path in the envelope).
// That is exactly right for a genuine bug, but it would also swallow a
// `RefusalError`'s human-written reason ("Cannot delete 'Acme': 3 activity
// records reference it...") — a repository refusal is not a bug, and this
// task's Acceptance requires the reason to reach the renderer.
//
// So a mutation handler never lets a `RepositoryError` (NotFoundError,
// ValidationError, RefusalError — electron/main/db/repositories/errors.ts)
// propagate to `index.ts` at all: `registry.ts`'s `runMutation` catches it
// and returns it as *data*, shaped like `IpcResult` one level down. Every
// mutating channel's response schema is `mutationResultSchema(<the entity's
// domain schema>)` below — `{ ok: true, data }` on success, `{ ok: false,
// error: { code, message, blocker? } }` on a caught repository refusal — so
// `index.ts`'s own envelope always sees `{ ok: true }` (nothing thrown) and
// the refusal's message survives one layer in, intact.
// ---------------------------------------------------------------------------

/** Mirrors `electron/main/db/repositories/errors.ts`'s `RepositoryErrorCode` — that file is main-only and cannot be imported here (TS6307, this file's own header), so the three values are declared once on each side of the boundary, the same way `IpcErrorCode` below mirrors what `index.ts` actually produces. */
const REPOSITORY_ERROR_CODES = ['not-found', 'validation', 'refused'] as const
export type RepositoryErrorCode = (typeof REPOSITORY_ERROR_CODES)[number]

/**
 * Mirrors `electron/main/db/repositories/errors.ts`'s `RefusalBlocker` —
 * same reasoning, and the same boundary, as `RepositoryErrorCode` above.
 * Review fix (item 3): `RefusalError.blocker` — `{ reason, count? }`,
 * `errors.ts`'s own header says exists "so T-260828-26 does not have to
 * string-match" — used to be dropped entirely by `runMutation`, which only
 * ever copied `.code` and `.message`. A renderer that needs to tell an
 * activity-history refusal from an engagement-reference one, or show the
 * blocking row count, had only the prose sentence to parse. Carried through
 * the envelope as structured data now, present only on a `refused` error
 * (every `RefusalError` this codebase throws sets a `reason`; `count` is set
 * only by a delete-path referential refusal — `referential-guard.ts`).
 */
const repositoryErrorBlockerSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative().optional()
})
export type RepositoryErrorBlocker = z.infer<typeof repositoryErrorBlockerSchema>

const repositoryErrorSchema = z.object({
  code: z.enum(REPOSITORY_ERROR_CODES),
  message: z.string(),
  blocker: repositoryErrorBlockerSchema.optional()
})

/** Every mutating channel's response shape: a caught repository refusal as data, never a thrown exception. See this file's header. */
function mutationResultSchema<Data extends z.ZodTypeAny>(data: Data) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: repositoryErrorSchema })
  ])
}

/** The TypeScript shape `mutationResultSchema`'s `z.infer` produces — exported so `electron/renderer/lib/ipc.ts` can unwrap it without re-deriving the shape by hand. */
export type MutationResult<Data> =
  | { readonly ok: true; readonly data: Data }
  | {
      readonly ok: false
      readonly error: { readonly code: RepositoryErrorCode; readonly message: string; readonly blocker?: RepositoryErrorBlocker }
    }

/** `{ id }` — every delete channel's success payload; there is no richer domain shape to echo back once a row is gone. */
const idResultSchema = z.object({ id: z.string() }).strict()

const idRequestSchema = z.object({ id: z.string().min(1) }).strict()

// ---------------------------------------------------------------------------
// companies, people + affiliations, engagements + milestones, tasks and
// activity's read shapes, create/update input schemas and list filters all
// live in their own `electron/shared/<entity>.ts` module (ADR-007) and are
// imported above, not declared here — see this file's header. Activity gets
// no update or delete channel below (G8) even though `activitySchema` is
// available like every other entity's.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// settings — one row per declared key (ADR-002), not an entity with
// create/update/delete. Every schema below validates against
// `SETTINGS_REGISTRY` (electron/shared/settings.ts) — imported per ADR-007,
// never redeclared — via a `superRefine` that re-checks each value against
// its own key's schema, rather than a `z.union`/`discriminatedUnion` with
// one branch per key: `SETTINGS_KEYS` is a runtime array, and a branch built
// by mapping over it carries the type `{ key: SettingKey; value: <the union
// of every key's value type> }` for every element — the pairing between one
// specific literal key and its own specific value type cannot be recovered
// from a runtime `.map()`, so a "union" built that way would validate no
// more precisely, at either the type or the runtime level, than the plain
// object schemas below already do. Each schema's exported TypeScript shape
// is asserted with one cast at the end, the same "cast on return is the one
// place that fact is asserted" reasoning `db/repositories/settings.ts`'s own
// `getAllSettings` documents for the identical generic-indexing limit on the
// read side.
// ---------------------------------------------------------------------------

/**
 * `{ key, value }` for exactly one declared setting — `settings:get`'s and
 * `settings:reset`'s response shape, and `settings:set`'s request/response
 * shape. Exported so `registry.ts`'s handlers can assert their own return
 * value against it (the same per-key pairing `getSetting`/`resetSetting`
 * already return correctly at runtime, just not something a generic call
 * keyed by a widened `SettingKey` can prove to `tsc` — see this section's
 * header).
 */
export type SettingEntry = { [K in SettingKey]: { readonly key: K; readonly value: SettingValue<K> } }[SettingKey]

const settingKeySchema = z.enum(SETTINGS_KEYS as [SettingKey, ...SettingKey[]])
const settingKeyRequestSchema = z.object({ key: settingKeySchema }).strict()

const settingEntrySchema = z
  .object({ key: settingKeySchema, value: z.unknown() })
  .strict()
  .superRefine((entry, ctx) => {
    const result = SETTINGS_REGISTRY[entry.key].schema.safeParse(entry.value)
    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: 'custom', message: issue.message, path: ['value', ...issue.path] })
      }
    }
  }) as unknown as z.ZodType<SettingEntry>

const settingsSnapshotSchema = z
  .object(Object.fromEntries(SETTINGS_KEYS.map((key) => [key, z.unknown()])))
  .strict()
  .superRefine((snapshot, ctx) => {
    for (const key of SETTINGS_KEYS) {
      const result = SETTINGS_REGISTRY[key].schema.safeParse((snapshot as Record<string, unknown>)[key])
      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message, path: [key, ...issue.path] })
        }
      }
    }
  }) as unknown as z.ZodType<SettingsSnapshot>

// ---------------------------------------------------------------------------
// search:query — the command palette's read (T-260828-37, plan item P1-10).
//
// The request shape is `searchQueryInputSchema` itself (electron/shared/search.ts),
// imported per ADR-007 rather than restated here — the repository already
// validates that exact object, and `search.ts`'s own header names this
// channel as the reason its input is one structured-clone object rather than
// positional arguments.
//
// The response is declared here rather than in `search.ts` because
// `SearchResult` there is a hand-written interface, not a `z.infer`, and this
// is the only place that shape has to cross the wire. It cannot drift
// silently: `registry.ts`'s handler returns `readonly SearchResult[]` and its
// `satisfies` clause checks that against `z.infer` of the schema below, so a
// field added to (or retyped in) `SearchResult` without a matching change
// here fails `npm run typecheck`.
// ---------------------------------------------------------------------------

const searchResultSchema = z
  .object({
    /** Which of the five indexed source tables the row came from — the kind codes' own order (`SEARCH_KINDS`). */
    kind: z.enum(SEARCH_KINDS),
    id: z.string(),
    /** The indexed text: a company/person/engagement name, a task title, an activity body. Nullable because the source columns are. */
    text: z.string().nullable()
  })
  .strict()

/**
 * The one place a channel's name and wire shape are declared. `registry.ts`
 * is where its *behaviour* is declared — see that file's header comment for
 * why a channel needs one entry in each of these two files rather than
 * genuinely one, and `registry.test.ts` for the runtime guard against the
 * two drifting apart (`Object.keys(registry)` against `CHANNEL_NAMES`
 * below, which is mechanically derived from this object, not hand-duplicated).
 */
export const CHANNEL_CONTRACTS = {
  /** Proves the bridge end to end: no request payload, a trivial response. */
  'app:version': {
    request: z.undefined(),
    response: z.object({ version: z.string() })
  },
  /** X-01's "schema version and last migration date" — the second proof channel. */
  'db:schemaVersion': {
    request: z.undefined(),
    response: schemaVersionResponseSchema
  },
  /** X-01's live file facts — size, WAL size, page size, path, journal mode, schema version and one row count per table. See the `db:stats` section above. */
  'db:stats': {
    request: z.undefined(),
    response: databaseStatsResponseSchema
  },
  /**
   * X-02's read-only query channel — a statement plus optional bind values
   * in, rows or a named refusal out. See the `db:query` section above, and
   * `electron/main/db/readonly-connection.ts` for the three mechanisms that
   * make taking SQL from the renderer defensible at all.
   */
  'db:query': {
    request: queryRequestSchema,
    response: queryResponseSchema
  },

  // -- companies --------------------------------------------------------

  'companies:list': { request: z.undefined(), response: z.array(companySchema).readonly() },
  'companies:get': { request: idRequestSchema, response: companySchema.nullable() },
  'companies:create': { request: createCompanyInputSchema, response: mutationResultSchema(companySchema) },
  'companies:update': {
    request: z.object({ id: z.string().min(1), patch: updateCompanyInputSchema }).strict(),
    response: mutationResultSchema(companySchema)
  },
  /**
   * Deleting a company. `deleteRequestSchema` widens the old bare id to
   * `{ id, cascade? }` (T-260902-09): without `cascade` this refuses when
   * anything still points at the row, exactly as before; with it, the rows
   * `companies:deleteImpact` listed are removed too. The renderer only ever sets it after
   * showing that list and being told yes a second time.
   */
  'companies:delete': { request: deleteRequestSchema, response: mutationResultSchema(idResultSchema) },
  'companies:deleteImpact': { request: idRequestSchema, response: deletionImpactSchema },

  // -- people + affiliations ---------------------------------------------

  'people:list': { request: z.undefined(), response: z.array(personSchema).readonly() },
  'people:get': { request: idRequestSchema, response: personWithAffiliationsSchema.nullable() },
  'people:create': { request: createPersonInputSchema, response: mutationResultSchema(personSchema) },
  'people:update': {
    request: z.object({ id: z.string().min(1), patch: updatePersonInputSchema }).strict(),
    response: mutationResultSchema(personSchema)
  },
  /**
   * Deleting a person. `deleteRequestSchema` widens the old bare id to
   * `{ id, cascade? }` (T-260902-09): without `cascade` this refuses when
   * anything still points at the row, exactly as before; with it, the rows
   * `people:deleteImpact` listed are removed too. The renderer only ever sets it after
   * showing that list and being told yes a second time.
   */
  'people:delete': { request: deleteRequestSchema, response: mutationResultSchema(idResultSchema) },
  'people:deleteImpact': { request: idRequestSchema, response: deletionImpactSchema },
  'people:addAffiliation': { request: createAffiliationInputSchema, response: mutationResultSchema(affiliationSchema) },
  'people:updateAffiliation': {
    request: z.object({ id: z.string().min(1), patch: updateAffiliationInputSchema }).strict(),
    response: mutationResultSchema(affiliationSchema)
  },
  'people:endAffiliation': {
    request: z.object({ id: z.string().min(1), endedOn: endAffiliationInputSchema }).strict(),
    response: mutationResultSchema(affiliationSchema)
  },
  'people:move': {
    request: z
      .object({ personId: z.string().min(1), toCompanyId: z.string().min(1), options: movePersonOptionsSchema })
      .strict(),
    response: mutationResultSchema(affiliationSchema)
  },

  // -- engagements + milestones -------------------------------------------

  // Both reads answer with the offering the engagement was sold as joined on
  // (T-260901-13) — a name, never a price. The mutation channels below keep
  // the bare `engagementSchema`: they report the row they just wrote.
  'engagements:list': { request: listEngagementsFilterSchema.optional(), response: z.array(engagementWithOfferingSchema).readonly() },
  'engagements:get': { request: idRequestSchema, response: engagementWithOfferingSchema.nullable() },
  'engagements:create': { request: createEngagementInputSchema, response: mutationResultSchema(engagementSchema) },
  'engagements:update': {
    request: z.object({ id: z.string().min(1), patch: updateEngagementInputSchema }).strict(),
    response: mutationResultSchema(engagementSchema)
  },
  /**
   * Deleting an engagement. `deleteRequestSchema` widens the old bare id to
   * `{ id, cascade? }` (T-260902-09): without `cascade` this refuses when
   * anything still points at the row, exactly as before; with it, the rows
   * `engagements:deleteImpact` listed are removed too. The renderer only ever sets it after
   * showing that list and being told yes a second time.
   */
  'engagements:delete': { request: deleteRequestSchema, response: mutationResultSchema(idResultSchema) },
  'engagements:deleteImpact': { request: idRequestSchema, response: deletionImpactSchema },

  // -- milestones (T-260902-02, P3-04) -------------------------------------
  //
  // `milestones:list` was `engagements:milestones` until this task; it moved
  // into the table's own namespace so one query-key entity — and one
  // `invalidate.milestones` — covers every read of it. The writes are what a
  // fixed-scope engagement's milestones need before the revenue generator
  // (T-260902-03) can recognise anything from them. `milestones:sum` is a
  // check on the engagement's *terms* (do they add to the contract value —
  // P3-09's editor says so), not a revenue figure; backlog reads
  // `revenue_lines` (ADR-003). `complete`/`uncomplete` are their own
  // channels rather than a `completedAt` field on `update`: done-ness is a
  // fact the repository stamps, not a timestamp a caller supplies.
  'milestones:list': { request: listMilestonesInputSchema, response: z.array(milestoneSchema).readonly() },
  'milestones:create': { request: createMilestoneInputSchema, response: mutationResultSchema(milestoneSchema) },
  'milestones:update': {
    request: z.object({ id: z.string().min(1), patch: updateMilestoneInputSchema }).strict(),
    response: mutationResultSchema(milestoneSchema)
  },
  'milestones:complete': { request: idRequestSchema, response: mutationResultSchema(milestoneSchema) },
  'milestones:uncomplete': { request: idRequestSchema, response: mutationResultSchema(milestoneSchema) },
  'milestones:reorder': { request: reorderMilestonesInputSchema, response: mutationResultSchema(z.array(milestoneSchema).readonly()) },
  'milestones:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },
  'milestones:sum': { request: sumMilestonesInputSchema, response: milestoneSumSchema },

  // -- revenue (T-260902-04, P3-06) ----------------------------------------
  //
  // One read, answering §6.7 whole: the four metrics, the chart's series and
  // the rows of the requested rollup, every figure a `SUM` over
  // `revenue_lines` in main (ADR-003). There is no write channel: the lines
  // are written by the generator inside `engagements:*` and `milestones:*`
  // mutations, and a channel that let the renderer write one would be a
  // second path around it. The request's optional `now` is for tests
  // (`revenueSummaryRequestSchema`); the view never sends it.
  'revenue:summary': { request: revenueSummaryRequestSchema.optional(), response: revenueSummarySchema },

  // -- offerings + categories (T-260901-07) --------------------------------
  //
  // The catalogue T-260901-05's repository owns, reached from the renderer for
  // the first time here. Every request and response schema below is imported
  // from `electron/shared/offerings.ts` (ADR-007) — this file declares not one
  // offering field of its own, so the three vocabularies that module closes
  // (`OFFERING_TYPES`, `OFFERING_BILLING_MODELS`, `OFFERING_UNITS`) are
  // enforced on the wire by exactly the tuples the repository validates
  // against, and cannot drift into a second list.
  //
  // Three absences are decisions, not gaps:
  //
  // - **No price-change channel.** `updateOfferingInputSchema` has no
  //   `rateCents` key and is `.strict()`, so `offerings:update` refuses a rate
  //   rather than ignoring it. Appending a version — closing the current one
  //   and opening the next, with the effective-date semantics §6.5 requires —
  //   is P3-02, and a channel here that could write a second version would let
  //   the UI change a price without them.
  // - **No `offerings:restore`.** `archiveOffering` has no inverse in the
  //   repository (its own header says why), and a channel with no
  //   implementation behind it is surface waiting for a caller.
  // - **No category archive.** Categories delete, and the delete refuses while
  //   offerings still point at it — see `offerings:deleteCategory` below.
  //
  // `offerings.blurb` is free operator text and crosses as a plain string,
  // exactly as `companies.notes` does; React escapes it at the render site and
  // nothing here or in the view interpolates it into markup.

  'offerings:listCategories': { request: z.undefined(), response: z.array(offeringCategorySchema).readonly() },
  /** The filter is optional and `.strict()`: omitted means every offering, archived included — there is no implicit `active = true` (see `listOfferings`). */
  'offerings:list': {
    request: listOfferingsFilterSchema.optional(),
    response: z.array(offeringListItemSchema).readonly()
  },
  /** One offering with its full version history, newest first — `versions[0]` is the same row the list reports as `currentVersion`. */
  'offerings:get': { request: idRequestSchema, response: offeringWithVersionsSchema.nullable() },

  'offerings:createCategory': {
    request: createOfferingCategoryInputSchema,
    response: mutationResultSchema(offeringCategorySchema)
  },
  'offerings:updateCategory': {
    request: z.object({ id: z.string().min(1), patch: updateOfferingCategoryInputSchema }).strict(),
    response: mutationResultSchema(offeringCategorySchema)
  },
  /**
   * Deleting a category that still holds offerings is refused by the
   * repository, in the same transaction as the delete, and the refusal names
   * the count and an example — that sentence reaches the renderer verbatim
   * through `runMutation`, which is the whole reason mutating channels answer
   * with `mutationResultSchema` rather than throwing.
   */
  'offerings:deleteCategory': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },

  /**
   * `rateCents` is **required** by `createOfferingInputSchema`, so a rateless
   * offering is refused before any SQL runs — §6.5's "an offering always has
   * at least one version" is enforced at the wire and again in the
   * repository's transaction, not by the form remembering to ask.
   */
  'offerings:create': { request: createOfferingInputSchema, response: mutationResultSchema(offeringWithVersionsSchema) },
  'offerings:update': {
    request: z.object({ id: z.string().min(1), patch: updateOfferingInputSchema }).strict(),
    response: mutationResultSchema(offeringWithVersionsSchema)
  },
  /** Archiving sets `active = false`; nothing is deleted, so the response is the offering as it now reads, not an `{ id }`. */
  'offerings:archive': { request: idRequestSchema, response: mutationResultSchema(offeringWithVersionsSchema) },
  /**
   * Removing an offering outright, as distinct from archiving it above.
   * An engagement sold from it is never deleted — it is unlinked and keeps
   * the rate it snapshotted at signature. `offerings:deleteImpact` says so
   * before this runs.
   */
  'offerings:delete': { request: deleteRequestSchema, response: mutationResultSchema(idResultSchema) },
  'offerings:deleteImpact': { request: idRequestSchema, response: deletionImpactSchema },
  /** `overrides` carries the new name and nothing else (`duplicateOfferingInputSchema`); omitting it appends " (copy)". */
  'offerings:duplicate': {
    request: z.object({ id: z.string().min(1), overrides: duplicateOfferingInputSchema.optional() }).strict(),
    response: mutationResultSchema(offeringWithVersionsSchema)
  },

  // -- tasks ----------------------------------------------------------------

  'tasks:list': { request: taskFilterSchema.optional(), response: z.array(taskSchema).readonly() },
  'tasks:get': { request: idRequestSchema, response: taskSchema.nullable() },
  'tasks:create': { request: createTaskInputSchema, response: mutationResultSchema(taskSchema) },
  'tasks:update': {
    request: z.object({ id: z.string().min(1), patch: updateTaskInputSchema }).strict(),
    response: mutationResultSchema(taskSchema)
  },
  'tasks:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },
  'tasks:setNextStep': { request: idRequestSchema, response: mutationResultSchema(taskSchema) },
  'tasks:countOpen': {
    request: taskFilterSchema.omit({ status: true }).optional(),
    response: z.object({ count: z.number().int().nonnegative() })
  },

  // -- activity — G8: list, get, log. Nothing else. ------------------------

  'activity:list': { request: activityFiltersSchema.optional(), response: z.array(activitySchema).readonly() },
  'activity:get': { request: idRequestSchema, response: activitySchema.nullable() },
  'activity:log': { request: logActivityInputSchema, response: mutationResultSchema(activitySchema) },

  // -- search — one read, no writes. The index maintains itself through the
  // triggers `0002_search_fts.sql` installs (ADR-008/ADR-009), so there is
  // no reindex channel to add here. ---------------------------------------

  'search:query': { request: searchQueryInputSchema, response: z.array(searchResultSchema).readonly() },

  // -- links — the polymorphic external-reference table (ADR-007,
  // T-260828-48), reached from a view for the first time here (T-260828-50).
  //
  // `links:list` is filtered by the entity a link hangs off rather than
  // returned wholesale: `listLinksInputSchema` is `.strict()` and names both
  // halves of the polymorphic key, so a caller cannot ask for "every link"
  // and slice one entity's out client-side.
  //
  // `kind` is absent from `links:add`'s request on purpose — the repository
  // derives it from the URL's host (`detectLinkKind`), so a renderer cannot
  // label a Drive URL as a Stripe one, and the icon a row draws is a fact
  // about the URL rather than a claim the caller made. `links:update`
  // patches the title and nothing else (T-260828-48's Scope).

  'links:list': { request: listLinksInputSchema, response: z.array(linkSchema).readonly() },
  'links:add': { request: createLinkInputSchema, response: mutationResultSchema(linkSchema) },
  'links:update': {
    request: z.object({ id: z.string().min(1), patch: updateLinkInputSchema }).strict(),
    response: mutationResultSchema(linkSchema)
  },
  'links:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },

  // -- favicons — one read, and it is a *read*. ---------------------------
  //
  // T-260828-49. The renderer asks what is cached for a link's URL and gets
  // an answer immediately, always: a `data:` URL it can put in an `<img>`, or
  // a named reason there is none. It never issues the fetch and never waits
  // on one — main decides whether to go to the network, does it in the
  // background, and the result shows up on a later read. Both the request and
  // response schemas, and the reasoning for that shape, live in
  // `electron/shared/favicons.ts` (ADR-007); the behaviour lives in
  // `electron/main/favicons/`, whose `fetch.ts` header carries the AGENTS.md
  // constraint the whole thing exists for.

  'favicons:get': { request: faviconRequestSchema, response: faviconResultSchema },

  // -- branding — the operator's own icon and wordmark (T-260829-05) ------
  //
  // Three channels, and the shape of them is the security decision. The
  // renderer cannot read a file and must not start: it asks for a *picker*, by
  // slot, and gets back an *image*. `branding:choose` therefore takes no path,
  // no filename and no declared content type — main opens the dialog, main
  // reads the bytes bounded by `BRANDING_MAX_BYTES`, and the bytes' own magic
  // numbers decide what they are. Nothing in any of the three responses names
  // a location on disk, in any branch, including the refusals: see
  // `electron/main/branding/picker.ts`'s header, and the test beside it that
  // walks the returned object for path separators rather than trusting a read
  // of the diff.
  //
  // `branding:get` is a synchronous database read, like `favicons:get` — it
  // never opens a dialog and never touches the filesystem.
  //
  // A cancelled picker is `{ ok: true, data: { outcome: 'cancelled' } }`, not
  // a failed mutation; `electron/shared/branding.ts` argues that where the
  // schema lives.

  'branding:get': { request: z.undefined(), response: brandingSnapshotSchema },
  'branding:choose': { request: brandingSlotRequestSchema, response: mutationResultSchema(brandingChoiceSchema) },
  'branding:clear': { request: brandingSlotRequestSchema, response: mutationResultSchema(brandingSlotStateSchema) },

  // -- companyImages — a company's own logo and banner (T-260901-12) -----
  //
  // The branding channels' shape, per company (ADR-015): the renderer names
  // a company it already knows the id of and a slot, and gets back an
  // *image*. `companyImages:choose` takes no path, no filename and no declared
  // content type — main opens the dialog through the same generalised picker
  // (`electron/main/images/picker.ts`) with the same guards, main reads the
  // bytes bounded by the *slot's* cap (`COMPANY_IMAGE_MAX_BYTES`), and the
  // bytes' own magic numbers decide what they are. Nothing in any of the four
  // responses names a location on disk, in any branch, including the
  // refusals — asserted by the same path-leak walker the branding tests run.
  //
  // Two reads, and the difference between them is the whole of ADR-015:
  // `companyImages:thumbnails` is the companies grid's one call — every
  // present slot's stored *derivative*, for every company, keyed by id; a
  // company with no images is absent. `companyImages:get` is the only channel
  // that carries an original, one company at a time. Both are synchronous
  // database reads that never open a dialog and never touch the filesystem.
  //
  // A cancelled picker is `{ ok: true, data: { outcome: 'cancelled' } }`, not
  // a failed mutation, exactly as `branding:choose` answers.

  'companyImages:thumbnails': { request: z.undefined(), response: companyImageThumbnailsSchema },
  'companyImages:get': { request: companyImagesRequestSchema, response: companyImagesSnapshotSchema },
  'companyImages:choose': {
    request: companyImageSlotRequestSchema,
    response: mutationResultSchema(companyImageChoiceSchema)
  },
  'companyImages:clear': {
    request: companyImageSlotRequestSchema,
    response: mutationResultSchema(companyImageSlotStateSchema)
  },

  // -- settings ---------------------------------------------------------

  'settings:get': { request: settingKeyRequestSchema, response: settingEntrySchema },
  'settings:getAll': { request: z.undefined(), response: settingsSnapshotSchema },
  'settings:set': { request: settingEntrySchema, response: mutationResultSchema(settingEntrySchema) },
  'settings:reset': { request: settingKeyRequestSchema, response: mutationResultSchema(settingEntrySchema) }
} as const

export type ChannelName = keyof typeof CHANNEL_CONTRACTS

/**
 * Re-exported from `./channel-names`, which declares the list and imports
 * nothing. It used to be `Object.keys(CHANNEL_CONTRACTS)` right here, and
 * that cost the sandboxed preload — the one importer that needs the names
 * and none of the schemas — 204 KB of zod evaluated on every window
 * creation. That module's header has the whole reasoning, and the two
 * checks that replace `Object.keys`: the pair of `extends` assertions below
 * (set equality, at compile time) and `ipc-types.test.ts` (order too).
 */
export { CHANNEL_NAMES } from './channel-names'

/**
 * `CHANNEL_NAMES` and `CHANNEL_CONTRACTS` name the same set — asserted in
 * both directions so neither a contract without a name nor a name without a
 * contract compiles. `never` on either line is the failure: a name missing
 * from the array, or an array entry that is not a contract key.
 */
type ChannelNameFromList = (typeof CHANNEL_NAMES_LIST)[number]
type _EveryContractIsNamed = ChannelName extends ChannelNameFromList ? true : never
type _EveryNameIsAContract = ChannelNameFromList extends ChannelName ? true : never
export type _ChannelNameCrossCheck = [_EveryContractIsNamed, _EveryNameIsAContract]

export type ChannelRequest<K extends ChannelName> = z.infer<(typeof CHANNEL_CONTRACTS)[K]['request']>
export type ChannelResponse<K extends ChannelName> = z.infer<(typeof CHANNEL_CONTRACTS)[K]['response']>

/** One error code per failure mode `electron/main/ipc/index.ts` distinguishes. */
export type IpcErrorCode = 'invalid-request' | 'invalid-response' | 'handler-error'

export interface IpcError {
  readonly code: IpcErrorCode
  readonly message: string
}

/**
 * What every `window.crm.*` call resolves to — never a thrown exception,
 * never a bare value. A repository or handler bug becomes a `{ ok: false }`
 * envelope carrying a code and a message, never a raw stack trace or
 * filesystem path (this task's Risks note: "the error envelope is where a
 * stack trace leaks").
 */
export type IpcResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: IpcError }

export function okResult<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function errResult(code: IpcErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

/** A channel whose request schema accepts `undefined` gets an optional parameter — callers write `window.crm['app:version']()`, not `(undefined)`. */
type ChannelMethod<K extends ChannelName> = undefined extends ChannelRequest<K>
  ? (payload?: ChannelRequest<K>) => Promise<IpcResult<ChannelResponse<K>>>
  : (payload: ChannelRequest<K>) => Promise<IpcResult<ChannelResponse<K>>>

/**
 * The typed shape of `window.crm`. Renaming, removing or reshaping a
 * channel in `CHANNEL_CONTRACTS` above changes this type, and any renderer
 * call site that no longer matches fails `npm run typecheck` (this task's
 * acceptance criterion) — and, independently, registry.ts's handler map
 * fails to satisfy `Record<ChannelName, ChannelDefinition>` if it isn't
 * updated to match, so the two files cannot silently drift at the type
 * level either.
 */
export type CrmApi = { readonly [K in ChannelName]: ChannelMethod<K> }
