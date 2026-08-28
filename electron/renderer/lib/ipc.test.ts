import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { callCrm, IpcCallError, ipcMutationFn, ipcQueryFn, optimisticUpdate } from './ipc'
import type { CrmApi } from '../../shared/ipc-types'

/**
 * A minimal but fully-typed `CrmApi` stub — every test below overrides just
 * the channel(s) it cares about, so a channel added later that this file
 * doesn't know about still leaves every existing test compiling and passing.
 */
function stubCrm(overrides: Partial<CrmApi> = {}): CrmApi {
  return {
    'app:version': vi.fn(async () => ({ ok: true as const, data: { version: '0.1.0' } })),
    'db:schemaVersion': vi.fn(async () => ({ ok: true as const, data: { version: 1, lastMigrationAt: null } })),
    ...overrides
  }
}

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
    const key = ['db', 'schemaVersion'] as const
    queryClient.setQueryData(key, { version: 1, lastMigrationAt: null })

    const hooks = optimisticUpdate<{ version: number; lastMigrationAt: string | null }, void>(
      queryClient,
      key,
      (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null })
    )

    const context = await hooks.onMutate(undefined)

    expect(context).toEqual({ previous: { version: 1, lastMigrationAt: null } })
    expect(queryClient.getQueryData(key)).toEqual({ version: 2, lastMigrationAt: null })
  })

  it('rolls back to the exact previous value on onError — the failure path this helper exists to prove', () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    const hooks = optimisticUpdate<{ version: number }, void>(queryClient, key, (current) => ({
      version: (current?.version ?? 0) + 1
    }))

    hooks.onError(new IpcCallError('handler-error', 'nope'), undefined, { previous: { version: 1 } })

    expect(queryClient.getQueryData(key)).toEqual({ version: 1 })
  })

  it('rolls back to undefined when there was nothing cached before the optimistic write', () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    const hooks = optimisticUpdate<{ version: number }, void>(queryClient, key, () => ({ version: 1 }))

    hooks.onError(new IpcCallError('handler-error', 'nope'), undefined, { previous: undefined })

    expect(queryClient.getQueryData(key)).toBeUndefined()
  })

  it('invalidates the key onSettled so the cache reconciles with main', () => {
    const queryClient = new QueryClient()
    const key = ['db', 'schemaVersion'] as const
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const hooks = optimisticUpdate<{ version: number }, void>(queryClient, key, (current) => ({
      version: (current?.version ?? 0) + 1
    }))

    hooks.onSettled()

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: key })
  })
})
