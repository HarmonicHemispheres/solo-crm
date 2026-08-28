import { describe, expect, it } from 'vitest'
import { createQueryClient, queryClient } from './query-client'

/**
 * Proves the deliberate tuning CONVENTIONS.md's "Query cache" section
 * documents actually lands in the `QueryClient` the app builds — a good
 * comment and a wrong config value would both read fine in a diff.
 */
describe('createQueryClient', () => {
  it('sets staleTime to Infinity — correctness comes from explicit invalidation, not a clock', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.staleTime).toBe(Infinity)
  })

  it('disables window-focus and reconnect refetching — there is no network to have reconnected to', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
    expect(client.getDefaultOptions().queries?.refetchOnReconnect).toBe(false)
  })

  it('disables retries for both queries and mutations — a local IPC failure is not a transient network blip', () => {
    const client = createQueryClient()
    expect(client.getDefaultOptions().queries?.retry).toBe(false)
    expect(client.getDefaultOptions().mutations?.retry).toBe(false)
  })

  it('returns a fresh instance each call, so tests never share cache state', () => {
    const a = createQueryClient()
    const b = createQueryClient()
    expect(a).not.toBe(b)
  })
})

describe('queryClient', () => {
  it('is the app-wide singleton built from the same deliberate defaults', () => {
    expect(queryClient.getDefaultOptions().queries?.staleTime).toBe(Infinity)
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false)
  })
})
