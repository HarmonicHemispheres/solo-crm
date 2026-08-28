import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { callCrm, IpcCallError, ipcMutationFn, ipcQueryFn, optimisticUpdate, unwrapMutationResult } from './ipc'
import { stubCrm } from './test-support/stub-crm'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assigns.
  delete window.crm
})

describe('callCrm', () => {
  it('resolves with the envelope’s data on { ok: true }', async () => {
    window.crm = stubCrm()

    const result = await callCrm('app:version')

    expect(result).toEqual({ version: '0.1.0' })
  })

  it('throws a typed IpcCallError — never [object Object] — on { ok: false }', async () => {
    window.crm = stubCrm({
      'app:version': vi.fn(async () => ({
        ok: false as const,
        error: { code: 'handler-error' as const, message: 'db:schemaVersion: something went wrong' }
      }))
    })

    await expect(callCrm('app:version')).rejects.toThrow(IpcCallError)
    try {
      await callCrm('app:version')
      expect.unreachable('callCrm should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const ipcError = error as IpcCallError
      // The load-bearing assertion: .message is a real string a component
      // can render directly (`{error.message}`), not the object React
      // (and String()) would otherwise stringify as "[object Object]".
      expect(typeof ipcError.message).toBe('string')
      expect(ipcError.message).toBe('db:schemaVersion: something went wrong')
      expect(String(ipcError.message)).not.toContain('[object Object]')
      expect(ipcError.code).toBe('handler-error')
      expect(ipcError.name).toBe('IpcCallError')
    }
  })

  it('calls the named window.crm method with the given payload', async () => {
    const spy = vi.fn(async () => ({ ok: true as const, data: { version: 1, lastMigrationAt: null } }))
    window.crm = stubCrm({ 'db:schemaVersion': spy })

    await callCrm('db:schemaVersion')

    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(undefined)
  })

  it('throws IpcCallError coded "bridge-unavailable" — not a raw TypeError — when window.crm itself is missing', async () => {
    // @ts-expect-error - simulating a preload that never ran.
    delete window.crm

    await expect(callCrm('app:version')).rejects.toThrow(IpcCallError)
    try {
      await callCrm('app:version')
      expect.unreachable('callCrm should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IpcCallError)
      const ipcError = error as IpcCallError
      expect(ipcError.code).toBe('bridge-unavailable')
      expect(typeof ipcError.message).toBe('string')
      expect(ipcError.message).not.toContain('[object Object]')
      // Never a bare TypeError ("Cannot read properties of undefined") —
      // the one invariant this module guarantees is that every failure a
      // query or mutation observes is an IpcCallError.
      expect(ipcError).not.toBeInstanceOf(TypeError)
    }
  })

  it('throws IpcCallError coded "bridge-unavailable" when window.crm exists but the specific channel does not', async () => {
    // A stale renderer bundle calling a channel a rolled-back main process
    // no longer registers — window.crm exists, this one method doesn't.
    // @ts-expect-error - deliberately building an incomplete CrmApi.
    window.crm = {}

    await expect(callCrm('app:version')).rejects.toThrow(IpcCallError)
    try {
      await callCrm('app:version')
      expect.unreachable('callCrm should have thrown')
    } catch (error) {
      const ipcError = error as IpcCallError
      expect(ipcError.code).toBe('bridge-unavailable')
    }
  })
})

describe('unwrapMutationResult', () => {
  it('returns .data on { ok: true }', () => {
    expect(unwrapMutationResult({ ok: true, data: { id: 'company-1' } })).toEqual({ id: 'company-1' })
  })

  it('throws IpcCallError carrying the repository’s own code and message on { ok: false }', () => {
    try {
      unwrapMutationResult({
        ok: false,
        error: { code: 'refused', message: 'Cannot delete "Acme": 3 activity records reference it.' }
      })
      expect.unreachable('unwrapMutationResult should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(IpcCallError)
      const ipcError = error as IpcCallError
      expect(ipcError.code).toBe('refused')
      expect(ipcError.message).toBe('Cannot delete "Acme": 3 activity records reference it.')
    }
  })
})

describe('ipcQueryFn', () => {
  it('builds a zero-argument function usable as a queryFn', async () => {
    window.crm = stubCrm()

    const queryFn = ipcQueryFn('app:version')
    const result = await queryFn()

    expect(result).toEqual({ version: '0.1.0' })
  })

  it('propagates an envelope error as IpcCallError through the queryFn', async () => {
    window.crm = stubCrm({
      'app:version': vi.fn(async () => ({
        ok: false as const,
        error: { code: 'invalid-response' as const, message: 'bad shape' }
      }))
    })

    const queryFn = ipcQueryFn('app:version')

    await expect(queryFn()).rejects.toThrow(IpcCallError)
  })
})

describe('ipcMutationFn', () => {
  it('builds a single-argument function usable as a mutationFn', async () => {
    const spy = vi.fn(async () => ({ ok: true as const, data: { version: 1, lastMigrationAt: null } }))
    window.crm = stubCrm({ 'db:schemaVersion': spy })

    const mutationFn = ipcMutationFn('db:schemaVersion')
    const result = await mutationFn(undefined)

    expect(result).toEqual({ version: 1, lastMigrationAt: null })
    expect(spy).toHaveBeenCalledWith(undefined)
  })
})

describe('optimisticUpdate', () => {
  it('writes the optimistic value on onMutate and returns the previous value as context', async () => {
    const queryClient = new QueryClient()
    // Each test that calls onMutate uses its own key: the per-key lock
    // ipc.ts's optimisticUpdate now holds from onMutate through onSettled
    // (finding 4) is module-level and keyed by hashKey(queryKey) — a shared
    // literal key across independent unit tests that each call onMutate but
    // never onSettled would leave a later test's onMutate awaiting a lock
    // nobody ever releases. `query-integration.test.tsx`'s dedicated
    // concurrent-mutations test is what proves the lock's actual behavior
    // end to end through a real, fully-settling mutation lifecycle.
    const key = ['db', 'schemaVersion', 'writes-optimistic-test'] as const
    queryClient.setQueryData(key, { version: 1, lastMigrationAt: null })
    const reconcile = vi.fn(async () => undefined)

    const hooks = optimisticUpdate<{ version: number; lastMigrationAt: string | null }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null }),
      reconcile
    )

    const context = await hooks.onMutate(undefined)

    expect(context).toEqual({ previous: { version: 1, lastMigrationAt: null } })
    expect(queryClient.getQueryData(key)).toEqual({ version: 2, lastMigrationAt: null })
  })

  it('serializes concurrent mutations against the same key via a shared mutation scope', () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    const reconcile = vi.fn(async () => undefined)

    const hooksA = optimisticUpdate<{ version: number }, void>(queryClient, key, (c) => ({
      version: (c?.version ?? 0) + 1
    }), reconcile)
    const hooksB = optimisticUpdate<{ version: number }, void>(queryClient, key, (c) => ({
      version: (c?.version ?? 0) + 1
    }), reconcile)

    // Same key -> same scope id, regardless of which call site built the
    // hooks — this is what makes TanStack Query run them one at a time
    // instead of letting a second mutation snapshot the first one's
    // still-unsettled optimistic write as its own "previous".
    expect(hooksA.scope).toEqual(hooksB.scope)
    expect(hooksA.scope.id).toEqual(expect.any(String))
  })

  it('onError rolls back to the exact previous value — run through the real onMutate -> onError cycle, not a hand-built context', async () => {
    const queryClient = new QueryClient()
    // Own key — see the comment on the first onMutate-calling test above for why.
    const key = ['db', 'schemaVersion', 'onerror-rollback-test'] as const
    queryClient.setQueryData(key, { version: 1 })
    const reconcile = vi.fn(async () => undefined)

    const hooks = optimisticUpdate<{ version: number }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      reconcile
    )

    const context = await hooks.onMutate(undefined)
    // The optimistic write actually landed — otherwise the rollback below
    // wouldn't be proving anything.
    expect(queryClient.getQueryData(key)).toEqual({ version: 2 })

    hooks.onError(new IpcCallError('handler-error', 'nope'), undefined, context)

    expect(queryClient.getQueryData(key)).toEqual({ version: 1 })
  })

  it('onError removes the cache entry — not a silent no-op — when there was nothing cached before the optimistic write', async () => {
    const queryClient = new QueryClient()
    // Own key — see the comment on the first onMutate-calling test above for why.
    const key = ['db', 'schemaVersion', 'onerror-removes-test'] as const
    // Nothing set beforehand: queryClient.getQueryData(key) starts undefined.
    const reconcile = vi.fn(async () => undefined)

    const hooks = optimisticUpdate<{ version: number }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      reconcile
    )

    const context = await hooks.onMutate(undefined)
    expect(context).toEqual({ previous: undefined })
    // The optimistic write actually landed.
    expect(queryClient.getQueryData(key)).toEqual({ version: 1 })

    hooks.onError(new IpcCallError('handler-error', 'nope'), undefined, context)

    // The load-bearing assertion the previous version of this test couldn't
    // actually make fail: TanStack's setQueryData(key, undefined) is a
    // documented no-op (query-core's queryClient.js: `if (data === void 0)
    // return`), so if onError ever regresses to calling setQueryData with
    // the (undefined) snapshot instead of removeQueries, this stays
    // { version: 1 } forever instead of going back to nothing.
    expect(queryClient.getQueryData(key)).toBeUndefined()
  })

  it('onError does nothing if onMutate never completed (no context) — there is nothing to roll back', () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    queryClient.setQueryData(key, { version: 5 })
    const reconcile = vi.fn(async () => undefined)
    const hooks = optimisticUpdate<{ version: number }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      reconcile
    )

    hooks.onError(new IpcCallError('handler-error', 'nope'), undefined, undefined)

    expect(queryClient.getQueryData(key)).toEqual({ version: 5 })
  })

  it('onSettled calls and returns the caller-supplied reconcile — not a hardcoded invalidation of the raw key', async () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    const reconcile = vi.fn(async () => 'reconciled')

    const hooks = optimisticUpdate<{ version: number }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      reconcile
    )

    // TanStack always calls onSettled with all four positional arguments
    // (data, error, variables, context) — matching that shape here, even
    // though this test only cares about the reconcile call.
    const result = await hooks.onSettled(undefined, null, undefined, undefined)

    expect(reconcile).toHaveBeenCalledWith(queryClient)
    // Returned (not void) so useMutation's isPending covers reconciliation.
    expect(result).toBe('reconciled')
  })
})
