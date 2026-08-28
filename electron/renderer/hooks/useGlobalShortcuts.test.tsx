import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LayerManager } from '../components/shell/LayerManager'
import { useGlobalShortcuts } from './useGlobalShortcuts'

function Harness() {
  useGlobalShortcuts()
  return <input aria-label="somewhere else in the app" />
}

function renderHarness() {
  return render(
    <LayerManager>
      <Harness />
    </LayerManager>
  )
}

describe('useGlobalShortcuts', () => {
  it('⌘K opens the palette layer', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  it('Ctrl+K opens the palette on Windows/Linux', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  it('⌘L opens the quick-log layer', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'l', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('Ctrl+L opens the quick-log layer on Windows/Linux', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'l', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()
  })

  it('fires with focus inside a text input, not just at the document root', () => {
    renderHarness()
    const input = screen.getByLabelText('somewhere else in the app')
    input.focus()
    fireEvent.keyDown(input, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  it('a bare "k" or "l" without a modifier does not open anything', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'k' })
    fireEvent.keyDown(document, { key: 'l' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not double-fire when the layer is already open — a repeated ⌘K stays a single palette instance', () => {
    renderHarness()
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('prevents the browser/OS default for the recognised combo', () => {
    renderHarness()
    const notCancelled = fireEvent.keyDown(document, { key: 'k', metaKey: true })
    // fireEvent's return value is the result of dispatchEvent, which is
    // false once preventDefault has been called on a cancelable event.
    expect(notCancelled).toBe(false)
  })
})
