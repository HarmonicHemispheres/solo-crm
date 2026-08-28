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
  'aria-label': string
}

/**
 * `.scrim` + `.sheet` from the mockup — the modal used for every create
 * form and the "Log a touch" panel. Closes on Escape and on a scrim click
 * that isn't a click inside the sheet, matching the mockup's own listeners
 * exactly (it has no focus trap either — Tab can still reach the page
 * behind it, which is a known gap carried over rather than one this task
 * introduces). Opening moves focus onto the sheet so keyboard users don't
 * have to hunt for it.
 */
export function Sheet({ open, onClose, title, titleMeta, children, footer, footerNote, 'aria-label': ariaLabel }: SheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    sheetRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

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
