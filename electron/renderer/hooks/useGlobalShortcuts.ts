import { useEffect } from 'react'
import { useLayerManager } from '../components/shell/layer-manager-context'
import type { LayerKind } from '../components/shell/layer-manager-context'

/**
 * One entry per combo this hook binds — the single source both the keydown
 * handler below and the Workspace Settings shortcut reference (T-260828-38)
 * read from, so the reference can never list a combo this hook doesn't
 * actually bind (or omit one it does) without a test catching the drift.
 * `key` is `KeyboardEvent.key`, lowercased, checked alongside `event.metaKey
 * || event.ctrlKey` — every entry here is a Cmd/Ctrl combo, matching this
 * hook's own scope (T-260828-12: Esc lives in LayerManager, which owns it
 * outright; arrow/enter palette navigation is internal to the palette
 * layer's own component, not a document-level binding this hook makes —
 * neither belongs in this list).
 */
export interface GlobalShortcut {
  readonly key: string
  readonly label: string
  readonly layer: LayerKind
}

export const GLOBAL_SHORTCUTS: readonly GlobalShortcut[] = [
  { key: 'k', label: 'Search everything', layer: 'palette' },
  { key: 'l', label: 'Log a touch', layer: 'log' }
]

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
 *
 * Loops over `GLOBAL_SHORTCUTS` (T-260828-38) rather than an if/else per
 * combo — same behaviour, but the set of bound combos now lives in one
 * place a reference UI can read instead of being implied by this function's
 * branches.
 */
export function useGlobalShortcuts() {
  const { isOpen, openLayer } = useLayerManager()

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (!mod) return
      const key = event.key.toLowerCase()
      const shortcut = GLOBAL_SHORTCUTS.find((entry) => entry.key === key)
      if (!shortcut) return

      event.preventDefault()
      if (!isOpen(shortcut.layer)) openLayer(shortcut.layer)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, openLayer])
}
