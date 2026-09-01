import { createContext, useContext } from 'react'

/**
 * Every layer this shell can stack, in the exact set T-260828-12's scope
 * names: "palette, sheet, log sheet, menu and popover". `sheet` is the
 * generic create-form shell the New menu opens (P1-08 gives it real
 * content); `log` is quick-log (P1-09); `palette` is ⌘K (P1-10); `menu` is
 * the New dropdown itself; `popover` exists so a future `.info` popover can
 * register with this same stack — nothing in this task opens one.
 *
 * `tour` (T-260829-15) is the first-run walkthrough overlay, and it joins
 * this stack rather than owning a `keydown` listener of its own for the
 * exact reason `Sheet` passes `closeOnEscape={false}`: two document-level
 * Escape handlers means one keypress closes two layers. Registering here
 * also buys the tour the two other things this stack already owns — focus
 * returning to whatever opened it (the Workspace Settings "Take the tour"
 * button), and `isTopmost`, so a palette opened over the tour takes the
 * Escape and the tour stays put.
 *
 * Split into its own file (no component here) rather than living inside
 * LayerManager.tsx: `react-refresh/only-export-components` disallows a file
 * mixing a component export with non-component ones, and this context +
 * hook pair is exactly that kind of non-component export.
 */
export type LayerKind = 'palette' | 'sheet' | 'log' | 'menu' | 'popover' | 'tour'

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

/**
 * What a sheet is open *on* — the half of a `SheetTarget` a form actually
 * needs once `LayerManager`'s switch has dispatched on `kind` (T-260901-10).
 *
 * A discriminated union rather than an optional `id?: string`, deliberately.
 * T-260829-08's lesson was that an optional argument which changes what the
 * sheet *is* gets left off and fails silently; the same applies one level
 * down. With this shape a form cannot read `target.id` without having first
 * proved it is in edit mode, and "create" is a value that had to be written
 * rather than the absence of one.
 */
export type SheetFormTarget = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly id: string }

/** A `SheetFormTarget` plus the kind that decides which form `LayerManager` mounts. */
export type SheetTarget = SheetFormTarget & { readonly kind: SheetKind }

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
  /** Opens the generic 'sheet' layer holding `kind`'s real form. A dedicated
   * setter rather than overloading `openLayer` with a payload argument that
   * only one of five layer kinds ever uses.
   *
   * `kind` is required (T-260829-08): it is the argument that decides which
   * form appears, so it must not be the one that is easiest to leave off.
   *
   * It took a `title` too until T-260829-11. That title was the placeholder
   * shell's `<Sheet title>`/`aria-label`, and T-260829-08 deleted the shell;
   * each of the four real forms hardcodes its own title and `aria-label`, so
   * nothing read the argument any more. A required argument that feeds
   * nothing asks every new create button for a string that goes nowhere.
   *
   * This still means "new", and only "new" — opening a sheet on a record
   * that already exists is `editSheet` below, not an optional tail on this
   * one (T-260901-10). */
  openSheet: (kind: SheetKind, trigger?: HTMLElement | null) => void
  /**
   * Opens the generic 'sheet' layer holding `kind`'s form, bound to an
   * existing record (T-260901-10). A second method rather than an optional
   * `id` on `openSheet`, for the reason that task's Risks section names: an
   * optional argument that changes what the sheet *is* re-opens exactly the
   * hole T-260829-08 closed. `id` is required and sits before `trigger`, so
   * "edit" cannot be written without saying what is being edited, and a
   * create call cannot drift into an edit one by a typo.
   *
   * The form for `kind` has to support edit mode for this to do anything
   * useful; `engagement` does (T-260901-10), `company` follows in
   * T-260901-14. Same idempotency contract as `openSheet`: calling either
   * while 'sheet' is already open does not swap what is mounted.
   */
  editSheet: (kind: SheetKind, id: string, trigger?: HTMLElement | null) => void
}

export const LayerManagerContext = createContext<LayerManagerContextValue | null>(null)

export function useLayerManager(): LayerManagerContextValue {
  const value = useContext(LayerManagerContext)
  if (!value) throw new Error('useLayerManager must be used within <LayerManager>')
  return value
}
