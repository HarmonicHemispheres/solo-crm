import { QueryClient } from '@tanstack/react-query'

/**
 * TanStack Query's defaults assume a flaky network: retry with backoff,
 * refetch on window focus, refetch on reconnect. None of that applies here —
 * `window.crm.*` (T-260828-09) is a synchronous local SQLite database read
 * through IPC, not a server across a network. Left at the defaults, every
 * alt-tab back into the app would silently redo work that looks, from the
 * profiler, like a performance problem (this task's Risks section) rather
 * than the pointless IPC traffic it actually is. Every knob below is set
 * deliberately, not left implicit — see CONVENTIONS.md's "Query cache" section
 * for the reasoning restated next to the query-key convention.
 *
 * `createQueryClient` is a factory rather than a bare singleton so tests can
 * build an isolated client per test (no cache bleeding between tests that
 * both touch the app:version / db:schemaVersion proof channels) while
 * `queryClient` below remains the one instance the running app actually uses.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // staleTime: Infinity — see CONVENTIONS.md ("Query cache"). The only
        // writer to this cache is this app's own mutations, and every one of
        // them names what it invalidates (query-keys.ts's invalidate
        // helpers). There is nothing else that changes the data out from
        // under a mounted query, so time-based staleness has no job to do;
        // correctness comes from explicit invalidation, not from a clock.
        staleTime: Infinity,
        // No window-focus refetch: alt-tabbing back into an Electron app
        // window is not "the network might have changed since I looked
        // away" — nothing else is writing to the SQLite file underneath it.
        refetchOnWindowFocus: false,
        // No reconnect refetch: there is no network connection to lose or
        // regain. `navigator.onLine` flapping (real on some OSes even fully
        // offline) must not trigger a refetch cascade.
        refetchOnReconnect: false,
        // No retries: an IPC call to the local main process either succeeds
        // or fails for a reason (invalid request, invalid response, a
        // repository throwing) that retrying does not fix — see
        // electron/shared/ipc-types.ts's IpcErrorCode. Retrying would just
        // delay the typed error this task's queryFn wrapper throws.
        retry: false
      },
      mutations: {
        // Same reasoning as queries: a mutation against window.crm either
        // succeeds or returns/throws a typed error; retrying a write blind
        // risks doing it twice.
        retry: false
      }
    }
  })
}

/** The QueryClient the running app provides via App.tsx's QueryClientProvider. */
export const queryClient = createQueryClient()
