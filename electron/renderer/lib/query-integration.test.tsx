import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClientProvider, focusManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createQueryClient } from './query-client'
import { IpcCallError, ipcMutationFn, ipcQueryFn, optimisticUpdate } from './ipc'
import { invalidate, queryKeys } from './query-keys'
import { stubCrm } from './test-support/stub-crm'

/**
 * Integration-flavored proof (T-260828-10's acceptance criteria) built
 * against the two real proof channels T-260828-09 shipped —
 * `app:version` / `db:schemaVersion` — with `window.crm` mocked at the
 * boundary the preload bridge itself sits behind. Everything above that
 * boundary (QueryClientProvider, useQuery/useMutation, this file's helpers)
 * is exercised for real; only the IPC call itself is a stub.
 */

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

/**
 * `data-testid="mutation-status"` mirrors `mutation.status` so tests can
 * `waitFor` the real `'error'` transition before inspecting the cache.
 * TanStack Query's mutation state machine only flips to `'error'` *after*
 * `onError` and `onSettled` have both been awaited (query-core's
 * mutation.js dispatches the `'error'` action last), so waiting for this
 * text is a reliable signal the full rollback has already happened —
 * unlike polling the cache directly, which can observe the pre-mutation
 * state before the (async) `onMutate` has written anything at all.
 */
function BumpSchemaVersionButton() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: ipcMutationFn('db:schemaVersion'),
    ...optimisticUpdate<{ version: number; lastMigrationAt: string | null }, undefined>(
      queryClient,
      queryKeys.db.schemaVersion(),
      (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null }),
      invalidate.db
    )
  })
  return (
    <>
      <button type="button" onClick={() => mutation.mutate(undefined)}>
        bump schema
      </button>
      <span data-testid="mutation-status">{mutation.status}</span>
      {mutation.error ? <span data-testid="mutation-error">{(mutation.error as IpcCallError).message}</span> : null}
    </>
  )
}

describe('the optimistic-update helper rolls back and surfaces the error on a deliberately failing channel', () => {
  it('shows the optimistic value immediately, then rolls back to the exact prior value once the mutation actually reaches error status', async () => {
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

    // Wait for the mutation to actually reach 'error' — proof that
    // onError (and onSettled) have both already run, per mutation.js's
    // dispatch order — before asserting anything about the cache. Asserting
    // the rendered text directly (without this gate) can observe a
    // transient render that happens to already match, which is exactly how
    // the previous version of this test passed against a broken rollback.
    await waitFor(() => expect(screen.getByTestId('mutation-status').textContent).toBe('error'))

    // Once the mutation is in error state, onError has already rolled the
    // cache back to exactly what it held before the optimistic write...
    expect(screen.getByTestId('schema-version').textContent).toBe('1')
    // ...and the mutation's own .error — what useMutation actually caught —
    // is the typed IpcCallError with a real message, surfaced by the
    // component, not a stringified envelope.
    const errorNode = screen.getByTestId('mutation-error')
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
          (current) => ({ version: (current?.version ?? 0) + 1, lastMigrationAt: current?.lastMigrationAt ?? null }),
          invalidate.db
        )
      })
      return (
        <>
          <button type="button" onClick={() => mutation.mutate(undefined)}>
            bump schema
          </button>
          <span data-testid="mutation-status">{mutation.status}</span>
        </>
      )
    }

    render(
      <QueryClientProvider client={queryClient}>
        <OnlyTheButton />
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'bump schema' }))

    // As above: wait for the real 'error' transition — which only happens
    // after onError has run — before reading the cache. A direct
    // `waitFor(() => expect(getQueryData()).toBeUndefined())` can resolve
    // on its very first, synchronous check (before the async onMutate has
    // written anything at all), which is exactly why the earlier version of
    // this test passed even with a broken (no-op) rollback.
    await waitFor(() => expect(screen.getByTestId('mutation-status').textContent).toBe('error'))

    expect(queryClient.getQueryData(queryKeys.db.schemaVersion())).toBeUndefined()
  })
})

/** Two independent buttons, each its own `useMutation`, both optimistically updating the same key — the exact shape of two inline toggles racing on one row (finding 4). */
function DoubleBumpSchemaVersionButtons() {
  const queryClient = useQueryClient()
  const mutationA = useMutation({
    mutationFn: ipcMutationFn('db:schemaVersion'),
    ...optimisticUpdate<{ version: number }, undefined>(
      queryClient,
      queryKeys.db.schemaVersion(),
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      invalidate.db
    )
  })
  const mutationB = useMutation({
    mutationFn: ipcMutationFn('db:schemaVersion'),
    ...optimisticUpdate<{ version: number }, undefined>(
      queryClient,
      queryKeys.db.schemaVersion(),
      (current) => ({ version: (current?.version ?? 0) + 1 }),
      invalidate.db
    )
  })
  return (
    <>
      <button type="button" onClick={() => mutationA.mutate(undefined)}>
        bump A
      </button>
      <button type="button" onClick={() => mutationB.mutate(undefined)}>
        bump B
      </button>
    </>
  )
}

describe('concurrent mutations against the same key do not snapshot each other’s optimistic value', () => {
  it('B does not start (does not run its own onMutate, does not double-apply on top of A’s optimistic write) until A’s cycle has fully settled', async () => {
    let calls = 0
    // Models a real backing store: reads report the current persisted
    // version; writes bump it and then report the new value. Calls
    // alternate read/write/read/write/... in this scenario (1: initial
    // read, 2: A's write, 3: A's reconciliation read, 4: B's write, 5: B's
    // reconciliation read) — an earlier version of this mock hardcoded
    // `version: 2` for every call past the second, which made B's own
    // reconciliation refetch silently overwrite B's optimistic `3` back
    // down to the stale `2` and produced a false failure unrelated to the
    // lock this test actually exists to prove.
    let persistedVersion = 1
    let resolveA: (() => void) | undefined
    window.crm = stubCrm({
      'db:schemaVersion': vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          // SchemaVersionReader's initial read.
          return { ok: true as const, data: { version: persistedVersion, lastMigrationAt: null } }
        }
        if (calls === 2) {
          // Mutation A's own write — held open until this test resolves it,
          // so the window where a race *could* happen is under this test's
          // control rather than a timing accident.
          return new Promise<{ ok: true; data: { version: number; lastMigrationAt: null } }>((resolve) => {
            resolveA = () => {
              persistedVersion += 1
              resolve({ ok: true, data: { version: persistedVersion, lastMigrationAt: null } })
            }
          })
        }
        const isWrite = calls % 2 === 0
        if (isWrite) persistedVersion += 1
        return { ok: true as const, data: { version: persistedVersion, lastMigrationAt: null } }
      })
    })

    const queryClient = createQueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <SchemaVersionReader />
        <DoubleBumpSchemaVersionButtons />
      </QueryClientProvider>
    )

    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('1'))

    // Fire both mutations back to back, before either has had a chance to
    // settle — the exact "two clicks in quick succession" scenario finding
    // 4 is about.
    fireEvent.click(screen.getByRole('button', { name: 'bump A' }))
    fireEvent.click(screen.getByRole('button', { name: 'bump B' }))

    // A's optimistic write lands (1 -> 2).
    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('2'))
    await waitFor(() => expect(resolveA).toBeDefined())

    // While A is still pending (its write call is the one this test is
    // holding open), B must not have touched the cache or run its own
    // mutationFn at all yet — only calls 1 (read) and 2 (A's write) should
    // have happened. ipc.ts's per-key lock is what guarantees this: without
    // it, B's onMutate runs eagerly regardless of A's outcome (query-core
    // only gates the network call on `scope`, not onMutate — see ipc.ts's
    // comment on `optimisticUpdate` for how this was discovered), computing
    // its optimistic value from A's *unsettled* 2 and writing 3 before A has
    // even reached the network.
    expect(calls).toBe(2)
    expect(screen.getByTestId('schema-version').textContent).toBe('2')

    // Let A finish. Only once A's full cycle (mutationFn -> onSuccess ->
    // its onSettled reconciliation refetch, *and* releasing the lock) has
    // completed does B's onMutate even run.
    resolveA?.()

    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(4))
    // B's own optimistic write applied on top of A's *settled* value (2),
    // not on top of A's optimistic pre-settle value — the property the lock
    // serialization exists to guarantee.
    await waitFor(() => expect(screen.getByTestId('schema-version').textContent).toBe('3'))
  })
})

describe('window focus does not trigger a refetch', () => {
  it('regaining window focus does not refetch even when data would immediately be stale — proves refetchOnWindowFocus: false, not staleTime, is what prevents it', async () => {
    const spy = vi.fn(async () => ({ ok: true as const, data: { version: '0.1.0' } }))
    window.crm = stubCrm({ 'app:version': spy })

    const queryClient = createQueryClient()
    // Override staleTime to 0 for this test only. Production's staleTime:
    // Infinity means a query is *never* stale, so a regression that flipped
    // refetchOnWindowFocus to true would still pass this test — there'd be
    // nothing to refetch for regardless of the flag. Zeroing staleTime
    // while keeping every other production default (refetchOnWindowFocus:
    // false among them) means only that flag stands between "focus
    // regained" and a second channel call, so flipping it in
    // query-client.ts actually fails this test.
    queryClient.setDefaultOptions({
      ...queryClient.getDefaultOptions(),
      queries: { ...queryClient.getDefaultOptions().queries, staleTime: 0 }
    })

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
