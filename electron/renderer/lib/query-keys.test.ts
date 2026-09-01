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

describe('queryKeys — T-260828-26 entities', () => {
  it('list()/detail(id) follow the [entity, scope, id?] shape and start with all()', () => {
    expect(queryKeys.companies.all()).toEqual(['companies'])
    expect(queryKeys.companies.list()).toEqual(['companies', 'list'])
    expect(queryKeys.companies.detail('c1')).toEqual(['companies', 'detail', 'c1'])

    expect(queryKeys.people.detail('p1')).toEqual(['people', 'detail', 'p1'])
    expect(queryKeys.engagements.detail('e1')).toEqual(['engagements', 'detail', 'e1'])
    expect(queryKeys.engagements.milestones('e1')).toEqual(['engagements', 'milestones', 'e1'])
    expect(queryKeys.tasks.detail('t1')).toEqual(['tasks', 'detail', 't1'])
    expect(queryKeys.tasks.countOpen()).toEqual(['tasks', 'countOpen'])
    expect(queryKeys.activity.detail('a1')).toEqual(['activity', 'detail', 'a1'])
    expect(queryKeys.settings.detail('workspace.name')).toEqual(['settings', 'detail', 'workspace.name'])
  })

  it('every scoped key starts with its entity’s all() prefix', () => {
    for (const entity of ['companies', 'people', 'engagements', 'offerings', 'tasks', 'activity', 'settings'] as const) {
      const all = queryKeys[entity].all()
      const detail = queryKeys[entity].detail('x')
      expect(detail.slice(0, all.length)).toEqual(all)
    }
  })

  it('G8: no activity key beyond list/detail plus the read scopes — no update or delete scope exists to key', () => {
    // byCompany/byPerson/byEngagement (T-260828-30 and -31) are additional
    // *read* scopes, not mutating ones. G8's constraint is that no update or
    // delete scope exists to key, which this list still holds — a new entry
    // here has to be justified as a read.
    expect(Object.keys(queryKeys.activity).sort()).toEqual(['all', 'byCompany', 'byEngagement', 'byPerson', 'detail', 'list'])
  })

  it('T-260901-07: offerings keys follow the shape, and the filtered list is a distinct entry from the unfiltered one', () => {
    expect(queryKeys.offerings.all()).toEqual(['offerings'])
    expect(queryKeys.offerings.detail('o1')).toEqual(['offerings', 'detail', 'o1'])
    expect(queryKeys.offerings.categories()).toEqual(['offerings', 'categories'])

    // `list()` and `list({})` address one entry, the same collapse
    // `activity.list` performs — otherwise a view that passes an empty filter
    // object and one that passes nothing would each fetch their own copy.
    expect(queryKeys.offerings.list()).toEqual(['offerings', 'list'])
    expect(queryKeys.offerings.list({})).toEqual(['offerings', 'list'])
    expect(queryKeys.offerings.list({ active: true })).toEqual(['offerings', 'list', { active: true }])
    expect(queryKeys.offerings.list({ type: 'service' })).not.toEqual(queryKeys.offerings.list({ type: 'product' }))

    for (const key of [
      queryKeys.offerings.list(),
      queryKeys.offerings.list({ active: true }),
      queryKeys.offerings.detail('o1'),
      queryKeys.offerings.categories()
    ]) {
      expect(key.slice(0, queryKeys.offerings.all().length)).toEqual(queryKeys.offerings.all())
    }
  })

  it('T-260828-30: tasks.byCompany and activity.byCompany/byPerson/byEngagement follow [entity, scope, id] and start with all()', () => {
    expect(queryKeys.tasks.byCompany('c1')).toEqual(['tasks', 'byCompany', 'c1'])
    expect(queryKeys.tasks.byCompany('c1').slice(0, queryKeys.tasks.all().length)).toEqual(queryKeys.tasks.all())

    expect(queryKeys.activity.byCompany('c1')).toEqual(['activity', 'byCompany', 'c1'])
    expect(queryKeys.activity.byPerson('p1')).toEqual(['activity', 'byPerson', 'p1'])
    expect(queryKeys.activity.byEngagement('e1')).toEqual(['activity', 'byEngagement', 'e1'])
    for (const key of [queryKeys.activity.byCompany('c1'), queryKeys.activity.byPerson('p1'), queryKeys.activity.byEngagement('e1')]) {
      expect(key.slice(0, queryKeys.activity.all().length)).toEqual(queryKeys.activity.all())
    }
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

  it('invalidate.<entity> invalidates each T-260828-26 entity’s own prefix, not another entity’s', () => {
    const queryClient = new QueryClient()
    const spy = vi.spyOn(queryClient, 'invalidateQueries')

    invalidate.companies(queryClient)
    invalidate.tasks(queryClient)

    expect(spy).toHaveBeenCalledWith({ queryKey: ['companies'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(spy).not.toHaveBeenCalledWith({ queryKey: ['people'] })
  })

  it('invalidate.offerings covers the categories scope too — one prefix, not two call sites to remember', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(queryKeys.offerings.categories(), [])
    queryClient.setQueryData(queryKeys.offerings.list({ active: true }), [])
    queryClient.setQueryData(queryKeys.companies.list(), [])

    await invalidate.offerings(queryClient)

    expect(queryClient.getQueryState(queryKeys.offerings.categories())?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(queryKeys.offerings.list({ active: true }))?.isInvalidated).toBe(true)
    // …and stops at its own entity: a category rename does not re-fetch companies.
    expect(queryClient.getQueryState(queryKeys.companies.list())?.isInvalidated).toBe(false)
  })

  it('a prefix invalidation actually marks a longer, real key stale (not just the spy assertion above)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
    queryClient.setQueryData(queryKeys.app.version(), { version: '0.1.0' })

    await invalidate.app(queryClient)

    const state = queryClient.getQueryState(queryKeys.app.version())
    expect(state?.isInvalidated).toBe(true)
  })
})
