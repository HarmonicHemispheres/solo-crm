import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ChannelName, ChannelRequest, ChannelResponse, IpcErrorCode } from '../../shared/ipc-types'

/**
 * Thrown by `callCrm` when a `window.crm.*` call resolves to `{ ok: false }`
 * (T-260828-09's `IpcResult` envelope). TanStack Query only has one channel
 * for "this query/mutation failed" — a thrown value, caught into `.error` —
 * so this file's whole job is converting the envelope into that shape once,
 * here, instead of every `queryFn`/`mutationFn` call site re-deriving
 * `.message` from `result.error` by hand (and some of them forgetting, which
 * is how a component ends up rendering `[object Object]`: React stringifies
 * a plain `{ code, message }` object with `Object.prototype.toString`, not
 * its `.message` field — an `Error` subclass is the one shape React, and
 * every `error instanceof Error` check downstream, already knows how to
 * read).
 */
export class IpcCallError extends Error {
  readonly code: IpcErrorCode

  constructor(code: IpcErrorCode, message: string) {
    super(message)
    this.name = 'IpcCallError'
    this.code = code
  }
}

/**
 * Loosely-typed implementation shared by `callCrm`'s typed overload below and
 * by `ipcQueryFn`/`ipcMutationFn`. TypeScript cannot resolve
 * `undefined extends ChannelRequest<K>` for a still-generic `K` inside a
 * function body (only at a call site where `K` is a literal), so the public,
 * caller-facing signatures below carry the conditional and this one — never
 * exported — does the actual `window.crm` call against `unknown`.
 */
async function callCrmImpl(channel: ChannelName, payload: unknown): Promise<unknown> {
  const method = window.crm[channel] as (payload?: unknown) => Promise<
    { ok: true; data: unknown } | { ok: false; error: { code: IpcErrorCode; message: string } }
  >
  const result = await method(payload)
  if (!result.ok) {
    throw new IpcCallError(result.error.code, result.error.message)
  }
  return result.data
}

/** A channel whose request schema accepts `undefined` takes an optional payload — same calling convention as `CrmApi` (electron/shared/ipc-types.ts). */
type CallArgs<K extends ChannelName> = undefined extends ChannelRequest<K>
  ? [payload?: ChannelRequest<K>]
  : [payload: ChannelRequest<K>]

/**
 * Calls a named `window.crm` method and unwraps its `IpcResult` envelope:
 * resolves with `data` on `{ ok: true }`, throws `IpcCallError` on
 * `{ ok: false }`. This is the one place that conversion happens — `queryFn`
 * and `mutationFn` wrappers below, and any call site that needs the bridge
 * directly, all go through it.
 */
export async function callCrm<K extends ChannelName>(channel: K, ...args: CallArgs<K>): Promise<ChannelResponse<K>> {
  return callCrmImpl(channel, args[0]) as Promise<ChannelResponse<K>>
}

/**
 * `queryFn` wrapper: builds the zero-argument function `useQuery` expects,
 * closing over the channel and (if the channel takes one) its payload. Pair
 * with a key from `query-keys.ts` — `useQuery({ queryKey: queryKeys.app.version(), queryFn: ipcQueryFn('app:version') })`.
 */
export function ipcQueryFn<K extends ChannelName>(
  channel: K,
  ...args: CallArgs<K>
): () => Promise<ChannelResponse<K>> {
  return () => callCrmImpl(channel, args[0]) as Promise<ChannelResponse<K>>
}

/**
 * `mutationFn` wrapper: builds the single-argument function `useMutation`
 * expects. Unlike `ipcQueryFn`, the payload arrives when the mutation is
 * triggered (`mutate(payload)`), not when the wrapper is built, so this
 * takes only the channel name.
 */
export function ipcMutationFn<K extends ChannelName>(
  channel: K
): (payload: ChannelRequest<K>) => Promise<ChannelResponse<K>> {
  return (payload) => callCrmImpl(channel, payload) as Promise<ChannelResponse<K>>
}

/** Rollback context an optimistic update hands from `onMutate` to `onError`/`onSettled`. */
export interface OptimisticContext<TData> {
  readonly previous: TData | undefined
}

/**
 * The `onMutate` / `onError` / `onSettled` triple for one optimistic update
 * against a single query key — spread into `useMutation`'s options alongside
 * `mutationFn: ipcMutationFn(...)`. Requirements §6.6 puts inline quick
 * actions (completing a todo, toggling next-step) on every view; those need
 * to look instant, so the cache is written before the IPC round trip
 * resolves rather than after.
 *
 * - `onMutate` cancels any in-flight fetch for the key (so a slower request
 *   already in flight can't land after and clobber the optimistic write),
 *   snapshots the current cached value, writes the optimistic value, and
 *   returns the snapshot as context.
 * - `onError` puts the exact snapshot back — proven by
 *   `optimistic.test.ts`'s deliberately failing channel, since this is the
 *   one path in the whole layer that shows the user something false if it's
 *   wrong and nobody exercises it by clicking around.
 * - `onSettled` invalidates the key so the cache reconciles with whatever
 *   main actually persisted, on both success and failure. `useMutation`
 *   itself still records the rejected `mutationFn`'s error as `.error` —
 *   an `IpcCallError` (typed, with a real `.message`), so a component
 *   watching the mutation can surface it without this helper doing anything
 *   extra.
 */
export function optimisticUpdate<TData, TVariables>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  applyOptimistically: (current: TData | undefined, variables: TVariables) => TData
) {
  return {
    onMutate: async (variables: TVariables): Promise<OptimisticContext<TData>> => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<TData>(queryKey)
      queryClient.setQueryData<TData>(queryKey, (current) => applyOptimistically(current, variables))
      return { previous }
    },
    onError: (_error: unknown, _variables: TVariables, context: OptimisticContext<TData> | undefined) => {
      queryClient.setQueryData<TData>(queryKey, context?.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey })
    }
  }
}
