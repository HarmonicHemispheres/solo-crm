import { z } from 'zod'
import { activityFiltersSchema, activitySchema, logActivityInputSchema } from './activity'
import { companySchema, createCompanyInputSchema, updateCompanyInputSchema } from './companies'
import {
  createEngagementInputSchema,
  engagementSchema,
  listEngagementsFilterSchema,
  milestoneSchema,
  updateEngagementInputSchema
} from './engagements'
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

  // -- companies --------------------------------------------------------

  'companies:list': { request: z.undefined(), response: z.array(companySchema).readonly() },
  'companies:get': { request: idRequestSchema, response: companySchema.nullable() },
  'companies:create': { request: createCompanyInputSchema, response: mutationResultSchema(companySchema) },
  'companies:update': {
    request: z.object({ id: z.string().min(1), patch: updateCompanyInputSchema }).strict(),
    response: mutationResultSchema(companySchema)
  },
  'companies:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },

  // -- people + affiliations ---------------------------------------------

  'people:list': { request: z.undefined(), response: z.array(personSchema).readonly() },
  'people:get': { request: idRequestSchema, response: personWithAffiliationsSchema.nullable() },
  'people:create': { request: createPersonInputSchema, response: mutationResultSchema(personSchema) },
  'people:update': {
    request: z.object({ id: z.string().min(1), patch: updatePersonInputSchema }).strict(),
    response: mutationResultSchema(personSchema)
  },
  'people:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },
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

  'engagements:list': { request: listEngagementsFilterSchema.optional(), response: z.array(engagementSchema).readonly() },
  'engagements:get': { request: idRequestSchema, response: engagementSchema.nullable() },
  'engagements:milestones': {
    request: z.object({ engagementId: z.string().min(1) }).strict(),
    response: z.array(milestoneSchema).readonly()
  },
  'engagements:create': { request: createEngagementInputSchema, response: mutationResultSchema(engagementSchema) },
  'engagements:update': {
    request: z.object({ id: z.string().min(1), patch: updateEngagementInputSchema }).strict(),
    response: mutationResultSchema(engagementSchema)
  },
  'engagements:delete': { request: idRequestSchema, response: mutationResultSchema(idResultSchema) },

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

  // -- settings ---------------------------------------------------------

  'settings:get': { request: settingKeyRequestSchema, response: settingEntrySchema },
  'settings:getAll': { request: z.undefined(), response: settingsSnapshotSchema },
  'settings:set': { request: settingEntrySchema, response: mutationResultSchema(settingEntrySchema) },
  'settings:reset': { request: settingKeyRequestSchema, response: mutationResultSchema(settingEntrySchema) }
} as const

export type ChannelName = keyof typeof CHANNEL_CONTRACTS

/** Mechanically derived from `CHANNEL_CONTRACTS`'s own keys — nothing to keep in sync by hand. */
export const CHANNEL_NAMES = Object.keys(CHANNEL_CONTRACTS) as ChannelName[]

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
