import { z } from 'zod'
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
 */

const schemaVersionResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  lastMigrationAt: timestampSchema.nullable()
})

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
  }
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
