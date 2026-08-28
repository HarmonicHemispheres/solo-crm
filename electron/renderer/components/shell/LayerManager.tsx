import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Sheet } from '../primitives/Sheet'
import { EmptyState } from '../primitives/EmptyState'
import { SearchIcon } from './icons'
import { LayerManagerContext, type LayerKind, type LayerManagerContextValue } from './layer-manager-context'
import './LayerManager.css'
import './buttons.css'

/** Layers that close `menu` and `popover` when they open — the mockup's own
 * `openForm`/`openLog` both clear `#newMenu`, and `toggleMenu` itself clears
 * `#pop`; this generalises that to every heavier layer opening on top of a
 * lighter one. */
const CLOSES_MENU_AND_POPOVER: ReadonlySet<LayerKind> = new Set(['palette', 'sheet', 'log', 'menu'])

/**
 * The one place the layer stack lives (T-260828-12's scope: "One place, not
 * per-component"). Renders its `children` (the rest of the shell) plus the
 * palette and generic-sheet/log-sheet overlay shells — their *content* is
 * P1-09/P1-10/P1-08's job, this task only builds the open/close mechanism
 * and the empty shell each of those tasks fills in. See
 * `layer-manager-context.ts` for the `LayerKind`/context types and
 * `useLayerManager`.
 *
 * `sheet` and `log` are two names for the *same* underlying `<Sheet>`
 * primitive, and Sheet.tsx (T-260828-11) carries its own document-level
 * Escape listener that fires whenever it is `open`, independent of whether
 * this manager considers it "topmost" — that is how Sheet is built and this
 * task does not change it (Sheet.test.tsx already covers that behaviour).
 * Two simultaneously-open Sheet instances would each react to the same Esc
 * press, which breaks "closes the topmost layer only" the moment `sheet`
 * isn't on top. `openLayer` below sidesteps this by making `sheet` and
 * `log` mutually exclusive — opening one always closes the other — so at
 * most one Sheet-primitive instance is ever mounted+open at a time, and its
 * own Escape listener and this manager's central Esc handler always agree
 * on what's closing.
 */
export function LayerManager({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly LayerKind[]>([])
  const [sheetTitle, setSheetTitle] = useState('')
  const triggers = useRef<Partial<Record<LayerKind, HTMLElement | null>>>({})

  // A ref mirror of `stack` so the document-level listeners below (each
  // registered once) always read the current stack instead of closing over
  // the value from whichever render first mounted them — the same technique
  // Sheet.tsx uses for its onClose prop, for the same reason.
  const stackRef = useRef(stack)
  useEffect(() => {
    stackRef.current = stack
  }, [stack])

  const openLayer = useCallback((kind: LayerKind, trigger?: HTMLElement | null) => {
    triggers.current[kind] = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setStack((prev) => {
      if (prev.includes(kind)) return prev
      let next: readonly LayerKind[] = prev
      if (CLOSES_MENU_AND_POPOVER.has(kind)) {
        next = next.filter((k) => k !== 'menu' && k !== 'popover')
      }
      if (kind === 'sheet') next = next.filter((k) => k !== 'log')
      if (kind === 'log') next = next.filter((k) => k !== 'sheet')
      return [...next, kind]
    })
  }, [])

  const closeLayer = useCallback((kind: LayerKind) => {
    // Read from the ref, not `stack`: closeLayer is a stable useCallback
    // (empty deps) so `stack` here would be whatever it was on the render
    // that created this closure. Guarding on whether `kind` was *actually*
    // open avoids stealing focus to a stale trigger on a no-op close (e.g.
    // a stray `closeLayer('menu')` after 'menu' was already dismissed).
    const wasOpen = stackRef.current.includes(kind)
    setStack((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : prev))
    if (!wasOpen) return
    const trigger = triggers.current[kind]
    triggers.current[kind] = null
    trigger?.focus()
  }, [])

  const openSheet = useCallback(
    (title: string, trigger?: HTMLElement | null) => {
      setSheetTitle(title)
      openLayer('sheet', trigger)
    },
    [openLayer]
  )

  const isOpen = useCallback((kind: LayerKind) => stack.includes(kind), [stack])
  const isTopmost = useCallback((kind: LayerKind) => stack[stack.length - 1] === kind, [stack])

  // Esc closes the topmost layer only — registered once, not per-component
  // (T-260828-12's central risk: "Esc handled per-component ... produces a
  // nested sheet that closes its parent too").
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const top = stackRef.current[stackRef.current.length - 1]
      if (top) closeLayer(top)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeLayer])

  // Any click outside a layer-opening control dismisses `menu` and
  // `popover` (no focus-return — see the comment on `closeLayer` above for
  // why this is deliberately not routed through it) — the mockup's own
  // `document.addEventListener('click',()=>{closePop();closeMenu()})`. The
  // control that *opens* the menu calls `stopPropagation` on that same
  // click (NewMenu.tsx) so it doesn't immediately re-close what it just
  // opened.
  //
  // Reads and writes `stack` through the functional updater only, never
  // `stackRef` — a click that both opens a layer (via this same click's
  // React onClick, queued first) and reaches this native listener (via the
  // same click's bubble phase, same synchronous dispatch) would otherwise
  // read `stackRef.current` before the *other* queued update has committed,
  // silently undoing it. The functional form always sees whatever the
  // preceding queued update in this batch actually produced.
  useEffect(() => {
    const handleClick = () => {
      setStack((prev) => {
        if (!prev.includes('menu') && !prev.includes('popover')) return prev
        return prev.filter((k) => k !== 'menu' && k !== 'popover')
      })
    }
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  const value = useMemo<LayerManagerContextValue>(
    () => ({ isOpen, isTopmost, openLayer, closeLayer, sheetTitle, openSheet }),
    [isOpen, isTopmost, openLayer, closeLayer, sheetTitle, openSheet]
  )

  return (
    <LayerManagerContext.Provider value={value}>
      {children}
      <PaletteShell open={isOpen('palette')} onClose={() => closeLayer('palette')} />
      <Sheet
        open={isOpen('sheet')}
        onClose={() => closeLayer('sheet')}
        title={sheetTitle || 'Create'}
        aria-label={sheetTitle || 'Create'}
        footerNote="saved locally"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => closeLayer('sheet')}>
              Cancel
            </button>
            <button type="button" className="btn btn-prim" disabled>
              Create
            </button>
          </>
        }
      >
        <EmptyState>This form ships with its own task (P1-08).</EmptyState>
      </Sheet>
      <Sheet
        open={isOpen('log')}
        onClose={() => closeLayer('log')}
        title="Log a touch"
        aria-label="Log a touch"
        footerNote="resets the cadence clock"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => closeLayer('log')}>
              Cancel
            </button>
            <button type="button" className="btn btn-prim" disabled>
              Save
            </button>
          </>
        }
      >
        <EmptyState>Quick-log ships with its own task (P1-09).</EmptyState>
      </Sheet>
    </LayerManagerContext.Provider>
  )
}

/**
 * `.scrim` + `.pal` from the mockup — search's empty shell. Unlike `sheet`
 * and `log` above this is not built on the `Sheet` primitive: the mockup's
 * palette is its own shape (a search input + result list + footer hint row,
 * no `.sheet-h`/`.sheet-f`) and Esc is handled centrally by this file, not
 * per-instance, so it doesn't need Sheet's own listener. Content (the
 * actual search/create list) is P1-10's.
 */
function PaletteShell({ open, onClose }: { open: boolean; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      className="scrim open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="pal" role="dialog" aria-label="Search" aria-modal="true">
        <div className="pal-in">
          <SearchIcon width={16} height={16} />
          <input ref={inputRef} placeholder="Search or create…" autoComplete="off" aria-label="Search or create" />
        </div>
        <div className="pal-list">
          <EmptyState>Search and quick-create ship with the command palette (P1-10).</EmptyState>
        </div>
        <div className="pal-foot">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
