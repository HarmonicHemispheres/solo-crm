import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { LayerManager } from './LayerManager'
import { Topbar } from './Topbar'

/**
 * The `QueryClientProvider` and the `window.crm` stub are here for the
 * layers, not the topbar: the `palette` layer holds P1-10's real command
 * palette now (T-260828-37) and it reads through TanStack Query, exactly as
 * the `log` layer's quick log already did in `LayerManager.test.tsx`. The
 * default `stubCrm()` answers every read with nothing, which is all these
 * tests — about the topbar, not the palette — need.
 */
function renderTopbar(path = '/todos', onToggleRail = vi.fn()) {
  window.crm = stubCrm()
  return {
    onToggleRail,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={createQueryClient()}>
          <LayerManager>
            <Topbar onToggleRail={onToggleRail} />
          </LayerManager>
        </QueryClientProvider>
      </MemoryRouter>
    )
  }
}

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

describe('Topbar', () => {
  it('shows the breadcrumb for the current route', () => {
    renderTopbar('/todos')
    expect(screen.getByText('Todos')).toBeTruthy()
  })

  it('shows the workspace/data breadcrumb', () => {
    renderTopbar('/workspace/data')
    expect(screen.getByText('Workspace / Data')).toBeTruthy()
  })

  it('calls onToggleRail when the menu-toggle icon button is clicked', () => {
    const { onToggleRail } = renderTopbar()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle navigation' }))
    expect(onToggleRail).toHaveBeenCalledTimes(1)
  })

  it('opens the palette when the search button is clicked, with itself as the focus-return trigger', () => {
    renderTopbar()
    const searchButton = screen.getByRole('button', { name: /Search everything/ })
    fireEvent.click(searchButton)

    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(searchButton)
  })

  it('shows the ⌘K hint on the search button', () => {
    renderTopbar()
    expect(screen.getByText('⌘K')).toBeTruthy()
  })

  it('renders the New menu', () => {
    renderTopbar()
    expect(screen.getByRole('button', { name: /New/ })).toBeTruthy()
  })
})
