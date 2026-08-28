import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import './ViewHeader.css'

/** `--c` isn't part of the standard style-object typing. */
type StyleWithAccent = CSSProperties & { '--c': string }

export interface ViewHeaderProps {
  /** The view's icon, as an inline `<svg>` (see components/icons.tsx or a
   * view-local icon — nav/view glyphs are per-view, not part of this
   * shared set). Drawn on `--c`, this header's accent colour. */
  icon: ReactNode
  /** A token reference (e.g. `"var(--verdigris)"`), not a literal colour —
   * every view in the mockup picks one of the existing palette tokens for
   * its `--c`, it doesn't introduce new ones. */
  accent: string
  title: ReactNode
  /** Enables the "About this view" info button + popover when given. */
  description?: ReactNode
  /** Right-aligned `.acts` slot — a Toggle, an addBtn-alike, or nothing. */
  actions?: ReactNode
}

/** `H()` from the mockup — every view's opening header: accent icon, `<h1>`
 * title, an optional info popover, and a right-aligned actions slot. */
export function ViewHeader({ icon, accent, title, description, actions }: ViewHeaderProps) {
  const [open, setOpen] = useState(false)
  const popoverId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="vhead">
      <div className="t">
        <span className="vicon" style={{ '--c': accent } as StyleWithAccent}>
          {icon}
        </span>
        <h1>{title}</h1>
        {description != null && (
          <span className="info-wrap" ref={wrapRef}>
            <button
              type="button"
              className="info"
              aria-label="About this view"
              aria-expanded={open}
              aria-controls={popoverId}
              onClick={() => setOpen((o) => !o)}
            >
              i
            </button>
            {open && (
              <div id={popoverId} className="pop open">
                {description}
              </div>
            )}
          </span>
        )}
      </div>
      {actions != null && <div className="acts">{actions}</div>}
    </div>
  )
}
