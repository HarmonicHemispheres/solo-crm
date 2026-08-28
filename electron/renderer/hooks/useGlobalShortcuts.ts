import { useEffect } from 'react'
import { useLayerManager } from '../components/shell/layer-manager-context'

/**
 * ⌘K (search) and ⌘L (quick-log) — registered once, here, so the shell owns
 * the shortcut and P1-09/P1-10 only have to own what opens. Ctrl is
 * accepted alongside Cmd for Windows/Linux (`event.metaKey || event.ctrlKey`,
 * matching the mockup's own `mod` check).
 *
 * Fires with focus inside a text input: keydown bubbles to `document`
 * regardless of the focused element (a plain `<input>` doesn't stop
 * propagation), and there is nothing here that special-cases focus — the
 * task's own risk note is that skipping the shortcut while an input is
 * focused is exactly the bug, since quick-capture is used from inputs.
 * `preventDefault` runs unconditionally for a recognised combo, before the
 * open check, since a missed `preventDefault` is a browser/OS default
 * winning inside an input even when the layer itself doesn't need to open.
 *
 * Does not fire twice while the layer is already open: `openLayer` in
 * LayerManager.tsx is idempotent for an already-open kind, and the
 * `isOpen` guard below keeps a held or OS-repeated key from doing anything
 * beyond the first press (and from needlessly re-capturing
 * `document.activeElement` as the layer's focus-return target).
 */
export function useGlobalShortcuts() {
  const { isOpen, openLayer } = useLayerManager()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()

      if (key === 'k') {
        event.preventDefault()
        if (!isOpen('palette')) openLayer('palette')
      } else if (key === 'l') {
        event.preventDefault()
        if (!isOpen('log')) openLayer('log')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, openLayer])
}
