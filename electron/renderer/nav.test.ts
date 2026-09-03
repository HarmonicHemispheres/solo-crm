import { describe, expect, it } from 'vitest'
import {
  NAV_ITEMS,
  NAV_SUBGROUPS,
  NAV_SUBGROUP_SETTING_KEY,
  ROUTE_META,
  getActiveNavId,
  getActiveNavSubgroupId,
  getBreadcrumb,
  railRowsFor,
  type NavSubgroupId
} from './nav'
import { SETTINGS_REGISTRY } from '../shared/settings'

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

/**
 * The nav tables' own rules (T-260902-13). `routes.test.tsx` proves the route
 * tree and `ROUTE_META` agree; this file covers the part of `nav.ts` that is
 * arithmetic on the tables rather than a claim about routing — the ordering a
 * subgroup imposes, and the two lookups the rail derives from it.
 */
describe('nav subgroups', () => {
  it('declares a settings key for every subgroup, and each one is a real registry key', () => {
    for (const subgroup of NAV_SUBGROUPS) {
      const key = NAV_SUBGROUP_SETTING_KEY[subgroup.id]
      expect(key, `${subgroup.id} has no settings key`).toBeTruthy()
      expect(key in SETTINGS_REGISTRY).toBe(true)
    }
  })

  it('gives every subgroup at least one member — a header that expands to nothing is worse than no header', () => {
    for (const subgroup of NAV_SUBGROUPS) {
      expect(NAV_ITEMS.some((item) => item.parent === subgroup.id), `${subgroup.id} has no members`).toBe(true)
    }
  })

  it('points every item.parent at a declared subgroup', () => {
    const declared = new Set<NavSubgroupId>(NAV_SUBGROUPS.map((subgroup) => subgroup.id))
    for (const item of NAV_ITEMS) {
      if (item.parent === undefined) continue
      expect(declared.has(item.parent), `${item.id} names an undeclared subgroup ${item.parent}`).toBe(true)
    }
  })

  it('keeps a subgroup in the same nav group as its members', () => {
    for (const item of NAV_ITEMS) {
      if (item.parent === undefined) continue
      const subgroup = NAV_SUBGROUPS.find((candidate) => candidate.id === item.parent)
      expect(subgroup?.group).toBe(item.group)
    }
  })
})

describe('railRowsFor', () => {
  it('puts Reports where Revenue used to sit, with Revenue inside it', () => {
    const rows = railRowsFor('Work')
    expect(rows.map((row) => (row.kind === 'item' ? row.item.id : row.subgroup.id))).toEqual([
      'today',
      'todos',
      'reports',
      'activity'
    ])
    const reports = rows.find((row) => row.kind === 'subgroup')
    expect(reports?.kind === 'subgroup' && reports.items.map((item) => item.id)).toEqual(['revenue'])
  })

  it('emits a subgroup once however many members it has', () => {
    const rows = railRowsFor('Work')
    expect(rows.filter((row) => row.kind === 'subgroup')).toHaveLength(1)
  })

  it('leaves a group with no subgroups exactly as NAV_ITEMS orders it', () => {
    for (const group of ['Records', 'Workspace'] as const) {
      const rows = railRowsFor(group)
      expect(rows.every((row) => row.kind === 'item')).toBe(true)
      expect(rows.map((row) => (row.kind === 'item' ? row.item.id : null))).toEqual(
        NAV_ITEMS.filter((item) => item.group === group).map((item) => item.id)
      )
    }
  })

  it('accounts for every nav item exactly once across the three groups', () => {
    const seen = (['Work', 'Records', 'Workspace'] as const).flatMap((group) =>
      railRowsFor(group).flatMap((row) => (row.kind === 'item' ? [row.item.id] : row.items.map((item) => item.id)))
    )
    expect([...seen].sort()).toEqual(NAV_ITEMS.map((item) => item.id).sort())
  })
})

describe('getActiveNavSubgroupId', () => {
  it('names Reports for a route inside it', () => {
    expect(getActiveNavSubgroupId('/revenue')).toBe('reports')
  })

  it('is undefined for a top-level route, and for one the table does not know', () => {
    expect(getActiveNavSubgroupId('/todos')).toBeUndefined()
    expect(getActiveNavSubgroupId('/nothing-here')).toBeUndefined()
  })
})

describe('breadcrumbs', () => {
  it("names the group a nested route sits in, the way '/workspace/data' already does", () => {
    expect(getBreadcrumb('/revenue')).toBe('Reports / Revenue')
  })

  it('leaves a top-level route naming only itself', () => {
    expect(getBreadcrumb('/todos')).toBe('Todos')
  })

  it('gives every nested route a crumb that carries its subgroup label', () => {
    // The rule, not one instance of it: adding Timeline under Reports (P3-12)
    // with a bare 'Timeline' crumb should fail here rather than ship a
    // breadcrumb that has quietly forgotten which group it belongs to.
    for (const item of NAV_ITEMS) {
      if (item.parent === undefined) continue
      const subgroup = NAV_SUBGROUPS.find((candidate) => candidate.id === item.parent)
      const meta = ROUTE_META.find((route) => route.path === item.path)
      expect(meta?.breadcrumb, `${item.path} has no ROUTE_META row`).toBeTruthy()
      expect(meta?.breadcrumb).toBe(`${subgroup?.label} / ${item.label}`)
    }
  })
})
