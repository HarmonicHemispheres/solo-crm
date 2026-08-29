import type { LayerManagerContextValue, SheetKind } from './layer-manager-context'

/**
 * Every "make a new thing" action the shell offers, in one table
 * (T-260828-37 / P1-10).
 *
 * The command palette leads with these — §6.9's "one keystroke that reaches
 * any record *and any create action*" — and the topbar's New menu draws a
 * subset of the same set. Two hand-maintained lists of create actions is
 * exactly the drift `nav.ts`'s `ROUTE_META` was written to prevent for
 * routes, so this file plays `ROUTE_META`'s part: the table is written once
 * here, `NewMenu.tsx` keeps its own hand-written JSX (a menu item is a real
 * button with an icon and a key badge, not a row rendered from data), and
 * `CommandPalette.test.tsx` asserts every item the menu actually renders is
 * present in this table. A create action added to the menu and not here —
 * or renamed in one and not the other — fails that test rather than quietly
 * becoming unreachable from ⌘K.
 *
 * Plain data plus one dispatch function, no JSX: `react-refresh/only-export-components`
 * disallows a file mixing component and non-component exports, and both the
 * palette (a component) and its test need this table.
 */
export interface CreateCommand {
  /** Stable key — used as the palette row's React key and in tests, never shown. */
  readonly id: 'company' | 'person' | 'engagement' | 'todo' | 'touch'
  /** The word the New menu draws for this action ("Company"). */
  readonly menuLabel: string
  /** The whole phrase the palette draws ("New company") — the mockup's own `'New '+n.toLowerCase()`. */
  readonly paletteLabel: string
  /** Mono hint on the palette row; only the quick log has one worth showing (its own shortcut). */
  readonly hint?: string
  /**
   * Which create form the generic `sheet` layer should hold. Absent for a
   * command that opens a different layer entirely — see `layer` below.
   * Exactly one of `sheet` / `layer` is set; `runCreateCommand` is the only
   * place that distinction is read.
   *
   * It carried a `title` alongside `kind` until T-260829-11, which was only
   * ever forwarded to `openSheet`'s dead `title` argument. What the palette
   * *shows* is `paletteLabel` and what the New menu shows is `menuLabel` —
   * both above, both still read, both untouched by that deletion.
   */
  readonly sheet?: { readonly kind: SheetKind }
  /** The layer this command opens when it isn't a create form — the quick log. */
  readonly layer?: 'log'
}

/**
 * Order is the New menu's own (Company, Person, Engagement, … Touch last),
 * so the palette's create block and the menu read the same way top to
 * bottom. Todo sits between Engagement and Touch: `TodoSheet` (T-260828-27)
 * exists and `SheetKind` names it, the mockup's palette offers it, and the
 * New menu simply doesn't draw it — which is why the drift test asserts the
 * menu is a *subset* of this table rather than equal to it.
 */
export const CREATE_COMMANDS: readonly CreateCommand[] = [
  { id: 'company', menuLabel: 'Company', paletteLabel: 'New company', sheet: { kind: 'company' } },
  { id: 'person', menuLabel: 'Person', paletteLabel: 'New person', sheet: { kind: 'person' } },
  { id: 'engagement', menuLabel: 'Engagement', paletteLabel: 'New engagement', sheet: { kind: 'engagement' } },
  { id: 'todo', menuLabel: 'Todo', paletteLabel: 'New todo', sheet: { kind: 'todo' } },
  // The palette's "log activity" entry (this task's scope: the quick log is
  // T-260828-35's own overlay and its own ⌘L shortcut — the palette opens
  // it, it does not reimplement it).
  { id: 'touch', menuLabel: 'Touch', paletteLabel: 'Log a touch', hint: '⌘L', layer: 'log' }
]

/**
 * Runs one command through the layer manager. `trigger` is the element focus
 * returns to once the opened layer closes — the palette passes the control
 * that was focused before it opened, so Esc out of a create form lands back
 * where the user started rather than on a button that no longer exists.
 *
 * Takes the whole context value rather than the two callbacks separately so
 * a command that later needs a third one (a popover, say) is a change to
 * this function alone.
 */
export function runCreateCommand(
  command: CreateCommand,
  layers: Pick<LayerManagerContextValue, 'openLayer' | 'openSheet'>,
  trigger?: HTMLElement | null
): void {
  if (command.sheet) {
    layers.openSheet(command.sheet.kind, trigger)
    return
  }
  if (command.layer) layers.openLayer(command.layer, trigger)
}
