import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LayerManager } from './LayerManager'
import { NewMenu } from './NewMenu'

function renderNewMenu() {
  return render(
    <LayerManager>
      <NewMenu />
    </LayerManager>
  )
}

describe('NewMenu', () => {
  it('is closed by default', () => {
    renderNewMenu()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens on click and does not immediately re-close itself (stopPropagation on the toggle click)', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })

  it('toggles closed on a second click of the same button', () => {
    renderNewMenu()
    const toggle = screen.getByRole('button', { name: /New/ })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on an outside click', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    expect(screen.getByRole('menu')).toBeTruthy()

    fireEvent.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens the generic sheet layer titled for the item clicked, and closes the menu', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))

    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens a differently-titled sheet for Person and Engagement', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Person/ }))
    expect(screen.getByRole('dialog', { name: 'New person' })).toBeTruthy()
  })

  it('opens the log layer for Touch, not the generic sheet', () => {
    renderNewMenu()
    fireEvent.click(screen.getByRole('button', { name: /New/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Touch/ }))
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('returns focus to the New button when the opened sheet closes', () => {
    renderNewMenu()
    const toggle = screen.getByRole('button', { name: /New/ })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: /Company/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(toggle)
  })
})
