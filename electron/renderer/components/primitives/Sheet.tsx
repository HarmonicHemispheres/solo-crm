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
 * click that isn't a click inside the sheet, matching the mockup's own
 * listeners (it has no focus trap either — Tab can still reach the page
 * behind it, which is a known gap carried over rather than one this task
 * introduces). Opening moves focus onto the sheet so keyboard users don't
 * have to hunt for it.
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

  if (!open) return null

  return (
    <div
      className="scrim open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
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
