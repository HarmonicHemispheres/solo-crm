import { useEffect, useRef, type ReactNode } from 'react'
import './Sheet.css'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Right-aligned text next to the title — the mockup uses this for the
   * record kind ("Company") or a date ("2026-08-27"). */
  titleMeta?: ReactNode
  /** `.sheet-b` content. Wrap two fields in a `<div className="two">` for
   * the mockup's side-by-side field pairs — it collapses to one column
   * below the shared tablet breakpoint along with everything else here. */
  children: ReactNode
  footer: ReactNode
  /** `.sheet-f .note` — e.g. "resets the cadence clock". */
  footerNote?: ReactNode
  /** Default true: the sheet closes itself on Escape via its own
   * document-level listener, the mockup's standalone behaviour. Set false
   * when a central manager owns Esc dismissal (LayerManager.tsx) — two
   * listeners on the same press means one Esc closes two layers. */
  closeOnEscape?: boolean
  'aria-label': string
}

/**
 * `.scrim` + `.sheet` from the mockup — the modal used for every create
 * form and the "Log a touch" panel. Closes on Escape (unless
 * `closeOnEscape={false}` hands that to a central manager) and on a scrim
 * click that both began and ended on the scrim (see `handleScrimMouseDown`
 * below), matching the mockup's own listeners (it has no focus trap either
 * — Tab can still reach the page behind it, which is a known gap carried
 * over rather than one this task introduces). Opening moves focus onto the
 * sheet so keyboard users don't have to hunt for it.
 */
export function Sheet({ open, onClose, title, titleMeta, children, footer, footerNote, closeOnEscape = true, 'aria-label': ariaLabel }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)

  // Held in a ref so the focus effect depends on `open` alone: with onClose
  // in the deps, an inline-arrow onClose re-runs the effect every parent
  // render and yanks focus back onto the dialog mid-typing. Kept current
  // from an effect (not during render, per react-hooks/refs).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    sheetRef.current?.focus()
    if (!closeOnEscape) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, closeOnEscape])

  /**
   * Where the press that might become a scrim click started.
   *
   * `onClick` alone is not enough, and the gap is not theoretical — it was
   * the single most destructive bug in the app. A `click` event fires on the
   * nearest common ancestor of where the mouse went *down* and where it came
   * *up*, so pressing inside a field and releasing anywhere outside the
   * sheet — which is exactly what selecting the text already in a field
   * looks like — lands a click whose `target` is the scrim itself. The old
   * `event.target === event.currentTarget` test could not tell that apart
   * from a deliberate click on the backdrop, so the sheet closed and every
   * unsaved edit went with it.
   *
   * That made *editing* far worse than creating: on a create form the
   * fields start empty and there is nothing to select, while editing an
   * existing record begins by dragging across a value to replace it. The
   * user's report was "whenever I try to edit, the form disappears", and
   * this was why.
   *
   * So the press is recorded and the click only counts when both ends of it
   * were on the backdrop. Note this deliberately does not close on
   * mousedown: a press on the scrim that drags back *into* the sheet is
   * not a dismissal either, and waiting for the click is what lets both
   * cases be judged on the same event.
   */
  const pressStartedOnScrim = useRef(false)

  if (!open) return null

  return (
    <div
      className="scrim open"
      onMouseDown={(event) => {
        pressStartedOnScrim.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnScrim.current) onClose()
        pressStartedOnScrim.current = false
      }}
    >
      <div className="sheet" role="dialog" aria-label={ariaLabel} aria-modal="true" tabIndex={-1} ref={sheetRef}>
        <div className="sheet-h">
          <h2>{title}</h2>
          {titleMeta != null && <span className="meta sheet-h-meta">{titleMeta}</span>}
        </div>
        <div className="sheet-b">{children}</div>
        <div className="sheet-f">
          {footerNote != null && <span className="note">{footerNote}</span>}
          {footer}
        </div>
      </div>
    </div>
  )
}
