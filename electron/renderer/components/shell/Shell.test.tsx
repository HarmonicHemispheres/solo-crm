import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { LayerManager } from './LayerManager'
import { AppRoutes } from '../../routes'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import type { CrmApi } from '../../../shared/ipc-types'

// T-260828-28: the Companies route is a real, query-backed view now (the
// first of the ten to be), so every render through AppRoutes needs a
// QueryClientProvider the same way App.tsx gives the real app one — and a
// window.crm to answer its queries, the same convention
// lib/query-integration.test.tsx uses.
afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
  document.documentElement.removeAttribute('data-motion')
})

function renderApp(path = '/todos', crmOverrides: Partial<CrmApi> = {}) {
  window.crm = stubCrm(crmOverrides)
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <LayerManager>
          <AppRoutes />
        </LayerManager>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('ShellLayout', () => {
  it('renders the rail, the topbar and the routed view body together', () => {
    renderApp('/todos')
    expect(document.getElementById('rail')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Todos' })).toBeTruthy()
    expect(document.querySelector('.crumb')?.textContent).toBe('Todos') // breadcrumb
    expect(screen.getByRole('heading', { name: 'Todos' })).toBeTruthy() // view placeholder
  })

  it('opens the rail off-canvas via the topbar toggle', () => {
    renderApp('/todos')
    const rail = document.getElementById('rail')
    expect(rail?.className).not.toContain('open')

    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }))
    expect(rail?.className).toContain('open')
  })

  it('closes the off-canvas rail again after navigating to a different view', () => {
    renderApp('/todos')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }))
    expect(document.getElementById('rail')?.className).toContain('open')

    fireEvent.click(screen.getByRole('link', { name: 'Companies' }))

    expect(document.getElementById('rail')?.className).not.toContain('open')
    expect(screen.getByRole('heading', { name: 'Companies' })).toBeTruthy()
  })

  it('⌘K opens the palette from any route, since the shortcut is registered once for the whole shell', () => {
    renderApp('/revenue')
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  // T-260828-38 review (BLOCKING): before this, `data-motion` was written
  // only by WorkspaceSettings.tsx's own effect, so a workspace with motion
  // turned off booted straight to `/today` (App.tsx's index route) still
  // animating — the exact "a settings page that appears to work and does
  // not" failure the task's Risks section names, and this view never
  // renders Settings at all. ShellLayout now reads the same
  // `appearance.motion` snapshot itself, so this has to hold with no visit
  // to `/workspace/settings` anywhere in the test.
  it('applies appearance.motion at boot on an ordinary route, with no visit to Settings', async () => {
    renderApp('/todos', {
      'settings:getAll': vi.fn(async () => ({
        ok: true as const,
        data: {
          'workspace.name': '',
          'workspace.operator': '',
          'workspace.currency': 'USD' as const,
          'workspace.fiscalYearStartMonth': 1,
          'cadence.defaultDays.client': 7,
          'cadence.defaultDays.end_client': 14,
          'cadence.defaultDays.prospect': 14,
          'cadence.defaultDays.advisory': 21,
          'cadence.defaultDays.channel': 30,
          'integrations.stripe.enabled': true,
          'integrations.googleCalendar.enabled': true,
          'integrations.gmail.enabled': false,
          'backup.enabled': true,
          'backup.folder': '',
          'appearance.motion': false,
          'appearance.density': 'comfortable' as const,
          'view.companies.mode': 'card' as const,
          'view.people.mode': 'card' as const,
          'view.todos.groupBy': 'date' as const,
          'view.data.snippets': []
        }
      }))
    })

    expect(screen.getByRole('heading', { name: 'Todos' })).toBeTruthy()
    await waitFor(() => expect(document.documentElement.getAttribute('data-motion')).toBe('off'))
  })

  it('leaves data-motion unset at boot when appearance.motion is on (the stubCrm default)', async () => {
    renderApp('/todos')
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Todos' })).toBeTruthy())
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false)
  })
})
