import { useState } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts'
import { Rail } from './Rail'
import { Topbar } from './Topbar'
import './Shell.css'

/**
 * `<div class="app">` from the mockup — the rail, the topbar, and the
 * routed view body (`<main id="view" class="view">`). Registers ⌘K/⌘L once
 * here (`useGlobalShortcuts`) so every route gets them for free rather than
 * each view wiring its own listener.
 */
export function ShellLayout() {
  const [railOpen, setRailOpen] = useState(false)
  const location = useLocation()

  // The mockup's own `go()` closes the off-canvas rail on every navigation
  // (`$('#rail').classList.remove('open')`) — harmless above 900px, where
  // the class has no visual effect (Rail.css only reads it inside the
  // `max-width:900px` query). Adjusted during render, not in an effect
  // (react.dev's "Adjusting state when a prop changes"): an effect here
  // would run an extra commit after every navigation just to close a rail
  // that's already closed on desktop, and react-hooks flags a bare
  // `setState` inside an effect body for exactly that cascading-render cost.
  const [lastPathname, setLastPathname] = useState(location.pathname)
  if (location.pathname !== lastPathname) {
    setLastPathname(location.pathname)
    setRailOpen(false)
  }

  useGlobalShortcuts()

  return (
    <div className="app">
      <Rail open={railOpen} onNavigate={() => setRailOpen(false)} />
      <div className="main">
        <Topbar onToggleRail={() => setRailOpen((open) => !open)} />
        <main className="view">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
