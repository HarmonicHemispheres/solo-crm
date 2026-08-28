import { createContext, useContext } from 'react'

/**
 * Every layer this shell can stack, in the exact set T-260828-12's scope
 * names: "palette, sheet, log sheet, menu and popover". `sheet` is the
 * generic create-form shell the New menu opens (P1-08 gives it real
 * content); `log` is quick-log (P1-09); `palette` is ⌘K (P1-10); `menu` is
 * the New dropdown itself; `popover` exists so a future `.info` popover can
 * register with this same stack — nothing in this task opens one.
 *
 * Split into its own file (no component here) rather than living inside
 * LayerManager.tsx: `react-refresh/only-export-components` disallows a file
 * mixing a component export with non-component ones, and this context +
 * hook pair is exactly that kind of non-component export.
 */
export type LayerKind = 'palette' | 'sheet' | 'log' | 'menu' | 'popover'

export interface LayerManagerContextValue {
  /** Is `kind` open at all, regardless of what else is stacked above it? */
  isOpen: (kind: LayerKind) => boolean
  /** Is `kind` open AND nothing else is stacked above it? Esc closes only
   * the topmost layer, so a component that wants to know "am I the one Esc
   * would close right now" asks this, not `isOpen`. */
  isTopmost: (kind: LayerKind) => boolean
  /**
   * Opens `kind`. `trigger` is the element focus returns to when this layer
   * closes — omit it to capture `document.activeElement` at call time (the
   * right default for a keyboard shortcut, where there is no button to
   * point at). Idempotent: calling this while `kind` is already open is a
   * no-op, which is what keeps a held or repeated ⌘K from doing anything
   * the first press didn't already do.
   */
  openLayer: (kind: LayerKind, trigger?: HTMLElement | null) => void
  /** Closes `kind` if open and returns focus to its stored trigger. */
  closeLayer: (kind: LayerKind) => void
  /** The generic 'sheet' layer's title — see `openSheet`. */
  sheetTitle: string
  /** Opens the generic 'sheet' layer with a title (the New menu's Company /
   * Person / Engagement items each want a different one). A dedicated
   * setter rather than overloading `openLayer` with a payload argument that
   * only one of five layer kinds ever uses. */
  openSheet: (title: string, trigger?: HTMLElement | null) => void
}

export const LayerManagerContext = createContext<LayerManagerContextValue | null>(null)

export function useLayerManager(): LayerManagerContextValue {
  const value = useContext(LayerManagerContext)
  if (!value) throw new Error('useLayerManager must be used within <LayerManager>')
  return value
}
