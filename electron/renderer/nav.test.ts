import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, ROUTE_META, getActiveNavId, getBreadcrumb } from './nav'

describe('nav', () => {
  it('has one ROUTE_META row per NAV_ITEMS path, plus the two detail routes', () => {
    // 10 nav items + company/:id + person/:id = 12.
    expect(ROUTE_META).toHaveLength(NAV_ITEMS.length + 2)
  })

  it('resolves the nav id for every list-view route', () => {
    for (const item of NAV_ITEMS) {
      expect(getActiveNavId(item.path)).toBe(item.id)
    }
  })

  it('highlights the parent nav item from a company or person detail route', () => {
    expect(getActiveNavId('/company/abc-123')).toBe('companies')
    expect(getActiveNavId('/person/abc-123')).toBe('people')
  })

  it('returns undefined for a route it does not know, rather than guessing', () => {
    expect(getActiveNavId('/nonexistent')).toBeUndefined()
  })

  it('produces the mockup crumbs map for detail routes', () => {
    expect(getBreadcrumb('/companies')).toBe('Companies')
    expect(getBreadcrumb('/company/abc-123')).toBe('Companies /')
    expect(getBreadcrumb('/people')).toBe('People')
    expect(getBreadcrumb('/person/abc-123')).toBe('People /')
    expect(getBreadcrumb('/workspace/settings')).toBe('Workspace')
    expect(getBreadcrumb('/workspace/data')).toBe('Workspace / Data')
  })

  it('falls back to the pathname itself for an unmatched route', () => {
    expect(getBreadcrumb('/nonexistent')).toBe('/nonexistent')
  })
})
