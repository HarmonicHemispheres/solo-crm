import { app } from 'electron'
import type { z } from 'zod'
import { getDatabase } from '../db/connection'
import { getSchemaVersion } from '../db/migrate'
import { CHANNEL_CONTRACTS } from '../../shared/ipc-types'
import type { ChannelName } from '../../shared/ipc-types'

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
