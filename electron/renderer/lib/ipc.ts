import { hashKey } from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { ChannelName, ChannelRequest, ChannelResponse, IpcErrorCode } from '../../shared/ipc-types'

/**
 * `IpcCallError`'s `code`: either `IpcErrorCode` (T-260828-09's envelope,
 * for whatever main actually reported) or `'bridge-unavailable'` — a failure
 * one layer below that, where there was no envelope at all because
 * `window.crm` or `window.crm[channel]` never existed to call (a failed or
 * stale preload). Kept as a local union rather than added to
 * `electron/shared/ipc-types.ts`'s `IpcErrorCode`: that type is main's
 * vocabulary for codes *main* produces; this one is the renderer noticing
 * main was never reachable in the first place.
 */
export type IpcCallErrorCode = IpcErrorCode | 'bridge-unavailable'

/**
 * Thrown by `callCrm` when a `window.crm.*` call resolves to `{ ok: false }`
 * (T-260828-09's `IpcResult` envelope), or when the bridge itself isn't
 * there to call. TanStack Query only has one channel for "this query/
 * mutation failed" — a thrown value, caught into `.error` — so this file's
 * whole job is converting both failure modes into that shape once, here,
 * instead of every `queryFn`/`mutationFn` call site re-deriving `.message`
 * by hand (and some of them forgetting, which is how a component ends up
 * rendering `[object Object]`: React stringifies a plain `{ code, message }`
 * object with `Object.prototype.toString`, not its `.message` field — an
 * `Error` subclass is the one shape React, and every `error instanceof
 * Error` check downstream, already knows how to read).
 */
export class IpcCallError extends Error {
  readonly code: IpcCallErrorCode

  constructor(code: IpcCallErrorCode, message: string) {
    super(message)
    this.name = 'IpcCallError'
    this.code = code
  }
}

/** Shape of a resolved `window.crm[channel](...)` call, loosened to `unknown` for `callCrmImpl`'s internal use. */
interface RawIpcResult {
  readonly ok: boolean
  readonly data?: unknown
  readonly error?: { readonly code: IpcErrorCode; readonly message: string }
}

/**
 * Loosely-typed implementation shared by `callCrm`'s typed overload below and
 * by `ipcQueryFn`/`ipcMutationFn`. TypeScript cannot resolve
 * `undefined extends ChannelRequest<K>` for a still-generic `K` inside a
 * function body (only at a call site where `K` is a literal), so the public,
 * caller-facing signatures below carry the conditional and this one — never
 * exported — does the actual `window.crm` call against `unknown`.
 *
 * Guards both `window.crm` and `window.crm[channel]` before calling either:
 * `CrmApi`'s type says `window.crm[channel]` is always a callable function,
 * but that is a compile-time promise about a normal build, not a runtime
 * guarantee — a preload that failed to load, or a renderer bundle shipped
 * against a registry that dropped a channel, both leave `window.crm` or one
 * of its methods missing. Without this guard that surfaces as a raw
 * `TypeError` ("Cannot read properties of undefined" / "... is not a
 * function"), which breaks this module's one promise: every failure a query
 * or mutation sees is an `IpcCallError`, never something else.
 */
async function callCrmImpl(channel: ChannelName, payload: unknown): Promise<unknown> {
  const method = window.crm?.[channel] as ((payload?: unknown) => Promise<RawIpcResult>) | undefined
  if (typeof method !== 'function') {
    throw new IpcCallError(
      'bridge-unavailable',
      `window.crm['${channel}'] is not available — the preload bridge did not expose this channel.`
    )
  }
  const result = await method(payload)
  if (!result.ok) {
    const error = result.error ?? { code: 'handler-error' as const, message: 'unknown IPC failure' }
    throw new IpcCallError(error.code, error.message)
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
 * `{ ok: false }` or on a missing bridge. This is the one place that
 * conversion happens — `queryFn` and `mutationFn` wrappers below, and any
 * call site that needs the bridge directly, all go through it.
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

/** Rollback context an optimistic update hands from `onMutate` to `onError`. */
export interface OptimisticContext<TData> {
  readonly previous: TData | undefined
}

/**
 * Per-key mutex for `optimisticUpdate`'s full onMutate-through-onSettled
 * cycle — see the long comment on `optimisticUpdate` below for why this
 * exists (TanStack Query's own `scope` option is not enough on its own).
 * Module-level and keyed by `hashKey(queryKey)` so every `optimisticUpdate`
 * call against the same key — regardless of which `useMutation` instance,
 * or which render of it, built the hooks — waits on the same chain.
 */
const optimisticCycleLocks = new Map<string, Promise<void>>()

/**
 * `release` functions for context objects `onMutate` has handed out but
 * whose cycle hasn't been released yet, keyed by the context object's own
 * identity. `onSettled` receives that exact object back from TanStack and
 * uses it to release the next queued mutation's turn — a `WeakMap` rather
 * than a field on `OptimisticContext` so the public context shape callers
 * and tests see (`{ previous }`) stays exactly that, with no internal
 * plumbing leaking into it.
 */
const releaseByContext = new WeakMap<object, () => void>()

/**
 * The `onMutate` / `onError` / `onSettled` triple (plus a mutation `scope`,
 * see below) for one optimistic update against a single query key — spread
 * into `useMutation`'s options alongside `mutationFn: ipcMutationFn(...)`.
 * Requirements §6.6 puts inline quick actions (completing a todo, toggling
 * next-step) on every view; those need to look instant, so the cache is
 * written before the IPC round trip resolves rather than after.
 *
 * - `onMutate` waits its turn on `optimisticCycleLocks` (below), cancels any
 *   in-flight fetch for the key, snapshots the current cached value, writes
 *   the optimistic value, and returns the snapshot as context.
 * - `onError` puts the exact snapshot back if there was one. If there
 *   wasn't — nothing was cached before the optimistic write — it removes
 *   the entry instead of writing `undefined` back: TanStack Query's
 *   `setQueryData(key, undefined)` is a documented no-op (it returns early
 *   rather than clearing the entry), so passing the snapshot through
 *   unconditionally would leave the optimistic value in the cache
 *   permanently on exactly this path. Proven by `ipc.test.ts` and
 *   `query-integration.test.tsx`'s deliberately failing channels — this is
 *   the one path in the whole layer that shows the user something false if
 *   it's wrong, and nobody exercises it by clicking around.
 * - `onSettled` releases this cycle's turn (unblocking the next queued
 *   mutation against this key, if any), then calls the caller-supplied
 *   `reconcile` (see below) and returns its promise, so `mutation.isPending`
 *   stays true through reconciliation rather than flipping to false while a
 *   background invalidation is still in flight.
 *
 * `reconcile` is a required, explicit argument rather than this helper
 * invalidating `queryKey` itself, because a query key's own tuple is
 * usually the wrong thing to invalidate: CONVENTIONS.md's "Query keys"
 * section requires a mutation to invalidate through its entity's
 * `invalidate.<entity>()` helper (`query-keys.ts`) so every sibling key
 * under that entity is covered, not just the one this mutation happened to
 * touch. Pass `invalidate.todos` (once P1-07 adds it), not a closure that
 * re-invalidates the raw `queryKey`.
 *
 * **Why a hand-rolled lock, when TanStack Query already ships `scope`?**
 * `scope: { id }` (still set below) only serializes the underlying
 * `mutationFn` call — query-core's `mutation.js` runs `onMutate`
 * unconditionally, before ever checking whether this mutation's scope can
 * run, and only gates the *retryer* (the actual network call) on that
 * check. Verified empirically while building this: two `useMutation`s
 * sharing a `scope` and firing back to back both ran `onMutate` eagerly —
 * the second one's optimistic write landed on top of the first one's
 * *unsettled* optimistic value before either had made an IPC call. If the
 * first mutation then fails, its `onError` rolls back to *its own*
 * `previous` (captured before it ran), silently erasing the second
 * mutation's still-live optimistic contribution — main never held the
 * value the cache reverts to, and the second mutation's own outcome hasn't
 * even been decided yet. `scope` alone does not prevent this; it only
 * prevents two overlapping in-flight requests. `optimisticCycleLocks` closes
 * the actual gap: a second mutation's `onMutate` does not run — does not
 * even read "previous" — until the first mutation's entire cycle, through
 * its own `onSettled`, has finished. `query-integration.test.tsx`'s
 * concurrent-mutations test proves this end to end with a deliberately
 * held-open write. `scope` is kept alongside it because it is still useful
 * on its own terms — it keeps main from ever seeing two overlapping writes
 * against the same logical resource in flight at once — not because it
 * substitutes for the lock.
 *
 * `TData` is explicit at each call site rather than inferred from
 * `queryKey` via TanStack's `DataTag`/`queryOptions` mechanism: doing that
 * would mean `query-keys.ts`'s factories carry a phantom response type per
 * channel, coupling the entity/scope/id convention 1:1 to
 * `electron/shared/ipc-types.ts`'s channel names — which CONVENTIONS.md's
 * "Query keys" section deliberately keeps decoupled (`scope` is "the
 * channel's own word" by convention, not by type). Declined for this task;
 * worth revisiting once P1-07 gives the factories enough real entities to
 * show whether the coupling is actually worth it.
 */
export function optimisticUpdate<TData, TVariables>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  applyOptimistically: (current: TData | undefined, variables: TVariables) => TData,
  reconcile: (queryClient: QueryClient) => unknown
) {
  const lockKey = hashKey(queryKey)
  return {
    scope: { id: lockKey },
    onMutate: async (variables: TVariables): Promise<OptimisticContext<TData>> => {
      const myTurn = optimisticCycleLocks.get(lockKey) ?? Promise.resolve()
      let release!: () => void
      optimisticCycleLocks.set(
        lockKey,
        new Promise<void>((resolve) => {
          release = resolve
        })
      )
      await myTurn

      try {
        await queryClient.cancelQueries({ queryKey })
        const previous = queryClient.getQueryData<TData>(queryKey)
        queryClient.setQueryData<TData>(queryKey, (current) => applyOptimistically(current, variables))
        const context: OptimisticContext<TData> = { previous }
        releaseByContext.set(context, release)
        return context
      } catch (error) {
        // Nothing to hand a release function to if onMutate itself failed
        // (e.g. cancelQueries rejected) — release this key's turn here
        // instead, or every mutation queued behind this one deadlocks.
        release()
        throw error
      }
    },
    onError: (_error: unknown, _variables: TVariables, context: OptimisticContext<TData> | undefined) => {
      if (!context) return
      if (context.previous === undefined) {
        queryClient.removeQueries({ queryKey, exact: true })
      } else {
        queryClient.setQueryData<TData>(queryKey, context.previous)
      }
    },
    onSettled: (
      _data: unknown,
      _error: unknown,
      _variables: TVariables,
      context: OptimisticContext<TData> | undefined
    ) => {
      if (context) releaseByContext.get(context)?.()
      return reconcile(queryClient)
    }
  }
}
