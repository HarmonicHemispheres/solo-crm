import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { invalidate, queryKeys } from './query-keys'

describe('queryKeys', () => {
  it('builds [entity, scope] tuples for the proof channels', () => {
    expect(queryKeys.app.version()).toEqual(['app', 'version'])
    expect(queryKeys.db.schemaVersion()).toEqual(['db', 'schemaVersion'])
  })

  it('all() is the bare [entity] prefix', () => {
    expect(queryKeys.app.all()).toEqual(['app'])
    expect(queryKeys.db.all()).toEqual(['db'])
  })

  it('every scoped key starts with its entity’s all() prefix — the property invalidate.<entity> relies on', () => {
    expect(queryKeys.app.version().slice(0, queryKeys.app.all().length)).toEqual(queryKeys.app.all())
    expect(queryKeys.db.schemaVersion().slice(0, queryKeys.db.all().length)).toEqual(queryKeys.db.all())
  })
})

describe('invalidate', () => {
  it('invalidate.app invalidates the app entity’s prefix, covering every app-scoped key', () => {
    const queryClient = new QueryClient()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    invalidate.app(queryClient)

    expect(spy).toHaveBeenCalledWith({ queryKey: ['app'] })
  })

  it('invalidate.db invalidates the db entity’s prefix', () => {
    const queryClient = new QueryClient()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    invalidate.db(queryClient)

    expect(spy).toHaveBeenCalledWith({ queryKey: ['db'] })
  })

  it('a prefix invalidation actually marks a longer, real key stale (not just the spy assertion above)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(queryKeys.app.version(), { version: '0.1.0' })

    await invalidate.app(queryClient)

    const state = queryClient.getQueryState(queryKeys.app.version())
    expect(state?.isInvalidated).toBe(true)
  })
})
