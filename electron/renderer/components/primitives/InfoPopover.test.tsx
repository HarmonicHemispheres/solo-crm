import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from '../../lib/query-client'
import { stubCrm } from '../../lib/test-support/stub-crm'
import { LayerManager } from '../shell/LayerManager'
import { LayerManagerContext, useLayerManager, type LayerManagerContextValue } from '../shell/layer-manager-context'
import { InfoPopover } from './InfoPopover'
import { ViewHeader } from './ViewHeader'

afterEach(() => {
  // @ts-expect-error - test-only teardown of the jsdom global window.crm assign.
  delete window.crm
})

/** `useId` output (`_r_0_`, `_r_1_`, …) is stable within a render but not
 * across them, so markup comparisons blank it out. */
function withoutGeneratedIds(html: string): string {
  return html.replace(/_r_[^"]*_/g, 'ID')
}

describe('InfoPopover', () => {
  describe('standalone (no layer manager above it)', () => {
    it('opens on click and closes on a second click, with aria-expanded tracking state', () => {
      render(<InfoPopover aria-label="About default cadence">Days before a company goes quiet.</InfoPopover>)
      const trigger = screen.getByRole('button', { name: 'About default cadence' })
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText('Days before a company goes quiet.')).toBeNull()

      fireEvent.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(screen.getByText('Days before a company goes quiet.')).toBeTruthy()

      fireEvent.click(trigger)
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
      expect(screen.queryByText('Days before a company goes quiet.')).toBeNull()
    })

    it('names the panel it controls with aria-controls', () => {
      render(<InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>)
      const trigger = screen.getByRole('button', { name: 'About default cadence' })
      fireEvent.click(trigger)
      const panel = screen.getByText('Panel prose.')
      expect(panel.id).toBeTruthy()
      expect(trigger.getAttribute('aria-controls')).toBe(panel.id)
    })

    it('closes on Escape and puts focus back on the trigger', () => {
      render(<InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>)
      const trigger = screen.getByRole('button', { name: 'About default cadence' })
      fireEvent.click(trigger)
      expect(screen.getByText('Panel prose.')).toBeTruthy()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText('Panel prose.')).toBeNull()
      expect(document.activeElement).toBe(trigger)
    })

    it('closes on a pointerdown outside it and stays open on one inside', () => {
      render(
        <div>
          <InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>
          <button type="button">somewhere else</button>
        </div>
      )
      fireEvent.click(screen.getByRole('button', { name: 'About default cadence' }))

      fireEvent.pointerDown(screen.getByText('Panel prose.'))
      expect(screen.getByText('Panel prose.')).toBeTruthy()

      fireEvent.pointerDown(screen.getByRole('button', { name: 'somewhere else' }))
      expect(screen.queryByText('Panel prose.')).toBeNull()
    })

    it('keeps ids and open state independent when two are on one page', () => {
      render(
        <div>
          <InfoPopover aria-label="About cadence">Cadence prose.</InfoPopover>
          <InfoPopover aria-label="About currency">Currency prose.</InfoPopover>
        </div>
      )
      const first = screen.getByRole('button', { name: 'About cadence' })
      const second = screen.getByRole('button', { name: 'About currency' })
      expect(first.getAttribute('aria-controls')).not.toBe(second.getAttribute('aria-controls'))

      fireEvent.click(first)
      expect(screen.getByText('Cadence prose.')).toBeTruthy()
      expect(screen.queryByText('Currency prose.')).toBeNull()
      expect(second.getAttribute('aria-expanded')).toBe('false')
    })
  })

  describe('inside the layer stack', () => {
    it('registers the popover layer, naming its trigger as the focus-return target', () => {
      // A stateful stub: `isOpen` answers the way the real manager would
      // after each call. Answering `true` unconditionally would tell the
      // component another popover already holds the layer, which is the
      // retarget path (T-260901-16), not the registration this asserts.
      let popoverOpen = false
      const openLayer = vi.fn(() => {
        popoverOpen = true
      })
      const closeLayer = vi.fn(() => {
        popoverOpen = false
      })
      const value: LayerManagerContextValue = {
        isOpen: () => popoverOpen,
        isTopmost: () => popoverOpen,
        openLayer,
        closeLayer,
        retargetLayer: vi.fn(),
        openSheet: vi.fn(),
        editSheet: vi.fn()
      }
      render(
        <LayerManagerContext.Provider value={value}>
          <InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>
        </LayerManagerContext.Provider>
      )
      const trigger = screen.getByRole('button', { name: 'About default cadence' })
      fireEvent.click(trigger)
      expect(openLayer).toHaveBeenCalledWith('popover', trigger)

      fireEvent.click(trigger)
      expect(closeLayer).toHaveBeenCalledWith('popover')
    })

    it('installs no Escape listener of its own — the manager owns that key', () => {
      const closeLayer = vi.fn()
      const value: LayerManagerContextValue = {
        isOpen: () => true,
        isTopmost: () => true,
        openLayer: vi.fn(),
        closeLayer,
        retargetLayer: vi.fn(),
        openSheet: vi.fn(),
        editSheet: vi.fn()
      }
      render(
        <LayerManagerContext.Provider value={value}>
          <InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>
        </LayerManagerContext.Provider>
      )
      fireEvent.click(screen.getByRole('button', { name: 'About default cadence' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      // This stub's `isOpen` never goes false, so the panel surviving is
      // proof the component did not close itself: the real manager's own
      // handler is what drops the layer, and a second handler here is what
      // would have taken the sheet underneath with it.
      expect(screen.getByText('Panel prose.')).toBeTruthy()
      expect(closeLayer).not.toHaveBeenCalled()
    })

    it('hides the panel when the manager drops the popover layer', () => {
      const value: LayerManagerContextValue = {
        isOpen: () => false,
        isTopmost: () => false,
        openLayer: vi.fn(),
        closeLayer: vi.fn(),
        retargetLayer: vi.fn(),
        openSheet: vi.fn(),
        editSheet: vi.fn()
      }
      render(
        <LayerManagerContext.Provider value={value}>
          <InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>
        </LayerManagerContext.Provider>
      )
      fireEvent.click(screen.getByRole('button', { name: 'About default cadence' }))
      expect(screen.queryByText('Panel prose.')).toBeNull()
    })

    it('keeps its own click away from the outside-click dismisser on document', () => {
      const documentClick = vi.fn()
      document.addEventListener('click', documentClick)
      try {
        render(<InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>)
        fireEvent.click(screen.getByRole('button', { name: 'About default cadence' }))
        expect(documentClick).not.toHaveBeenCalled()
      } finally {
        document.removeEventListener('click', documentClick)
      }
    })

    it('takes the first Escape without closing the sheet it is open inside', () => {
      window.crm = stubCrm()
      function Harness() {
        return (
          <LayerManager>
            <SheetProbe />
          </LayerManager>
        )
      }
      render(
        <MemoryRouter>
          <QueryClientProvider client={createQueryClient()}>
            <Harness />
          </QueryClientProvider>
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: 'open the sheet layer' }))
      expect(screen.getByTestId('sheet-open').textContent).toBe('yes')

      const trigger = screen.getByRole('button', { name: 'About default cadence' })
      fireEvent.click(trigger)
      expect(screen.getByText('Panel prose.')).toBeTruthy()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText('Panel prose.')).toBeNull()
      expect(screen.getByTestId('sheet-open').textContent).toBe('yes')
      expect(document.activeElement).toBe(trigger)

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.getByTestId('sheet-open').textContent).toBe('no')
    })

    // T-260901-16. Opening B while A holds the layer: A hides on the
    // pointerdown, B's wrapper stops the document click that would drop the
    // layer, and `openLayer` is a no-op for a kind already open — so before
    // the retarget, Escape here focused A's button.
    it('a second popover opened over the first takes the layer, so Escape returns focus to its own button', () => {
      window.crm = stubCrm()
      render(
        <MemoryRouter>
          <QueryClientProvider client={createQueryClient()}>
            <LayerManager>
              <InfoPopover aria-label="About A">Prose A.</InfoPopover>
              <InfoPopover aria-label="About B">Prose B.</InfoPopover>
            </LayerManager>
          </QueryClientProvider>
        </MemoryRouter>
      )
      const a = screen.getByRole('button', { name: 'About A' })
      const b = screen.getByRole('button', { name: 'About B' })

      fireEvent.click(a)
      expect(screen.getByText('Prose A.')).toBeTruthy()

      // A real click is a pointerdown first — that is what hides A.
      fireEvent.pointerDown(b)
      fireEvent.click(b)
      expect(screen.queryByText('Prose A.')).toBeNull()
      expect(screen.getByText('Prose B.')).toBeTruthy()

      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText('Prose A.')).toBeNull()
      expect(screen.queryByText('Prose B.')).toBeNull()
      expect(document.activeElement).toBe(b)
    })

    // T-260901-16, the sibling defect: A's own open flag outlived the layer
    // the manager dropped, so B re-registering the layer brought A back too.
    it('a popover the manager closed stays closed when another one opens later', () => {
      window.crm = stubCrm()
      render(
        <MemoryRouter>
          <QueryClientProvider client={createQueryClient()}>
            <LayerManager>
              <InfoPopover aria-label="About A">Prose A.</InfoPopover>
              <InfoPopover aria-label="About B">Prose B.</InfoPopover>
            </LayerManager>
          </QueryClientProvider>
        </MemoryRouter>
      )
      const a = screen.getByRole('button', { name: 'About A' })
      const b = screen.getByRole('button', { name: 'About B' })

      fireEvent.click(a)
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText('Prose A.')).toBeNull()
      expect(document.activeElement).toBe(a)

      fireEvent.pointerDown(b)
      fireEvent.click(b)
      expect(screen.queryByText('Prose A.')).toBeNull()
      expect(screen.getByText('Prose B.')).toBeTruthy()

      // And A opens cleanly again afterwards — the reset did not wedge it.
      fireEvent.keyDown(document, { key: 'Escape' })
      fireEvent.pointerDown(a)
      fireEvent.click(a)
      expect(screen.getByText('Prose A.')).toBeTruthy()
      expect(screen.queryByText('Prose B.')).toBeNull()
    })
  })

  describe('ViewHeader', () => {
    // The extraction must be invisible from outside `ViewHeader`, so this
    // pins the exact markup the inline version rendered — captured from the
    // pre-extraction component, not written from the new one.
    const CLOSED =
      '<div class="vhead"><div class="t"><span class="vicon" style="--c: var(--verdigris);"><svg></svg></span>' +
      '<h1>Today</h1><span class="info-wrap"><button type="button" class="info" aria-label="About this view" ' +
      'aria-expanded="false" aria-controls="ID">i</button></span></div></div>'
    const OPEN =
      '<div class="vhead"><div class="t"><span class="vicon" style="--c: var(--verdigris);"><svg></svg></span>' +
      '<h1>Today</h1><span class="info-wrap"><button type="button" class="info" aria-label="About this view" ' +
      'aria-expanded="true" aria-controls="ID">i</button><div id="ID" class="pop open">What this view shows.</div>' +
      '</span></div></div>'

    it('renders byte-for-byte the markup it did before the popover moved out', () => {
      const { container } = render(
        <ViewHeader icon={<svg />} accent="var(--verdigris)" title="Today" description="What this view shows." />
      )
      expect(withoutGeneratedIds(container.innerHTML)).toBe(CLOSED)
      fireEvent.click(screen.getByRole('button', { name: 'About this view' }))
      expect(withoutGeneratedIds(container.innerHTML)).toBe(OPEN)
    })
  })
})

/** Opens the generic `sheet` layer and reports whether it is still open —
 * `openLayer` rather than `openSheet` so this test asserts nothing about
 * which create form a sheet holds. */
function SheetProbe() {
  const { isOpen, openLayer } = useLayerManager()
  return (
    <div>
      <button type="button" onClick={(event) => openLayer('sheet', event.currentTarget)}>
        open the sheet layer
      </button>
      <span data-testid="sheet-open">{isOpen('sheet') ? 'yes' : 'no'}</span>
      <InfoPopover aria-label="About default cadence">Panel prose.</InfoPopover>
    </div>
  )
}
