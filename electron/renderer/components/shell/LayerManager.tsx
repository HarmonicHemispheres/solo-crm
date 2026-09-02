import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayerManagerContext, type LayerKind, type LayerManagerContextValue, type SheetKind, type SheetTarget } from './layer-manager-context'
import { CommandPalette } from './CommandPalette'
import { CompanySheet } from '../sheets/CompanySheet'
import { PersonSheet } from '../sheets/PersonSheet'
import { EngagementSheet } from '../sheets/EngagementSheet'
import { TodoSheet } from '../sheets/TodoSheet'
import { OfferingSheet } from '../sheets/OfferingSheet'
import { QuickLog } from './QuickLog'
import './LayerManager.css'

/** Layers that close `menu` and `popover` when they open — the mockup's own
 * `openForm`/`openLog` both clear `#newMenu`, and `toggleMenu` itself clears
 * `#pop`; this generalises that to every heavier layer opening on top of a
 * lighter one. `tour` is listed for the same reason as the other four: it is
 * a modal panel, not a light transient. Neither of its two open paths can
 * actually find a menu open (it opens at boot, or from a Settings button
 * whose own click already reaches the dismiss listener below), so this is a
 * statement of the layer's weight rather than a behaviour anything exercises
 * — omitting it would read as "the tour is light like a popover", which is
 * the wrong thing to say here. */
const CLOSES_MENU_AND_POPOVER: ReadonlySet<LayerKind> = new Set(['palette', 'sheet', 'log', 'menu', 'tour'])

/**
 * The one place the layer stack lives (T-260828-12's scope: "One place, not
 * per-component"). Renders its `children` (the rest of the shell) plus the
 * palette and generic-sheet/log-sheet overlay shells — their *content* is
 * P1-09/P1-10/P1-08's job, this task only builds the open/close mechanism
 * and the empty shell each of those tasks fills in. See
 * `layer-manager-context.ts` for the `LayerKind`/context types and
 * `useLayerManager`.
 *
 * `sheet` and `log` are both built on the same `<Sheet>` primitive
 * (T-260828-11) — `log` through `QuickLog` (T-260828-35), which renders one
 * — and every instance passes `closeOnEscape={false}`: the primitive's
 * standalone default is its own document-level Escape listener, which would
 * fire alongside the central handler here and close a sheet that isn't
 * topmost — one Esc taking two layers with it, the exact failure this
 * task's Risks section names. With the primitive's listener off, the
 * handler below is the only thing Esc reaches, so the palette and both
 * sheets stack freely in any order (the mockup keeps the create form and
 * quick-log independent, so ⌘L over a half-filled form must not discard it).
 *
 * The sixth kind, `tour` (T-260829-15), registers in this stack but is
 * *rendered* by `Shell.tsx`, not by the overlays list below: it needs the
 * routed shell's queries and `useNavigate`, and it is the one layer nothing
 * ever stacks under, so its position in DOM order — inside `children`,
 * therefore beneath every overlay here — is exactly where it belongs. It
 * still gets Esc, focus-return and `isTopmost` from this file, which is the
 * whole reason it joins the stack instead of listening for Escape itself.
 *
 * All three overlay wrappers are the mockup's `.scrim` at the same
 * z-index, so DOM order decides which paints on top: the overlays render
 * sorted by stack position, topmost last. Without that, a palette opened
 * over a sheet would focus its input while painting beneath the sheet's
 * scrim — keystrokes landing in an invisible search box.
 */
export function LayerManager({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<readonly LayerKind[]>([])
  // Which real form (T-260828-27) the generic 'sheet' layer is holding, and
  // what it is holding it *on* (T-260901-10: a new record, or one that
  // already exists). Null only before the first `openSheet`/`editSheet` —
  // every caller passes a kind (T-260829-08 made it required), so there is
  // no longer a state in which the layer is open holding nothing.
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null)
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

  // T-260901-16: see the context's doc comment. Guarded on the ref for the
  // same reason `closeLayer` is — a stable callback reading `stack` would
  // read the render that created it — and refusing to write a trigger for a
  // closed kind keeps `closeLayer`'s "no focus theft on a no-op close" rule
  // intact: a trigger is only ever stored for a layer that is open.
  const retargetLayer = useCallback((kind: LayerKind, trigger: HTMLElement | null) => {
    if (stackRef.current.includes(kind)) triggers.current[kind] = trigger
  }, [])

  const openSheetTarget = useCallback(
    (target: SheetTarget, trigger?: HTMLElement | null) => {
      // Matches `openLayer`'s own idempotency contract (see its comment: "a
      // held or repeated ⌘K [doing] nothing the first press didn't already
      // do") — extended here to the *content* a second call would pick,
      // not just the stack membership `openLayer` alone guards. Without
      // this, a second `openSheet` call while 'sheet' is already open (the
      // New button stays clickable — `Sheet` has no focus trap, so a stray
      // click can reopen the menu over an open sheet) would silently swap
      // which real form is mounted (code review, T-260828-27), discarding
      // every field the user had already typed into the one that was open.
      // T-260901-10 widens that from the kind to the whole target: an edit
      // sheet opened over a half-filled create form would discard it just
      // as thoroughly.
      if (!stackRef.current.includes('sheet')) {
        setSheetTarget(target)
      }
      openLayer('sheet', trigger)
    },
    [openLayer]
  )

  const openSheet = useCallback(
    (kind: SheetKind, trigger?: HTMLElement | null) => openSheetTarget({ kind, mode: 'create' }, trigger),
    [openSheetTarget]
  )

  const editSheet = useCallback(
    (kind: SheetKind, id: string, trigger?: HTMLElement | null) => openSheetTarget({ kind, mode: 'edit', id }, trigger),
    [openSheetTarget]
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
    () => ({ isOpen, isTopmost, openLayer, closeLayer, retargetLayer, openSheet, editSheet }),
    [isOpen, isTopmost, openLayer, closeLayer, retargetLayer, openSheet, editSheet]
  )

  // DOM order is paint order here (see the component comment): a closed
  // overlay renders null, so where the sort places it is irrelevant
  // (`indexOf` -1 sorts it before every open layer).
  const overlays: ReadonlyArray<{ kind: LayerKind; node: ReactNode }> = [
    {
      kind: 'palette',
      // P1-10's real command palette (T-260828-37), in place of this task's
      // empty shell. It renders the same `.scrim`/`.pal` markup the shell did
      // — including Esc being *absent* from it, since this file owns Esc for
      // every layer — and mounts only while the layer is open so each ⌘K
      // starts on a blank query.
      node: <CommandPalette open={isOpen('palette')} onClose={() => closeLayer('palette')} />
    },
    {
      kind: 'sheet',
      // T-260828-27's real forms, and nothing else: `SheetKind` is a closed
      // union (four originally, five since T-260901-11's `offering`) and
      // `openSheet` requires one, so this switch is
      // exhaustive and a sheet holding no form is unrepresentable. The
      // placeholder shell that used to be this switch's `default` — a
      // disabled Create button over a line of prose deferring the form to
      // P1-08 — is what the six list-view create buttons were opening
      // (T-260829-08); deleting it is what stops a seventh from doing so.
      //
      // The four real forms are mounted only while `isOpen('sheet')`, rather
      // than staying mounted and toggling `Sheet`'s own `open` prop. Each
      // form owns real field state
      // (company's `kind` chip, engagement's shared-vs-model fields, …);
      // mounting fresh on every open is what resets that state to blank
      // without an effect that sets state on every open (React's own
      // guidance — and this codebase's `react-hooks/set-state-in-effect`
      // lint rule — is to let a fresh mount do that, not an effect).
      // Unmounting on close is also behaviourally identical to what `Sheet`
      // already does when `open` flips false (`if (!open) return null`, no
      // exit transition to preserve).
      //
      // The keyed wrapper below extends that same guarantee to the *record*
      // (T-260901-10). Unmounting on close covers the ordinary path, but it
      // is not the only way the target can change: anything that closes and
      // reopens the layer inside one batch, or a future caller that swaps
      // the target while the layer is open, would otherwise leave the form
      // mounted with engagement A's field state showing under engagement
      // B's title. A key derived from the target makes a different record
      // a different element, so React remounts it and the `useState`
      // initialisers re-read from the new record — the same "fresh mount,
      // never a reset effect" rule this comment already states, applied to
      // the case that gets missed.
      //
      // Each `case` passes only what that form takes: `CompanySheet`
      // (T-260901-14), `EngagementSheet` and `OfferingSheet` read the target
      // (create vs. edit); `person` and `todo` are create-only today and gain
      // the prop when they gain the mode, without this switch changing shape
      // again.
      node: (() => {
        if (!sheetTarget || !isOpen('sheet')) return null
        const sheetOnClose = () => closeLayer('sheet')
        const targetKey = `${sheetTarget.kind}:${sheetTarget.mode === 'edit' ? sheetTarget.id : 'new'}`
        const form = (() => {
          switch (sheetTarget.kind) {
            case 'company':
              return <CompanySheet onClose={sheetOnClose} target={sheetTarget} />
            case 'person':
              return <PersonSheet onClose={sheetOnClose} />
            case 'engagement':
              return <EngagementSheet onClose={sheetOnClose} target={sheetTarget} />
            case 'todo':
              return <TodoSheet onClose={sheetOnClose} />
            case 'offering':
              return <OfferingSheet onClose={sheetOnClose} target={sheetTarget} />
          }
        })()
        return <Fragment key={targetKey}>{form}</Fragment>
      })()
    },
    {
      kind: 'log',
      // P1-09's real quick log (T-260828-35), in place of this task's empty
      // shell. `QuickLog` takes `open` rather than being mounted only while
      // the layer is open, unlike the four create sheets above: it owns the
      // confirmation toast that has to outlive the overlay closing, and
      // mounts its own form fresh internally so each open still starts blank.
      node: <QuickLog open={isOpen('log')} onClose={() => closeLayer('log')} />
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
