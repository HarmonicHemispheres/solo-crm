import { app } from 'electron'
import type { z } from 'zod'
import { getDatabase } from '../db/connection'
import { getSchemaVersion } from '../db/migrate'
import { runReadOnlyQuery } from '../db/readonly-connection'
import {
  addAffiliation,
  createPerson,
  deletePerson,
  endAffiliation,
  getPerson,
  listPeople,
  movePerson,
  updateAffiliation,
  updatePerson
} from '../db/repositories/people'
import { createCompany, deleteCompany, getCompany, listCompanies, updateCompany } from '../db/repositories/companies'
import {
  createEngagement,
  deleteEngagement,
  getEngagement,
  listEngagements,
  listMilestones,
  updateEngagement
} from '../db/repositories/engagements'
import {
  countOpenTasks,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  setNextStep,
  updateTask
} from '../db/repositories/tasks'
import { getActivity, listActivity, logActivity } from '../db/repositories/activity'
import { searchAll } from '../db/repositories/search'
import { addLink, deleteLink, listLinks, updateLink } from '../db/repositories/links'
import { getFavicon } from '../favicons'
import { getAllSettings, getSetting, resetSetting, setSetting } from '../db/repositories/settings'
import type { SettingKey } from '../db/repositories/settings'
import { RefusalError, RepositoryError } from '../db/repositories/errors'
import { CHANNEL_CONTRACTS } from '../../shared/ipc-types'
import type { ChannelName, RepositoryErrorBlocker, RepositoryErrorCode, SettingEntry } from '../../shared/ipc-types'

/**
 * The typed IPC bridge's behaviour (T-260828-09): one handler per channel,
 * composed with the wire contract `electron/shared/ipc-types.ts` declares
 * (name + request/response schema). Adding a channel is one entry in each
 * of those two files, not four: `electron/main/ipc/index.ts` binds whatever
 * is in `registry` below in a generic loop, and `electron/preload/index.ts`
 * builds `window.crm` in a generic loop over `CHANNEL_NAMES` — neither
 * changes when a channel is added.
 *
 * It is two files, not one, because it has to be: `electron/shared/ipc-types.ts`'s
 * header comment explains the concrete `tsc` error (TS6307) that rules out
 * folding the wire contract and the handler into a single file — this
 * module reaches `getDatabase()`, which is main-only, so it cannot sit
 * anywhere `electron/shared/**` (typechecked under both tsconfig.node.json
 * and tsconfig.web.json) could reference even as a type. `satisfies
 * Record<ChannelName, ChannelDefinition>` below is the compile-time half of
 * keeping the two in sync — a channel added to the shared contract without
 * a matching handler here fails `tsc`; `registry.test.ts` is the runtime
 * half, asserting `Object.keys(registry)` against `CHANNEL_NAMES` directly.
 */

export interface ChannelDefinition<Req extends z.ZodTypeAny = z.ZodTypeAny, Res extends z.ZodTypeAny = z.ZodTypeAny> {
  readonly request: Req
  readonly response: Res
  readonly handler: (payload: z.infer<Req>) => z.infer<Res> | Promise<z.infer<Res>>
}

/**
 * Identity helper: keeps each entry's specific Req/Res types (rather than
 * the widened `ChannelDefinition<z.ZodTypeAny, ...>` the `satisfies` target
 * below would otherwise contextually impose) available for the handler's
 * parameter and return types. Exported so index.test.ts's synthetic
 * registries (the `registerIpcHandlers` `registryOverride` parameter's
 * whole reason for existing) get the same per-entry inference real channels
 * do.
 */
export function defineChannel<Req extends z.ZodTypeAny, Res extends z.ZodTypeAny>(
  definition: ChannelDefinition<Req, Res>
): ChannelDefinition<Req, Res> {
  return definition
}

/**
 * Every mutating channel's handler body: run `fn`, and if it throws a
 * `RepositoryError` (NotFoundError/ValidationError/RefusalError —
 * `db/repositories/errors.ts`), catch it and return it as *data* shaped
 * like `electron/shared/ipc-types.ts`'s `mutationResultSchema` rather than
 * letting it reach `index.ts`'s generic `catch` — `ipc-types.ts`'s header
 * comment explains why: `index.ts` (out of this task's scope) discards a
 * thrown error's `.message` entirely, replacing it with a fixed sentence,
 * which would silently swallow a refusal's human-written reason. Anything
 * that is NOT a `RepositoryError` — a genuine bug — is rethrown unchanged,
 * so it still reaches `index.ts`'s `handler-error` path exactly as before:
 * logged loudly in main, reported to the renderer as a generic sentence,
 * never as a stack trace or a filesystem path.
 *
 * Review fix (item 3): a `RefusalError`'s `.blocker` — `{ reason, count? }`,
 * set by every throw site in `referential-guard.ts` and every repository's
 * own constraint-translation table — used to stop here, copied onto neither
 * the envelope nor anything a caller could branch on. Carried through now,
 * alongside `.code`/`.message`, so a renderer can tell an
 * activity-history refusal from an engagement-reference one, or show the
 * blocking row count, without parsing the prose sentence. Only a
 * `RefusalError` ever sets `blocker` — `NotFoundError`/`ValidationError`
 * never do — so the field is omitted, not sent as `undefined`, for either
 * of those two.
 */
function runMutation<Data>(
  fn: () => Data
): { ok: true; data: Data } | { ok: false; error: { code: RepositoryErrorCode; message: string; blocker?: RepositoryErrorBlocker } } {
  try {
    return { ok: true, data: fn() }
  } catch (error) {
    if (error instanceof RepositoryError) {
      const blocker = error instanceof RefusalError ? error.blocker : undefined
      return {
        ok: false,
        error: blocker ? { code: error.code, message: error.message, blocker } : { code: error.code, message: error.message }
      }
    }
    throw error
  }
}

/**
 * `getSetting`/`resetSetting` are generic over `K extends SettingKey`
 * (`db/repositories/settings.ts`) so a caller with a literal key gets back
 * exactly that key's value type. A channel handler's `key` has already
 * widened to the full `SettingKey` union by the time it is destructured
 * from a validated payload — the same widening `settings.ts`'s own
 * `getAllSettings` documents on its return-cast ("TypeScript cannot narrow
 * `out[key] = getSetting(db, key)` back to the specific `K`... The cast on
 * return is the one place that fact is asserted"). This helper is that one
 * place for the IPC layer: the pairing is a real runtime invariant (the
 * registry itself declared this key, one call up), just not one this
 * generic call shape can express to `tsc`.
 */
function readSettingEntry(db: ReturnType<typeof getDatabase>, key: SettingKey): SettingEntry {
  return { key, value: getSetting(db, key) } as SettingEntry
}

export const registry = {
  'app:version': defineChannel({
    ...CHANNEL_CONTRACTS['app:version'],
    handler: () => ({ version: app.getVersion() })
  }),

  /**
   * X-01's "schema version and last migration date" — reads straight
   * through `getSchemaVersion(getDatabase())` (T-260828-07's runner). The
   * second proof channel: adding it touched only this entry and its
   * one-line companion in `electron/shared/ipc-types.ts`'s CHANNEL_CONTRACTS.
   */
  'db:schemaVersion': defineChannel({
    ...CHANNEL_CONTRACTS['db:schemaVersion'],
    handler: () => getSchemaVersion(getDatabase())
  }),

  /**
   * X-02's read-only query channel (T-260828-39) — the single most
   * dangerous channel in the app, because it takes SQL from the renderer.
   *
   * Note what this handler does *not* do: it never calls `getDatabase()`.
   * `runReadOnlyQuery` owns its own connection — a second one, opened
   * readonly against the same file — so the write handle every other
   * handler in this file reaches for is out of this channel's reach by
   * construction rather than by anybody remembering not to pass it.
   * `readonly-connection.test.ts` asserts that structurally.
   *
   * Refusals come back inside the response as `{ ok: false, error }`, the
   * same shape and for the same reason as `runMutation`'s above: `index.ts`
   * would otherwise replace "this statement modifies the database" with a
   * generic sentence, and §6.12 requires a refusal to name its grounds.
   * Nothing is thrown here, so nothing reaches that path.
   */
  'db:query': defineChannel({
    ...CHANNEL_CONTRACTS['db:query'],
    handler: ({ statement, params }) => runReadOnlyQuery(statement, params)
  }),

  // ---------------------------------------------------------------------
  // companies
  // ---------------------------------------------------------------------

  'companies:list': defineChannel({
    ...CHANNEL_CONTRACTS['companies:list'],
    handler: () => listCompanies(getDatabase())
  }),
  'companies:get': defineChannel({
    ...CHANNEL_CONTRACTS['companies:get'],
    handler: ({ id }) => getCompany(getDatabase(), id)
  }),
  'companies:create': defineChannel({
    ...CHANNEL_CONTRACTS['companies:create'],
    handler: (input) => runMutation(() => createCompany(getDatabase(), input))
  }),
  'companies:update': defineChannel({
    ...CHANNEL_CONTRACTS['companies:update'],
    handler: ({ id, patch }) => runMutation(() => updateCompany(getDatabase(), id, patch))
  }),
  'companies:delete': defineChannel({
    ...CHANNEL_CONTRACTS['companies:delete'],
    handler: ({ id }) =>
      runMutation(() => {
        deleteCompany(getDatabase(), id)
        return { id }
      })
  }),

  // ---------------------------------------------------------------------
  // people + affiliations
  // ---------------------------------------------------------------------

  'people:list': defineChannel({
    ...CHANNEL_CONTRACTS['people:list'],
    handler: () => listPeople(getDatabase())
  }),
  'people:get': defineChannel({
    ...CHANNEL_CONTRACTS['people:get'],
    handler: ({ id }) => getPerson(getDatabase(), id)
  }),
  'people:create': defineChannel({
    ...CHANNEL_CONTRACTS['people:create'],
    handler: (input) => runMutation(() => createPerson(getDatabase(), input))
  }),
  'people:update': defineChannel({
    ...CHANNEL_CONTRACTS['people:update'],
    handler: ({ id, patch }) => runMutation(() => updatePerson(getDatabase(), id, patch))
  }),
  'people:delete': defineChannel({
    ...CHANNEL_CONTRACTS['people:delete'],
    handler: ({ id }) =>
      runMutation(() => {
        deletePerson(getDatabase(), id)
        return { id }
      })
  }),
  'people:addAffiliation': defineChannel({
    ...CHANNEL_CONTRACTS['people:addAffiliation'],
    handler: (input) => runMutation(() => addAffiliation(getDatabase(), input))
  }),
  'people:updateAffiliation': defineChannel({
    ...CHANNEL_CONTRACTS['people:updateAffiliation'],
    handler: ({ id, patch }) => runMutation(() => updateAffiliation(getDatabase(), id, patch))
  }),
  'people:endAffiliation': defineChannel({
    ...CHANNEL_CONTRACTS['people:endAffiliation'],
    handler: ({ id, endedOn }) => runMutation(() => endAffiliation(getDatabase(), id, endedOn))
  }),
  'people:move': defineChannel({
    ...CHANNEL_CONTRACTS['people:move'],
    handler: ({ personId, toCompanyId, options }) => runMutation(() => movePerson(getDatabase(), personId, toCompanyId, options))
  }),

  // ---------------------------------------------------------------------
  // engagements + milestones
  // ---------------------------------------------------------------------

  'engagements:list': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:list'],
    handler: (filter) => listEngagements(getDatabase(), filter ?? {})
  }),
  'engagements:get': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:get'],
    handler: ({ id }) => getEngagement(getDatabase(), id)
  }),
  'engagements:milestones': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:milestones'],
    handler: ({ engagementId }) => listMilestones(getDatabase(), engagementId)
  }),
  'engagements:create': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:create'],
    handler: (input) => runMutation(() => createEngagement(getDatabase(), input))
  }),
  'engagements:update': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:update'],
    handler: ({ id, patch }) => runMutation(() => updateEngagement(getDatabase(), id, patch))
  }),
  'engagements:delete': defineChannel({
    ...CHANNEL_CONTRACTS['engagements:delete'],
    handler: ({ id }) =>
      runMutation(() => {
        deleteEngagement(getDatabase(), id)
        return { id }
      })
  }),

  // ---------------------------------------------------------------------
  // tasks
  // ---------------------------------------------------------------------

  'tasks:list': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:list'],
    handler: (filter) => listTasks(getDatabase(), filter)
  }),
  'tasks:get': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:get'],
    handler: ({ id }) => getTask(getDatabase(), id)
  }),
  'tasks:create': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:create'],
    handler: (input) => runMutation(() => createTask(getDatabase(), input))
  }),
  'tasks:update': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:update'],
    handler: ({ id, patch }) => runMutation(() => updateTask(getDatabase(), id, patch))
  }),
  'tasks:delete': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:delete'],
    handler: ({ id }) =>
      runMutation(() => {
        deleteTask(getDatabase(), id)
        return { id }
      })
  }),
  'tasks:setNextStep': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:setNextStep'],
    handler: ({ id }) => runMutation(() => setNextStep(getDatabase(), id))
  }),
  'tasks:countOpen': defineChannel({
    ...CHANNEL_CONTRACTS['tasks:countOpen'],
    handler: (filter) => ({ count: countOpenTasks(getDatabase(), filter) })
  }),

  // ---------------------------------------------------------------------
  // activity — G8: list, get, log. No update, no delete handler exists to add.
  // ---------------------------------------------------------------------

  'activity:list': defineChannel({
    ...CHANNEL_CONTRACTS['activity:list'],
    handler: (filters) => listActivity(getDatabase(), filters)
  }),
  'activity:get': defineChannel({
    ...CHANNEL_CONTRACTS['activity:get'],
    handler: ({ id }) => getActivity(getDatabase(), id)
  }),
  'activity:log': defineChannel({
    ...CHANNEL_CONTRACTS['activity:log'],
    handler: (input) => runMutation(() => logActivity(getDatabase(), input))
  }),

  // ---------------------------------------------------------------------
  // search — the command palette's one read (T-260828-37).
  // ---------------------------------------------------------------------

  /**
   * `searchAll` over `search_fts` (T-260828-36, reshaped by T-260828-51 —
   * `search_source` is a materialised table now, so this is a rowid seek and
   * not a five-table rescan per returned row; `search.latency.test.ts` holds
   * the budget).
   *
   * No `runMutation` wrapper: this is a read, and the one input it can be
   * given that has no answer — a query with no searchable tokens — is
   * `[]` from the repository rather than a thrown `RepositoryError`
   * (`search.ts`'s own contract). Nothing here has a refusal to carry back
   * as data.
   *
   * The whole validated payload is passed straight through: `searchAll`
   * takes `input: unknown` and re-parses it against the same
   * `searchQueryInputSchema` this channel's request schema *is* — one
   * schema, applied on both sides of the call, not a second transcription
   * of the query's shape.
   */
  'search:query': defineChannel({
    ...CHANNEL_CONTRACTS['search:query'],
    handler: (input) => searchAll(getDatabase(), input)
  }),

  // ---------------------------------------------------------------------
  // links — T-260828-48's polymorphic repository, reached from a view for
  // the first time by T-260828-50.
  // ---------------------------------------------------------------------
  //
  // Every handler passes its already-validated payload straight through to
  // the repository, which re-parses it against the same shared schema this
  // channel's `request` *is* — one schema applied on both sides of the call,
  // the same shape `search:query` above already follows. Nothing here
  // derives a `kind`, defaults a title, or normalises a URL: all three are
  // `addLink`'s job, and doing any of them here would be a second copy that
  // could disagree with the stored column.

  'links:list': defineChannel({
    ...CHANNEL_CONTRACTS['links:list'],
    handler: (input) => listLinks(getDatabase(), input)
  }),
  'links:add': defineChannel({
    ...CHANNEL_CONTRACTS['links:add'],
    handler: (input) => runMutation(() => addLink(getDatabase(), input))
  }),
  'links:update': defineChannel({
    ...CHANNEL_CONTRACTS['links:update'],
    handler: ({ id, patch }) => runMutation(() => updateLink(getDatabase(), id, patch))
  }),
  'links:delete': defineChannel({
    ...CHANNEL_CONTRACTS['links:delete'],
    handler: ({ id }) =>
      runMutation(() => {
        deleteLink(getDatabase(), id)
        return { id }
      })
  }),

  // ---------------------------------------------------------------------
  // favicons — the cache read (T-260828-49).
  // ---------------------------------------------------------------------

  /**
   * Note what this handler is not: it is not `async`, and it does not await a
   * fetch. `getFavicon` reads the `favicons` table, answers from it, and — if
   * this host has nothing cached and is not inside its retry window — starts
   * one background fetch it does not wait for. A company page with twelve
   * links therefore gets twelve immediate answers rather than twelve
   * outstanding network requests, and gets them offline as readily as online
   * (this task's Risks: "Fetching on render").
   *
   * No `runMutation` wrapper, and nothing to catch: every way this can fail —
   * an unfetchable URL, a dead host, a response that is not an image — is
   * already a `{ state: 'none', reason }` branch of the answer rather than a
   * thrown `RepositoryError`. "There is no icon" is a normal result here, not
   * a refusal.
   */
  'favicons:get': defineChannel({
    ...CHANNEL_CONTRACTS['favicons:get'],
    handler: ({ url }) => getFavicon(getDatabase(), url)
  }),

  // ---------------------------------------------------------------------
  // settings — one row per declared key (ADR-002), not create/update/delete.
  // ---------------------------------------------------------------------

  'settings:get': defineChannel({
    ...CHANNEL_CONTRACTS['settings:get'],
    handler: ({ key }) => readSettingEntry(getDatabase(), key)
  }),
  'settings:getAll': defineChannel({
    ...CHANNEL_CONTRACTS['settings:getAll'],
    handler: () => getAllSettings(getDatabase())
  }),
  'settings:set': defineChannel({
    ...CHANNEL_CONTRACTS['settings:set'],
    handler: (entry) =>
      runMutation(() => {
        const db = getDatabase()
        setSetting(db, entry.key, entry.value)
        return readSettingEntry(db, entry.key)
      })
  }),
  'settings:reset': defineChannel({
    ...CHANNEL_CONTRACTS['settings:reset'],
    handler: ({ key }) =>
      runMutation(() => {
        resetSetting(getDatabase(), key)
        return readSettingEntry(getDatabase(), key)
      })
  })
  // Mapped over the contract's own schema types, not the default-widened
  // ChannelDefinition: a bare Record<ChannelName, ChannelDefinition> couples
  // only the channel SET, so an entry spreading the wrong contract (or
  // redefining a schema) would typecheck while renderer and main disagree on
  // the wire shape (T-260828-09 review, should-fix 1).
} satisfies {
  [K in ChannelName]: ChannelDefinition<
    (typeof CHANNEL_CONTRACTS)[K]['request'],
    (typeof CHANNEL_CONTRACTS)[K]['response']
  >
}

export type Registry = typeof registry
