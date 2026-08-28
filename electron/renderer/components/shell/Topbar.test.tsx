import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LayerManager } from './LayerManager'
import { Topbar } from './Topbar'

function renderTopbar(path = '/todos', onToggleRail = vi.fn()) {
  return {
    onToggleRail,
    ...render(
      <MemoryRouter initialEntries={[path]}>
        <LayerManager>
          <Topbar onToggleRail={onToggleRail} />
        </LayerManager>
      </MemoryRouter>
    )
  }
}

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
