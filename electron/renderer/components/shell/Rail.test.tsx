import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Rail } from './Rail'
import { NAV_ITEMS } from '../../nav'

function renderRail(path: string, onNavigate = vi.fn()) {
  return { onNavigate, ...render(
    <MemoryRouter initialEntries={[path]}>
      <Rail open={false} onNavigate={onNavigate} />
    </MemoryRouter>
  ) }
}

describe('Rail', () => {
  it('renders all ten views across three groups, and nothing for the dropped Pipeline view', () => {
    renderRail('/')
    expect(NAV_ITEMS).toHaveLength(10)
    for (const item of NAV_ITEMS) {
      expect(screen.getByRole('link', { name: item.label })).toBeTruthy()
    }
    expect(screen.queryByRole('link', { name: /pipeline/i })).toBeNull()
  })

  it('highlights only the nav item matching the current route', () => {
    renderRail('/todos')
    const todos = screen.getByRole('link', { name: 'Todos' })
    expect(todos.getAttribute('aria-current')).toBe('page')
    expect(todos.className).toContain('on')

    const companies = screen.getByRole('link', { name: 'Companies' })
    expect(companies.getAttribute('aria-current')).toBeNull()
    expect(companies.className).not.toContain('on')
  })

  it('highlights Companies from a company detail route', () => {
    renderRail('/company/co_1')
    expect(screen.getByRole('link', { name: 'Companies' }).getAttribute('aria-current')).toBe('page')
  })

  it('highlights People from a person detail route', () => {
    renderRail('/person/pe_1')
    expect(screen.getByRole('link', { name: 'People' }).getAttribute('aria-current')).toBe('page')
  })

  it('calls onNavigate when a nav item is clicked, so the off-canvas rail can close itself', () => {
    const { onNavigate } = renderRail('/')
    fireEvent.click(screen.getByRole('link', { name: 'Todos' }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('renders nav items as real links — reachable by Tab, activate on Enter by native anchor semantics', () => {
    renderRail('/')
    const link = screen.getByRole('link', { name: 'Companies' })
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('/companies')
    expect(link.getAttribute('tabindex')).not.toBe('-1')
  })

  it('shows a placeholder, not a zero, on the count-bearing nav items — and marks it decorative', () => {
    renderRail('/')
    const todos = screen.getByRole('link', { name: 'Todos' })
    expect(todos.textContent).toContain('–')
    expect(todos.textContent).not.toMatch(/\d/)
    const countEl = todos.querySelector('.count')
    expect(countEl?.getAttribute('aria-hidden')).toBe('true')
  })

  it('does not show a count slot on nav items the mockup gives none (Today, Revenue, Activity, Settings)', () => {
    renderRail('/')
    for (const label of ['Today', 'Revenue', 'Activity', 'Settings']) {
      const link = screen.getByRole('link', { name: label })
      expect(link.querySelector('.count')).toBeNull()
    }
  })

  it('applies the off-canvas "open" class only when told to', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/']}>
        <Rail open={false} onNavigate={() => {}} />
      </MemoryRouter>
    )
    expect(document.getElementById('rail')?.className).not.toContain('open')

    rerender(
      <MemoryRouter initialEntries={['/']}>
        <Rail open onNavigate={() => {}} />
      </MemoryRouter>
    )
    expect(document.getElementById('rail')?.className).toContain('open')
  })

  it('renders the app name and the database chip linking to Workspace / Data', () => {
    renderRail('/')
    expect(screen.getByText('Solo CRM')).toBeTruthy()
    const dbLink = screen.getByRole('link', { name: /solocrm\.db/ })
    expect(dbLink.getAttribute('href')).toBe('/workspace/data')
  })
})
