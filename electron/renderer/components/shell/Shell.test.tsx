import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { LayerManager } from './LayerManager'
import { AppRoutes } from '../../routes'

function renderApp(path = '/todos') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LayerManager>
        <AppRoutes />
      </LayerManager>
    </MemoryRouter>
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
})
