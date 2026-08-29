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

/**
 * Which create form the generic `sheet` layer is currently holding
 * (T-260828-27). A closed union of four, every member of which has a real
 * form — `LayerManager`'s switch over it is exhaustive, so a sheet with no
 * content is unrepresentable. It was optional until T-260829-08, and the
 * six list-view create buttons that never passed it opened a placeholder
 * shell with a disabled Create button and no fields: no error, no warning,
 * a plausible sheet with the right title. Making it required — and first,
 * since a required parameter cannot follow an optional one — moved that
 * from "everyone must remember" to "the type checker will not compile it".
 */
export type SheetKind = 'company' | 'person' | 'engagement' | 'todo'

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
  /**
   * The title the currently-open 'sheet' layer was opened with — see
   * `openSheet`.
   *
   * Nothing reads this today: it was the placeholder shell's own
   * `<Sheet title>`/`aria-label`, and T-260829-08 deleted that shell. Each
   * of the four real forms hardcodes its own title and `aria-label`, so no
   * sheet depends on this for its accessible name.
   */
  sheetTitle: string
  /** Opens the generic 'sheet' layer holding `kind`'s real form. A dedicated
   * setter rather than overloading `openLayer` with a payload argument that
   * only one of five layer kinds ever uses.
   *
   * `kind` leads and is required (T-260829-08): it is the argument that
   * decides which form appears, so it must not be the one that is easiest
   * to leave off the end — and with a closed union first, two positional
   * strings swapped by mistake is a type error rather than a form titled
   * "New person" containing a company's fields. */
  openSheet: (kind: SheetKind, title: string, trigger?: HTMLElement | null) => void
}

export const LayerManagerContext = createContext<LayerManagerContextValue | null>(null)

export function useLayerManager(): LayerManagerContextValue {
  const value = useContext(LayerManagerContext)
  if (!value) throw new Error('useLayerManager must be used within <LayerManager>')
  return value
}
