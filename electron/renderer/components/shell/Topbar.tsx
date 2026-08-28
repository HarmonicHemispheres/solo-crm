import { useRef } from 'react'
import { IconButton } from '../primitives/IconButton'
import { useLayerManager } from './layer-manager-context'
import { Breadcrumb } from './Breadcrumb'
import { NewMenu } from './NewMenu'
import { MenuToggleIcon, SearchIcon } from './icons'
import './Topbar.css'

export interface TopbarProps {
  onToggleRail: () => void
}

/** `<header class="topbar">` from the mockup — the rail toggle (visible only
 * below 900px, Topbar.css), the breadcrumb, the search button (⌘K's click
 * entry point), and the New menu. */
export function Topbar({ onToggleRail }: TopbarProps) {
  const { openLayer } = useLayerManager()
  const searchButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <header className="topbar">
      <IconButton className="menutoggle" aria-label="Toggle navigation" onClick={onToggleRail}>
        <MenuToggleIcon />
      </IconButton>
      <Breadcrumb />
      <button
        ref={searchButtonRef}
        type="button"
        className="searchbtn"
        onClick={() => openLayer('palette', searchButtonRef.current)}
      >
        <SearchIcon width={14} height={14} />
        <span className="lbl">Search everything</span>
        <span className="kbd">⌘K</span>
      </button>
      <NewMenu />
    </header>
  )
}
