import { useRef, type MouseEvent } from 'react'
import { useLayerManager } from './layer-manager-context'
import { NewCompanyIcon, NewEngagementIcon, NewPersonIcon, TouchIcon } from './icons'
// PlusIcon lives in the shared components/icons.tsx (T-260828-11 already
// uses it for QuickAdd's leading glyph) — reused here rather than redrawn.
import { PlusIcon } from '../icons'
import './NewMenu.css'
import './buttons.css'

/**
 * `.menuwrap` / `#newMenu` from the mockup — the topbar's "New" button and
 * its dropdown. Each item opens the generic `sheet` layer with its own
 * title (P1-08 gives the form itself real content); "Touch" opens `log`,
 * the same layer ⌘L opens. Opening any of those already closes this menu
 * (LayerManager's `CLOSES_MENU_AND_POPOVER`); the toggle button itself
 * stops the click from propagating to LayerManager's outside-click closer,
 * matching the mockup's own `toggleMenu(e){e.stopPropagation();...}`.
 */
export function NewMenu() {
  const { isOpen, openLayer, closeLayer, openSheet } = useLayerManager()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const open = isOpen('menu')

  const handleToggle = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (open) closeLayer('menu')
    else openLayer('menu', buttonRef.current)
  }

  return (
    <div className="menuwrap">
      <button ref={buttonRef} type="button" className="btn btn-prim" onClick={handleToggle} aria-expanded={open} aria-haspopup="menu">
        <PlusIcon />
        New
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Create">
          <button type="button" role="menuitem" onClick={() => openSheet('New company', buttonRef.current)}>
            <NewCompanyIcon />
            Company
            <span className="k">C</span>
          </button>
          <button type="button" role="menuitem" onClick={() => openSheet('New person', buttonRef.current)}>
            <NewPersonIcon />
            Person
            <span className="k">P</span>
          </button>
          <button type="button" role="menuitem" onClick={() => openSheet('New engagement', buttonRef.current)}>
            <NewEngagementIcon />
            Engagement
            <span className="k">E</span>
          </button>
          <button type="button" role="menuitem" onClick={() => openLayer('log', buttonRef.current)}>
            <TouchIcon />
            Touch
            <span className="k">⌘L</span>
          </button>
        </div>
      )}
    </div>
  )
}
