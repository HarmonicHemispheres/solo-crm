import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../lib/query-client'
import { stubCrm } from '../lib/test-support/stub-crm'
import { LayerManager } from '../components/shell/LayerManager'
import { LayerManagerContext, type LayerManagerContextValue } from '../components/shell/layer-manager-context'
import { useGlobalShortcuts } from './useGlobalShortcuts'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

function Harness() {
  useGlobalShortcuts()
  return <input aria-label="somewhere else in the app" />
}

/** ⌘L now opens P1-09's real quick log (T-260828-35), which reads through
 * TanStack Query — so the harness carries the same provider + `window.crm`
 * stub `App.tsx` gives it in production. See `LayerManager.test.tsx`'s
 * identical note. */
function renderHarness() {
  window.crm = stubCrm()
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <LayerManager>
        <Harness />
      </LayerManager>
    </QueryClientProvider>
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

  it('never re-enters openLayer while its layer is open — the isOpen guard, pinned directly', () => {
    // The integration test above cannot fail without the guard (openLayer's
    // own idempotency keeps the dialog count at 1 regardless), so this one
    // pins the guard itself through a mocked context: with both layers
    // reporting open, a recognised combo must not reach openLayer at all.
    const openLayer = vi.fn()
    const value: LayerManagerContextValue = {
      isOpen: () => true,
      isTopmost: () => true,
      openLayer,
      closeLayer: vi.fn(),
      sheetTitle: '',
      openSheet: vi.fn()
    }
    render(
      <LayerManagerContext.Provider value={value}>
        <Harness />
      </LayerManagerContext.Provider>
    )
    fireEvent.keyDown(document, { key: 'k', metaKey: true })
    fireEvent.keyDown(document, { key: 'l', metaKey: true })
    expect(openLayer).not.toHaveBeenCalled()
  })

  it('prevents the browser/OS default for the recognised combo', () => {
    renderHarness()
    const notCancelled = fireEvent.keyDown(document, { key: 'k', metaKey: true })
    // fireEvent's return value is the result of dispatchEvent, which is
    // false once preventDefault has been called on a cancelable event.
    expect(notCancelled).toBe(false)
  })
})
