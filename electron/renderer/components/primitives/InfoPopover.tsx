import { useContext, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { LayerManagerContext } from '../shell/layer-manager-context'
import './InfoPopover.css'

export interface InfoPopoverProps {
  /** The `.pop` panel's content — the prose this affordance hides until asked. */
  children: ReactNode
  /**
   * Names what the popover explains, for the icon-only trigger. Required,
   * never defaulted: `ui-design.md` makes an `aria-label` a contract for
   * every icon-only control, and the one string that would be a plausible
   * default — `ViewHeader`'s "About this view" — is wrong the moment this
   * sits beside a settings row rather than a view heading.
   */
  'aria-label': string
}

/**
 * The mockup's `.info` button and its `.pop` panel, lifted out of
 * `ViewHeader` (T-260901-06) so anything — a settings section, a single
 * row — can carry one. Click to open, click again, Escape, or a pointerdown
 * outside to close; `aria-expanded` tracks the state and `aria-controls`
 * names the panel, whose id comes from `useId`, so two on one page never
 * collide.
 *
 * **It joins the layer stack.** On open it registers `popover` with
 * `LayerManager` and it does *not* install an Escape listener of its own
 * while that manager is present. `LayerManager` owns Escape for every layer
 * precisely so one keypress cannot close two things: a popover opened inside
 * an open sheet stacks as `['sheet', 'popover']`, the first Escape closes
 * only the popover (topmost) and returns focus to this trigger, and a second
 * closes the sheet. An Escape handler here as well — the shape `ViewHeader`
 * had, and the shape `Sheet`'s `closeOnEscape={false}` exists to switch off —
 * would fire alongside the central one and take the sheet with it.
 *
 * The Escape listener below therefore runs *only* when there is no provider
 * above this component (`layers === null`), which is a rendered-in-isolation
 * test or a future non-shell mount, not the app. That is the same bargain
 * `Sheet` strikes, made automatic rather than passed in as a prop, because
 * unlike `Sheet` this primitive is meant to be dropped anywhere and there is
 * no caller who would reliably know the answer.
 *
 * Being on the stack also means the manager, not this component, decides
 * when the layer is gone: `open` below is this instance's own toggle **and**
 * the layer still being open, so ⌘K opening the palette over an open popover
 * (`CLOSES_MENU_AND_POPOVER`) closes the popover with no state sync here.
 * Only one `popover` layer exists, so only one of these can be open at a
 * time under a manager — which is what a click-to-open affordance does
 * anyway, since opening a second one starts with a pointerdown outside the
 * first. That second one finds the layer still registered to the first's
 * button, so it retargets the layer rather than re-opening it
 * (T-260901-16); otherwise Escape would put focus back on the wrong button.
 */
export function InfoPopover({ children, 'aria-label': ariaLabel }: InfoPopoverProps) {
  // Deliberately `useContext` rather than `useLayerManager()`: that hook
  // throws without a provider, and this primitive must render outside the
  // shell (ViewHeader.test.tsx mounts one bare).
  const layers = useContext(LayerManagerContext)
  const standalone = layers === null
  const [selfOpen, setSelfOpen] = useState(false)
  const popoverId = useId()
  const wrapRef = useRef<HTMLSpanElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const layerOpen = standalone || layers.isOpen('popover')

  // T-260901-16: when the manager drops the layer from under this instance
  // (Escape, or ⌘K/⌘L opening a heavier layer), `selfOpen` has to follow it
  // down. Left standing, it would make `open` true again the moment *any*
  // other InfoPopover re-registers the layer — close A with Escape, click
  // B, and both panels are on screen. Reset during render rather than in an
  // effect (React's "adjusting state when a prop changes" pattern, and what
  // `react-hooks/set-state-in-effect` exists to steer towards): the reset is
  // derived from the same render that observed the layer go, not a frame
  // behind it.
  const [seenLayerOpen, setSeenLayerOpen] = useState(layerOpen)
  if (layerOpen !== seenLayerOpen) {
    setSeenLayerOpen(layerOpen)
    if (!layerOpen) setSelfOpen(false)
  }

  const open = selfOpen && layerOpen

  useEffect(() => {
    if (!open || !standalone) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSelfOpen(false)
      // Under a manager this is `closeLayer`'s job; standalone there is
      // nothing else to put focus back where the user left it.
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, standalone])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      // Hides the panel only. The layer itself is dropped by
      // `LayerManager`'s own document `click` listener, which exists for
      // exactly this and deliberately does *not* route through `closeLayer`:
      // an outside click is the user putting focus somewhere else, and
      // yanking it back to this button would be the bug.
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setSelfOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const handleToggle = () => {
    if (open) {
      setSelfOpen(false)
      layers?.closeLayer('popover')
    } else {
      setSelfOpen(true)
      // T-260901-16: if another InfoPopover already holds the single
      // `popover` layer, `openLayer` would be a no-op — trigger write
      // included — leaving Escape to return focus to *that* button. Take
      // the layer over instead, so focus comes back here. A mouse click's
      // pointerdown has already hidden the other panel; a keyboard
      // activation (Enter/Space) has not, and it stays visible until the
      // layer closes — focus is still right, and the reset above then
      // clears both.
      if (layers?.isOpen('popover')) layers.retargetLayer('popover', buttonRef.current)
      else layers?.openLayer('popover', buttonRef.current)
    }
  }

  return (
    <span
      className="info-wrap"
      ref={wrapRef}
      // Same guard NewMenu's toggle uses, widened to the whole affordance:
      // `LayerManager` closes `popover` on any document click, so without
      // this the click that opens this one would immediately drop the layer
      // again, and a click *inside* the panel (selecting a word of the
      // prose) would dismiss it.
      onClick={(event: MouseEvent<HTMLSpanElement>) => event.stopPropagation()}
    >
      <button
        type="button"
        className="info"
        ref={buttonRef}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={handleToggle}
      >
        i
      </button>
      {open && (
        <div id={popoverId} className="pop open">
          {children}
        </div>
      )}
    </span>
  )
}
