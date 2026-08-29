import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useLocation } from 'react-router'
import { useGlobalShortcuts } from '../../hooks/useGlobalShortcuts'
import { useMotionAttribute } from '../../hooks/useMotionAttribute'
import { ipcQueryFn } from '../../lib/ipc'
import { queryKeys } from '../../lib/query-keys'
import { Rail } from './Rail'
import { Topbar } from './Topbar'
import './Shell.css'

/**
 * `<div class="app">` from the mockup — the rail, the topbar, and the
 * routed view body (`<main id="view" class="view">`). Registers ⌘K/⌘L once
 * here (`useGlobalShortcuts`) so every route gets them for free rather than
 * each view wiring its own listener.
 *
 * Also applies `appearance.motion` here (T-260828-38 review), not only in
 * `WorkspaceSettings.tsx`: `ShellLayout` is the one component every route
 * mounts under (`routes.tsx` wraps the whole tree in it), and the app boots
 * on `/today` — a route that may never visit Settings in a given session.
 * Before this, `useMotionAttribute`'s only call site was inside the Settings
 * view itself, so turning motion off, restarting, and landing on `/today`
 * showed animation again while the switch still read "off": the settings
 * page appearing to work and not, the exact failure this task's Risks
 * section names. Reading the same `settings:getAll` snapshot here — the
 * query key `queryKeys.settings.list()` is shared, so this and
 * `WorkspaceSettings.tsx`'s own query dedupe to one request/cache entry, not
 * two — means the attribute is correct the moment the shell mounts,
 * regardless of which route that is.
 */
export function ShellLayout() {
  const motionQuery = useQuery({ queryKey: queryKeys.settings.list(), queryFn: ipcQueryFn('settings:getAll') })
  useMotionAttribute(motionQuery.data?.['appearance.motion'])

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

  // The other half of the mockup's `go()` — `scrollTo(0,0)` beside the
  // rail-close above — so a long list scrolled on one view doesn't leave the
  // next view starting mid-page. `scrollTop = 0` on both candidates rather
  // than `window.scrollTo` because whichever isn't the scroll container is a
  // silent no-op (and jsdom implements neither scroll method).
  const viewRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (viewRef.current) viewRef.current.scrollTop = 0
    document.documentElement.scrollTop = 0
  }, [location.pathname])

  return (
    <div className="app">
      <Rail open={railOpen} onNavigate={() => setRailOpen(false)} />
      <div className="main">
        <Topbar onToggleRail={() => setRailOpen((open) => !open)} />
        <main className="view" ref={viewRef}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
