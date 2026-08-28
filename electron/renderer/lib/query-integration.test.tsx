import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClientProvider, focusManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createQueryClient } from './query-client'
import { IpcCallError, ipcMutationFn, ipcQueryFn, optimisticUpdate } from './ipc'
import { invalidate, queryKeys } from './query-keys'
import type { CrmApi } from '../../shared/ipc-types'

/**
 * Integration-flavored proof (T-260828-10's acceptance criteria) built
 * against the two real proof channels T-260828-09 shipped —
 * `app:version` / `db:schemaVersion` — with `window.crm` mocked at the
 * boundary the preload bridge itself sits behind. Everything above that
 * boundary (QueryClientProvider, useQuery/useMutation, this file's helpers)
 * is exercised for real; only the IPC call itself is a stub.
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

/** Reads `app:version` through the query-key convention — one of possibly several mounted at once, sharing one cache entry. */
function AppVersionReader({ testId }: { testId: string }) {
  const { data, isPending } = useQuery({ queryKey: queryKeys.app.version(), queryFn: ipcQueryFn('app:version') })
  return <span data-testid={testId}>{isPending ? 'loading' : data?.version}</span>
}

/** Triggers a mutation against `app:version` and invalidates the `app` entity on success — the pattern every entity mutation follows. */
function BumpAppVersionButton() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ipcMutationFn('app:version'),
    onSuccess: () => invalidate.app(queryClient)
  })
  return (
    <button type="button" onClick={() => mutation.mutate(undefined)}>
      bump app:version
    </button>
  )
}

describe('a mutation updates every component reading its key, with no manual refetch', () => {
  it('propagates through invalidation to two independently mounted readers', async () => {
    let calls = 0
    window.crm = stubCrm({
      'app:version': vi.fn(async () => {
        calls += 1
        // Call 1 is the initial shared query fetch; every call after the
        // mutation (its own call, and the refetch invalidate triggers)
        // reflects the "new" value — modelling the mutation having
        // actually changed what main would return.
        return { ok: true as const, data: { version: calls === 1 ? '0.1.0' : '0.2.0' } }
      })
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AppVersionReader testId="reader-a" />
        <AppVersionReader testId="reader-b" />
        <BumpAppVersionButton />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByTestId('reader-a').textContent).toBe('0.1.0'))
    expect(screen.getByTestId('reader-b').textContent).toBe('0.1.0')
    // One channel call served both readers — proof the query-key convention
    // (queryKeys.app.version(), identical for both) is what makes them share
    // a single cache entry rather than each holding its own copy.
    expect(calls).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'bump app:version' }))

    // Neither reader is told to refetch by test code or by each other —
    // only the mutation's own onSuccess -> invalidate.app() call, which
    // TanStack turns into an automatic background refetch of the one active
    // query both readers share.
    await waitFor(() => expect(screen.getByTestId('reader-a').textContent).toBe('0.2.0'))
    await waitFor(() => expect(screen.getByTestId('reader-b').textContent).toBe('0.2.0'))
  })
})

/** Reads `db:schemaVersion`, surfacing a query-level error as `error.message` — never a stringified envelope object. */
function SchemaVersionReader() {
  const { data, error, isPending } = useQuery({
    queryKey: queryKeys.db.schemaVersion(),
    queryFn: ipcQueryFn('db:schemaVersion')
  })
  if (error) {
    return <span data-testid="schema-error">{(error as IpcCallError).message}</span>
  }
  return <span data-testid="schema-version">{isPending ? 'loading' : data?.version}</span>
}

describe('an envelope error reaches the component as a typed error, not [object Object]', () => {
  it('a failing query renders the real message string', async () => {
    window.crm = stubCrm({
      'db:schemaVersion': vi.fn(async () => ({
        ok: false as const,
        error: { code: 'handler-error' as const, message: 'db:schemaVersion: something went wrong' }
      }))
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <SchemaVersionReader />
      </QueryClientProvider>
    )

    const errorNode = await screen.findByTestId('schema-error')
    expect(errorNode.textContent).toBe('db:schemaVersion: something went wrong')
    expect(errorNode.textContent).not.toContain('[object Object]')
    expect(errorNode.textContent).not.toContain('object Object')
  })
})

function BumpSchemaVersionButton() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ipcMutationFn('db:schemaVersion'),
    ...optimisticUpdate<{ version: number; lastMigrationAt: string | null }, undefined>(
      queryClient,
      queryKeys.db.schemaVersion(),
      (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null })
    )
  })
  return (
    <>
      <button type="button" onClick={() => mutation.mutate(undefined)}>
        bump schema
      </button>
      {mutation.error ? <span data-testid="mutation-error">{(mutation.error as IpcCallError).message}</span> : null}
    </>
  )
}

describe('the optimistic-update helper rolls back and surfaces the error on a deliberately failing channel', () => {
  it('shows the optimistic value immediately, then rolls back to the exact prior value when the write fails', async () => {
    type SchemaVersionResult =
      | { ok: true; data: { version: number; lastMigrationAt: string | null } }
      | { ok: false; error: { code: 'handler-error'; message: string } }
    // The mutation's own write (call 2) is held open on a promise this test
    // resolves by hand, rather than resolving immediately — the optimistic
    // write and the failing IPC call are both async, and letting call 2
    // settle on its own timing makes the intermediate optimistic state a
    // race against waitFor's poll interval instead of a deterministic
    // window this test controls.
    let resolveWrite: ((result: SchemaVersionResult) => void) | undefined
    let calls = 0
    window.crm = stubCrm({
      'db:schemaVersion': vi.fn(async () => {
        calls += 1
        if (calls === 2) {
          return new Promise<SchemaVersionResult>((resolve) => {
            resolveWrite = resolve
          })
        }
        // Call 1 (initial read) and call 3 (the reconciliation refetch
        // onSettled's invalidate triggers) both succeed and both report
        // what main actually has — a failed write never persisted, so the
        // post-failure refetch confirming rollback sees the same version 1
        // the initial read did.
        return { ok: true as const, data: { version: 1, lastMigrationAt: null } }
      })
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <SchemaVersionReader />
        <BumpSchemaVersionButton />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('1'))

    fireEvent.click(screen.getByRole('button', { name: 'bump schema' }))

    // Optimistic write lands immediately — before the (still-pending)
    // failing IPC call resolves at all.
    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('2'))
    await waitFor(() => expect(resolveWrite).toBeDefined())

    // Now let the write fail.
    act(() => {
      resolveWrite?.({ ok: false, error: { code: 'handler-error', message: 'schema bump rejected' } })
    })

    // Once the mutationFn rejects, onError rolls the cache back to exactly
    // what it held before the optimistic write...
    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('1'))
    // ...and the mutation's own .error — what useMutation actually caught —
    // is the typed IpcCallError with a real message, surfaced by the
    // component, not a stringified envelope.
    const errorNode = await screen.findByTestId('mutation-error')
    expect(errorNode.textContent).toBe('schema bump rejected')
    expect(errorNode.textContent).not.toContain('[object Object]')
  })

  it('rolls back to undefined (not e.g. 0 or null) when there was nothing cached before the optimistic write', async () => {
    window.crm = stubCrm({
      'db:schemaVersion': vi.fn(async () => ({
        ok: false as const,
        error: { code: 'handler-error' as const, message: 'schema bump rejected' }
      }))
    })

    const queryClient = createQueryClient()
    // No reader mounted — nothing ever populated the cache for this key.
    function OnlyTheButton() {
      const client = useQueryClient()
      const mutation = useMutation({
        mutationFn: ipcMutationFn('db:schemaVersion'),
        ...optimisticUpdate<{ version: number; lastMigrationAt: string | null }, undefined>(
          client,
          queryKeys.db.schemaVersion(),
          (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null })
        )
      })
      return (
        <button type="button" onClick={() => mutation.mutate(undefined)}>
          bump schema
        </button>
      )
    }

    render(
      <QueryClientProvider client={queryClient}>
        <OnlyTheButton />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'bump schema' }))

    await waitFor(() => expect(queryClient.getQueryData(queryKeys.db.schemaVersion())).toBeUndefined())
  })
})

describe('window focus does not trigger a refetch', () => {
  it('regaining window focus after a query has data makes no additional channel call', async () => {
    const spy = vi.fn(async () => ({ ok: true as const, data: { version: '0.1.0' } }))
    window.crm = stubCrm({ 'app:version': spy })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <AppVersionReader testId="reader" />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByTestId('reader').textContent).toBe('0.1.0'))
    expect(spy).toHaveBeenCalledTimes(1)

    try {
      // Simulate the app losing, then regaining, window focus through the
      // same internal path a real alt-tab drives — react-query's own
      // recommended way to test this without depending on jsdom's flaky
      // focus/visibilitychange event emulation.
      act(() => focusManager.setFocused(false))
      act(() => focusManager.setFocused(true))
      // Give any (wrongly) scheduled refetch a chance to actually fire.
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      // Restore focusManager's default (visibilityState-derived) behaviour
      // so this test's forced focus state doesn't leak into later tests.
      focusManager.setFocused(undefined)
    }
  })
})
