import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { LayerManager } from './LayerManager'
import { useLayerManager } from './layer-manager-context'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** Exercises the context API directly through real buttons — the layer
 * manager's own consumers (Topbar, NewMenu, useGlobalShortcuts) each open a
 * specific layer from a specific trigger; this harness stands in for all of
 * them so the manager itself can be tested without needing P1-08/09/10's
 * real content.
 *
 * The menu/popover triggers call `stopPropagation`, same as NewMenu.tsx's
 * real toggle button — LayerManager's outside-click dismiss (see its own
 * comment) is *supposed* to close a just-opened menu/popover if the click
 * that opened it is allowed to keep bubbling, exactly as it would close one
 * left open from an earlier, unrelated click. A control that opens `menu`
 * or `popover` has to stop that propagation itself; this harness mirrors
 * that contract instead of masking it. */
function Harness() {
  const { openLayer, openSheet, closeLayer, isOpen, isTopmost } = useLayerManager()
  return (
    <div>
      <button onClick={(e) => openLayer('palette', e.currentTarget)}>open-palette</button>
      <button onClick={(e) => openSheet('New company', e.currentTarget)}>open-sheet</button>
      <button onClick={(e) => openSheet('New company', e.currentTarget)}>open-sheet-again</button>
      <button onClick={(e) => openLayer('log', e.currentTarget)}>open-log</button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          openLayer('menu', e.currentTarget)
        }}
      >
        open-menu
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          openLayer('popover', e.currentTarget)
        }}
      >
        open-popover
      </button>
      <button onClick={() => closeLayer('sheet')}>close-sheet</button>
      <pre data-testid="state">
        {JSON.stringify({
          palette: isOpen('palette'),
          sheet: isOpen('sheet'),
          log: isOpen('log'),
          menu: isOpen('menu'),
          popover: isOpen('popover')
        })}
      </pre>
      <pre data-testid="topmost">
        {JSON.stringify({
          palette: isTopmost('palette'),
          sheet: isTopmost('sheet')
        })}
      </pre>
    </div>
  )
}

/**
 * The `log` layer holds P1-09's real quick log now (T-260828-35) rather than
 * this task's empty shell, and that form reads companies/people/engagements
 * through TanStack Query — so opening it here needs the same
 * `QueryClientProvider` + `window.crm` stub `App.tsx` provides in production,
 * exactly as `routes.test.tsx` already does for its query-backed views. The
 * default `stubCrm()` answers every list with `[]`, which is all these tests
 * (about the stack, not the form) need.
 */
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

function state() {
  return JSON.parse(screen.getByTestId('state').textContent ?? '{}') as Record<string, boolean>
}

function topmost() {
  return JSON.parse(screen.getByTestId('topmost').textContent ?? '{}') as Record<string, boolean>
}

describe('LayerManager', () => {
  it('opens nothing by default', () => {
    renderHarness()
    expect(state()).toEqual({ palette: false, sheet: false, log: false, menu: false, popover: false })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('opens the palette as a dialog with the right role and label', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    const dialog = screen.getByRole('dialog', { name: 'Search' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('opens the generic sheet layer titled by whoever called openSheet', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-sheet'))
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
  })

  it('is idempotent — opening an already-open layer does not stack a second instance', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    fireEvent.click(screen.getByText('open-palette'))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('Esc closes the topmost layer only — a sheet opened over the palette leaves the palette open on one press', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    fireEvent.click(screen.getByText('open-sheet'))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'New company' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
  })

  it('isTopmost reflects only the layer nothing else is stacked above', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    expect(topmost()).toEqual({ palette: true, sheet: false })

    fireEvent.click(screen.getByText('open-sheet'))
    // Palette is still open underneath, but no longer the topmost.
    expect(topmost()).toEqual({ palette: false, sheet: true })
    expect(state()).toMatchObject({ palette: true, sheet: true })
  })

  it('Esc closes the topmost layer only — the palette opened over a sheet closes alone, leaving the sheet open', () => {
    // The reverse ordering of the test above, and the one the primitive's
    // own Escape listener would break: with `closeOnEscape` left on, one
    // press here would take the half-filled create form down with the
    // palette.
    renderHarness()
    fireEvent.click(screen.getByText('open-sheet'))
    fireEvent.click(screen.getByText('open-palette'))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the topmost layer is the last overlay in the DOM, so it paints above the equal-z-index scrims', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-sheet'))
    fireEvent.click(screen.getByText('open-palette'))

    const sheet = screen.getByRole('dialog', { name: 'New company' })
    const palette = screen.getByRole('dialog', { name: 'Search' })
    expect(sheet.compareDocumentPosition(palette) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('the generic sheet and quick-log stack independently — ⌘L over a half-filled form must not discard it', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-sheet'))
    fireEvent.click(screen.getByText('open-log'))
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Log a touch' })).toBeTruthy()

    // And Esc unwinds them in stack order: log first, form second.
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Log a touch' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'New company' })).toBeTruthy()
  })

  it('re-opening an already-open layer keeps the original focus-return target', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-sheet'))
    fireEvent.click(screen.getByText('open-sheet-again'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(screen.getByText('open-sheet'))
  })

  it('opening a heavier layer closes an already-open menu and popover', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-menu'))
    fireEvent.click(screen.getByText('open-popover'))
    expect(state()).toMatchObject({ menu: true, popover: true })

    fireEvent.click(screen.getByText('open-palette'))
    expect(state()).toMatchObject({ menu: false, popover: false, palette: true })
  })

  it('returns focus to the trigger element when a layer closes via Esc', () => {
    renderHarness()
    const trigger = screen.getByText('open-sheet')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(trigger)
  })

  it('returns focus to the trigger element when a layer closes via an explicit close call', () => {
    renderHarness()
    const trigger = screen.getByText('open-sheet')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByText('close-sheet'))
    expect(document.activeElement).toBe(trigger)
  })

  it("clicking the palette's own scrim (not its dialog) closes it", () => {
    const { container } = renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    const scrim = container.querySelector('.scrim')
    if (!scrim) throw new Error('expected a .scrim element')
    fireEvent.click(scrim)
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull()
  })

  it('a click inside the palette dialog does not close it', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    const dialog = screen.getByRole('dialog', { name: 'Search' })
    fireEvent.click(within(dialog).getByPlaceholderText('Search or create…'))
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  it('focuses the palette input when it opens', () => {
    renderHarness()
    fireEvent.click(screen.getByText('open-palette'))
    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search or create…'))
  })
})
