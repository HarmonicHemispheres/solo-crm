import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Sheet } from '../primitives/Sheet'
import { EmptyState } from '../primitives/EmptyState'
import { Button } from '../primitives/Button'
import { SearchIcon } from './icons'
import { LayerManagerContext, type LayerKind, type LayerManagerContextValue, type SheetKind } from './layer-manager-context'
import { CompanySheet } from '../sheets/CompanySheet'
import { PersonSheet } from '../sheets/PersonSheet'
import { EngagementSheet } from '../sheets/EngagementSheet'
import { TodoSheet } from '../sheets/TodoSheet'
import './LayerManager.css'

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
 * `sheet` and `log` are two instances of the same `<Sheet>` primitive
 * (T-260828-11), rendered with `closeOnEscape={false}`: the primitive's
 * standalone default is its own document-level Escape listener, which would
 * fire alongside the central handler here and close a sheet that isn't
 * topmost — one Esc taking two layers with it, the exact failure this
 * task's Risks section names. With the primitive's listener off, the
 * handler below is the only thing Esc reaches, so the palette and both
 * sheets stack freely in any order (the mockup keeps the create form and
 * quick-log independent, so ⌘L over a half-filled form must not discard it).
 *
 * All three overlay wrappers are the mockup's `.scrim` at the same
 * z-index, so DOM order decides which paints on top: the overlays render
 * sorted by stack position, topmost last. Without that, a palette opened
 * over a sheet would focus its input while painting beneath the sheet's
 * scrim — keystrokes landing in an invisible search box.
 */
export function LayerManager({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly LayerKind[]>([])
  const [sheetTitle, setSheetTitle] = useState('')
  // Which real form (T-260828-27) the generic 'sheet' layer is holding —
  // undefined for any caller that only passed a title, which keeps this
  // file's own placeholder content (see the `sheet` overlay below).
  const [sheetKind, setSheetKind] = useState<SheetKind | undefined>(undefined)
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
    // Skip the trigger write when `kind` is already open: re-opening is a
    // documented no-op (layer-manager-context.ts), and that includes not
    // silently retargeting where focus returns when the layer closes.
    if (!stackRef.current.includes(kind)) {
      triggers.current[kind] = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    setStack((prev) => {
      if (prev.includes(kind)) return prev
      let next: readonly LayerKind[] = prev
      if (CLOSES_MENU_AND_POPOVER.has(kind)) {
        next = next.filter((k) => k !== 'menu' && k !== 'popover')
      }
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
    (title: string, trigger?: HTMLElement | null, kind?: SheetKind) => {
      // Matches `openLayer`'s own idempotency contract (see its comment: "a
      // held or repeated ⌘K [doing] nothing the first press didn't already
      // do") — extended here to the *content* a second call would pick,
      // not just the stack membership `openLayer` alone guards. Without
      // this, a second `openSheet` call while 'sheet' is already open (the
      // New button stays clickable — `Sheet` has no focus trap, so a stray
      // click can reopen the menu over an open sheet) would silently swap
      // which real form is mounted (code review, T-260828-27), discarding
      // every field the user had already typed into the one that was open.
      if (!stackRef.current.includes('sheet')) {
        setSheetTitle(title)
        setSheetKind(kind)
      }
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

  // DOM order is paint order here (see the component comment): a closed
  // overlay renders null, so where the sort places it is irrelevant
  // (`indexOf` -1 sorts it before every open layer).
  const overlays: ReadonlyArray<{ kind: LayerKind; node: ReactNode }> = [
    { kind: 'palette', node: <PaletteShell open={isOpen('palette')} onClose={() => closeLayer('palette')} /> },
    {
      kind: 'sheet',
      // T-260828-27 fills in the four real forms; a caller that opened
      // 'sheet' with a title alone (no `kind` — T-260828-12's own tests, and
      // anything from before this task) still gets the original empty shell
      // below, unchanged.
      //
      // The four real forms are mounted only while `isOpen('sheet')` —
      // unlike the fallback `<Sheet open={...}>` below, which stays mounted
      // and toggles its own `open` prop. Each form owns real field state
      // (company's `kind` chip, engagement's shared-vs-model fields, …);
      // mounting fresh on every open is what resets that state to blank
      // without an effect that sets state on every open (React's own
      // guidance — and this codebase's `react-hooks/set-state-in-effect`
      // lint rule — is to let a fresh mount do that, not an effect).
      // Unmounting on close is also behaviourally identical to what `Sheet`
      // already does when `open` flips false (`if (!open) return null`, no
      // exit transition to preserve).
      node: (() => {
        const sheetOnClose = () => closeLayer('sheet')
        if (sheetKind && !isOpen('sheet')) return null
        switch (sheetKind) {
          case 'company':
            return <CompanySheet onClose={sheetOnClose} />
          case 'person':
            return <PersonSheet onClose={sheetOnClose} />
          case 'engagement':
            return <EngagementSheet onClose={sheetOnClose} />
          case 'todo':
            return <TodoSheet onClose={sheetOnClose} />
          default:
            return (
              <Sheet
                open={isOpen('sheet')}
                onClose={sheetOnClose}
                closeOnEscape={false}
                title={sheetTitle || 'Create'}
                aria-label={sheetTitle || 'Create'}
                footerNote="saved locally"
                footer={
                  <>
                    <Button variant="ghost" onClick={sheetOnClose}>
                      Cancel
                    </Button>
                    <Button variant="primary" disabled>
                      Create
                    </Button>
                  </>
                }
              >
                <EmptyState>This form ships with its own task (P1-08).</EmptyState>
              </Sheet>
            )
        }
      })()
    },
    {
      kind: 'log',
      node: (
        <Sheet
          open={isOpen('log')}
          onClose={() => closeLayer('log')}
          closeOnEscape={false}
          title="Log a touch"
          aria-label="Log a touch"
          footerNote="resets the cadence clock"
          footer={
            <>
              <Button variant="ghost" onClick={() => closeLayer('log')}>
                Cancel
              </Button>
              <Button variant="primary" disabled>
                Save
              </Button>
            </>
          }
        >
          <EmptyState>Quick-log ships with its own task (P1-09).</EmptyState>
        </Sheet>
      )
    }
  ]

  return (
    <LayerManagerContext.Provider value={value}>
      {children}
      {[...overlays]
        .sort((a, b) => stack.indexOf(a.kind) - stack.indexOf(b.kind))
        .map(({ kind, node }) => (
          <Fragment key={kind}>{node}</Fragment>
        ))}
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
