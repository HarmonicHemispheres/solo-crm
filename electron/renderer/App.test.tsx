import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { QueryClientProviderProps } from '@tanstack/react-query'

/**
 * A smoke test proving `App.tsx` actually wraps its tree in
 * `QueryClientProvider` using `lib/query-client.ts`'s singleton — not just
 * that `App` renders. Removing `<QueryClientProvider>` from `App.tsx` (or
 * pointing it at a different client) fails this test: the spy below
 * replaces the real `QueryClientProvider` with a wrapper that records every
 * `client` it was mounted with, then renders the real one underneath, so
 * `App`'s actual scaffold content still renders normally.
 */
const { queryClientProviderSpy } = vi.hoisted(() => ({ queryClientProviderSpy: vi.fn() }))

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return {
    ...actual,
    QueryClientProvider: (props: QueryClientProviderProps) => {
      queryClientProviderSpy(props.client)
      return <actual.QueryClientProvider {...props} />
    }
  }
})

describe('App', () => {
  it('renders the Phase 0 scaffold inside a QueryClientProvider using the app-wide queryClient singleton', async () => {
    const [{ default: App }, { queryClient }] = await Promise.all([import('./App'), import('./lib/query-client')])

    render(<App />)

    // "the scaffold rendered" — the rail's brand block, which is the first
    // thing App mounts. It was `getByText` until T-260829-06 deleted the
    // `.rail-app` name span the mockup carried and T-260829-07 moved the name
    // onto the brand container, where an operator's own images can replace the
    // wordmark without the block losing its accessible name. Same claim, read
    // off the element that now carries it. `workspace.name` is unset in this
    // harness, so the block falls back to the product name.
    expect(screen.getByRole('img', { name: 'Solo CRM' })).toBeTruthy()
    expect(queryClientProviderSpy).toHaveBeenCalledWith(queryClient)
  })
})
