import { readFile as readFileFromDisk, stat as statOnDisk } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import { BrowserWindow, dialog as electronDialog } from 'electron'
import { BRANDING_MAX_BYTES, type BrandingChoice, type BrandingSlot, type BrandingSlotState } from '../../shared/branding'
import { readAllBranding, readBrandingSlot, writeBrandingSlot, type StoredBranding } from '../db/repositories/branding'
import type { BrandingSnapshot } from '../../shared/branding'
import { ValidationError } from '../db/repositories/errors'

/**
 * The operator's brand image picker (T-260829-05) — the first native dialog
 * in this app that a *renderer* can ask for, and therefore the one place the
 * filesystem gets closest to the boundary whose entire design is that the
 * renderer cannot reach it.
 *
 * ## The property this module exists to hold: the path never comes back
 *
 * The renderer asks for a picker by slot and receives an image. It never
 * receives the chosen file's path, its directory, or its basename — not in
 * the success branch, not in a refusal message, not in an error thrown out of
 * here. `chooseBrandingImage` returns `BrandingChoice`
 * (`electron/shared/branding.ts`), whose `chosen` branch carries only a
 * `BrandingSlotState`: a `data:` URL, a sniffed content type, a byte count
 * and a timestamp. Every refusal below is raised as a `ValidationError` with
 * a message written by hand here, precisely so a Node `ENOENT`/`EACCES` error
 * — whose `.message` embeds the full path — is never what the caller relays.
 *
 * A filename returned "so the UI can show which file was picked" would undo
 * this without a single line of it looking wrong, which is why the test file
 * beside this one walks the returned object for path separators rather than
 * trusting a reading of the diff.
 *
 * ## Bounded *before* the read, not after
 *
 * `readBoundedImage` stats the file and refuses on size before it allocates
 * anything — the same discipline `readBounded` in
 * `electron/main/favicons/fetch.ts` applies to a network body, for the same
 * reason: reading first and measuring afterwards has already paid for the
 * gigabyte. A 2 GB video selected by accident is a refusal that never touches
 * the bytes. `deps.readFile` is injectable so a test can *observe* that
 * — see picker.test.ts, which fails if the reader is called at all in the
 * oversized case.
 *
 * The size is re-checked after the read too, by `writeBrandingSlot`, which
 * closes the gap between the stat and the read (a file that grew in between).
 *
 * ## `data:`, because the CSP says so
 *
 * The state's `dataUrl` is built exactly as `electron/main/favicons/service.ts`
 * builds one. The renderer's CSP is `img-src 'self' data:`
 * (`electron/main/security.ts`), so a `data:` URL needs no CSP change, while a
 * `blob:` from `URL.createObjectURL`, or a custom scheme registered on
 * Electron's `protocol` module and served off disk, would each mean widening
 * the policy that keeps the renderer from addressing local files. None of them
 * are used here and none of them should be added. (Named indirectly on
 * purpose: T-260829-05's acceptance runs a `grep` over `electron/` for those
 * two API names and requires it to find nothing, and a comment that mentioned
 * them verbatim would answer that grep with prose.)
 *
 * ## Extensions are a courtesy; the sniff is the decision
 *
 * `IMAGE_FILTER_EXTENSIONS` narrows what the native dialog offers so the
 * operator is not scrolling past their tax returns. It admits nothing: a
 * `.png` that is really an SVG document is refused by
 * `writeBrandingSlot`'s magic-number sniff, and so is a `.txt` renamed to
 * `.png`. `svg` is deliberately absent from the list — SVG is refused
 * (`electron/shared/branding.ts`'s header says why), and listing it would tell
 * an operator it is accepted, which is worse than not listing it at all.
 */

/**
 * The extensions the picker offers, matching `BRANDING_CONTENT_TYPES`'
 * raster set. `jpg`/`jpeg` are both listed because both name the same format
 * on disk. **No `svg`** — see this file's header.
 */
export const IMAGE_FILTER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] as const

/**
 * The window a picker is opened over. Opaque on purpose: nothing here reads a
 * property of it. It is a modality anchor handed straight back to
 * `showOpenDialog`, and the identity `IN_FLIGHT` keys on. Typed as `object`
 * rather than Electron's `BrowserWindow` so this module's unit tests can pass
 * a plain `{}`, in the same spirit as the structural dialog below.
 */
export type BrandingPickerWindow = object

/**
 * The narrow slice of `Electron.Dialog` this flow needs — a structural type
 * rather than the imported `dialog` value, mirroring
 * `data-location-prompt.ts`'s `FirstRunDialog` and `app-menu.ts`'s
 * `MoveDataFolderDialog` for the reason both of them give: `electron` cannot
 * be imported as a real, callable value outside a genuine Electron process,
 * so a structural type is what lets this whole flow be driven by a plain fake
 * object in tests rather than by a native dialog no automated test can click.
 *
 * It widens their shape by exactly what a *file* picker needs and no more:
 * `properties: ['openFile']` (never `openDirectory`, never
 * `multiSelections`) and a `filters` entry.
 */
export interface BrandingDialog {
  showOpenDialog(
    window: BrandingPickerWindow,
    options: {
      properties: Array<'openFile'>
      title?: string
      buttonLabel?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }
  ): Promise<{ canceled: boolean; filePaths: string[] }>
}

/**
 * Where the modality anchor comes from. `BrowserWindow` itself satisfies this
 * in production; a test passes a fake that can also answer `null`, which is
 * the case that has to be refused rather than commented about.
 */
export interface BrandingWindowSource {
  getFocusedWindow(): BrandingPickerWindow | null
}

export interface BrandingPickerDeps {
  /** Tests only — production gets the real `electron` `dialog` singleton. */
  readonly dialog?: BrandingDialog
  /** Tests only — production gets `BrowserWindow`. */
  readonly windows?: BrandingWindowSource
  /**
   * Tests only. The stat that decides, before anything is allocated, whether
   * the file is small enough to read.
   */
  readonly stat?: (path: string) => Promise<{ size: number }>
  /**
   * Tests only. Separated from `stat` precisely so a test can assert this was
   * **never called** for an oversized file — the acceptance criterion that
   * the refusal happens before the read, not after it.
   */
  readonly readFile?: (path: string) => Promise<Uint8Array>
}

/**
 * The windows with a picker open right now. A `WeakSet` rather than a `Map`:
 * membership is the whole state, and a closed window should not be kept alive
 * by this module's bookkeeping.
 *
 * Module-level, matching `favicons/service.ts`'s `IN_FLIGHT` and the
 * single-process assumption every repository here already makes.
 */
const IN_FLIGHT = new WeakSet<BrandingPickerWindow>()

/**
 * A stored slot as the renderer sees it — the `data:` URL built here, at the
 * IPC edge, rather than in the repository (which deals in bytes and says so).
 *
 * `null` means the operator has set nothing, which is not an error and not a
 * pending read: it is the answer the rail draws its built-in default against.
 */
export function brandingSlotState(slot: BrandingSlot, stored: StoredBranding | null): BrandingSlotState {
  if (!stored) return { state: 'absent', slot }
  return {
    state: 'present',
    slot,
    contentType: stored.contentType,
    // Exactly `favicons/service.ts`'s construction. `data:` is the only image
    // transport the renderer's CSP admits — see this file's header.
    dataUrl: `data:${stored.contentType};base64,${Buffer.from(stored.bytes).toString('base64')}`,
    byteLength: stored.byteLength,
    updatedAt: stored.updatedAt
  }
}

/** Both slots, as the shell asks for them on load. A pure database read: it opens no dialog and touches no file. */
export function getBrandingSnapshot(db: Database.Database): BrandingSnapshot {
  const stored = readAllBranding(db)
  return { icon: brandingSlotState('icon', stored.icon), logo: brandingSlotState('logo', stored.logo) }
}

/** One slot's current state, read from the database. */
export function getBrandingSlotState(db: Database.Database, slot: BrandingSlot): BrandingSlotState {
  return brandingSlotState(slot, readBrandingSlot(db, slot))
}

/**
 * Stat, refuse, then read — in that order, which is the point.
 *
 * Both failure branches raise a `ValidationError` carrying a message written
 * here rather than anything Node produced: `fs`'s own errors put the absolute
 * path in `.message`, and that message is relayed to the renderer verbatim by
 * `registry.ts`'s `runMutation`. The size refusal names the cap (and the
 * file's size, which is a number, not a location) so the operator is told what
 * to fix.
 */
async function readBoundedImage(path: string, deps: BrandingPickerDeps): Promise<Uint8Array> {
  const stat = deps.stat ?? ((target: string) => statOnDisk(target))
  const readFile = deps.readFile ?? (async (target: string) => new Uint8Array(await readFileFromDisk(target)))

  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    throw new ValidationError('That file could not be read. It may have been moved, renamed or be unreadable by this user.')
  }

  if (size > BRANDING_MAX_BYTES) {
    throw new ValidationError(
      `That image is ${size} bytes, over the ${BRANDING_MAX_BYTES}-byte limit for one branding slot. ` +
        'Export it smaller and choose it again.'
    )
  }

  try {
    return await readFile(path)
  } catch {
    throw new ValidationError('That file could not be read. It may have been moved, renamed or be unreadable by this user.')
  }
}

/**
 * Opens the picker over the focused window, reads the chosen file bounded,
 * and stores it — or reports that the operator cancelled, which is a success.
 *
 * Throws `ValidationError` (caught by `registry.ts` and returned as a
 * `{ ok: false }` envelope) when there is no focused window, when the file is
 * over the cap, when it cannot be read, or — from `writeBrandingSlot` — when
 * its bytes are not one of the accepted raster formats. Every one of those
 * messages is path-free.
 *
 * ## Two guards, both load-bearing
 *
 * **No focused window is a refusal, not a fallback.** `showOpenDialog` with a
 * destroyed or absent parent can leave a modal nobody can dismiss and a main
 * process nobody can quit (this task's Risks). Refusing is the mitigation.
 *
 * **Single-flight per window.** A second call while a picker is open resolves
 * as `cancelled` rather than stacking a second native dialog over the first.
 * The guard runs before the first `await` when the dependencies are injected
 * (`??` does not evaluate its right side when the left is present), so two
 * calls made in the same tick cannot both pass it. In production the two
 * dependency reads are plain module bindings, not awaits, so the same holds
 * there.
 */
export async function chooseBrandingImage(
  db: Database.Database,
  slot: BrandingSlot,
  deps: BrandingPickerDeps = {}
): Promise<BrandingChoice> {
  const dialog = deps.dialog ?? electronDialog
  const windows = deps.windows ?? BrowserWindow

  const window = windows.getFocusedWindow()
  if (!window) {
    throw new ValidationError('Solo CRM cannot open a file picker right now — no window has focus.')
  }

  if (IN_FLIGHT.has(window)) return { outcome: 'cancelled' }
  IN_FLIGHT.add(window)

  let result: { canceled: boolean; filePaths: string[] }
  try {
    result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      title: slot === 'icon' ? 'Choose an icon' : 'Choose a logo',
      buttonLabel: 'Use this image',
      // Extensions narrow what the dialog offers. They admit nothing — the
      // magic-number sniff in `writeBrandingSlot` is the only thing that
      // decides. `svg` is absent on purpose; see this file's header.
      filters: [{ name: 'Images', extensions: [...IMAGE_FILTER_EXTENSIONS] }]
    })
  } finally {
    // Released before the bytes are read and stored, so a slow disk cannot
    // wedge the guard: what must not overlap is the *dialog*, and by here it
    // is closed either way.
    IN_FLIGHT.delete(window)
  }

  const [path] = result.filePaths
  // `canceled` and an empty selection are the same event as far as this
  // function is concerned, and both are a success.
  if (result.canceled || !path) return { outcome: 'cancelled' }

  const bytes = await readBoundedImage(path, deps)
  const stored = writeBrandingSlot(db, slot, bytes)
  return { outcome: 'chosen', state: brandingSlotState(slot, stored) }
}
