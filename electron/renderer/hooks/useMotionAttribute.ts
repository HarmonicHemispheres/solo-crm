import { useEffect } from 'react'

/**
 * The in-app override for `appearance.motion`, mirroring the OS
 * `prefers-reduced-motion` effect base.css already handles centrally. Writes
 * a `data-motion` attribute to the document root rather than a component
 * style: base.css's rule targets that attribute globally (every view, not
 * just Workspace Settings), and no cleanup runs on unmount — the setting is
 * a workspace-wide preference, not something scoped to whichever view last
 * rendered it.
 *
 * The sole writer of `data-motion` in the app — called from `Shell.tsx` so
 * the attribute is correct at boot on whichever route the app opens to (not
 * only after a visit to `/workspace/settings`; T-260828-38 review), and
 * again from `WorkspaceSettings.tsx` so the switch there reflects instantly
 * without waiting on Shell's own query to resolve. Both call sites derive
 * from the same `settings:getAll` snapshot (react-query dedupes the
 * network/cache side of that), so the two writes never disagree — the
 * second call is a no-op read producing the same attribute the first
 * already set.
 */
export function useMotionAttribute(motionOn: boolean | undefined) {
  useEffect(() => {
    if (motionOn == null) return
    if (motionOn) {
      document.documentElement.removeAttribute('data-motion')
    } else {
      document.documentElement.setAttribute('data-motion', 'off')
    }
  }, [motionOn])
}
