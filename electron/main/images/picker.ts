import { readFile as readFileFromDisk, stat as statOnDisk } from 'node:fs/promises'
import { BrowserWindow, dialog as electronDialog } from 'electron'
import { ValidationError } from '../db/repositories/errors'

/**
 * The image picker (T-260829-05, generalised by T-260901-12) — the only
 * native dialog in this app that a *renderer* can ask for, and therefore the
 * one place the filesystem gets closest to the boundary whose entire design is
 * that the renderer cannot reach it.
 *
 * It began life as `electron/main/branding/picker.ts`, serving the
 * workspace's own icon and logo. Per-company images (ADR-015) are a second
 * caller with a different store and a different cap per slot, and the reason
 * the picker moved here rather than being copied is the whole of T-260901-12's
 * risk note: a copy is how one of the two ends up with a guard the other
 * lacks. This module holds every guard **once**, takes what differs between
 * callers as a `PickTarget`, and hands back bytes. What a caller stores, and
 * what it answers the renderer with, is the caller's — `branding/picker.ts`
 * and `images/company-images.ts` are those callers.
 *
 * ## The property this module exists to hold: the path never comes back
 *
 * The renderer asks for a picker and receives an image. It never receives the
 * chosen file's path, its directory, or its basename — not in the success
 * branch, not in a refusal message, not in an error thrown out of here.
 * `pickImage` resolves to bytes or to `cancelled`; it does not return the
 * path it read them from, so a caller *cannot* relay one without going back
 * to the dialog result itself, which this module keeps to itself. Every
 * refusal below is raised as a `ValidationError` with a message written by
 * hand here, precisely so a Node `ENOENT`/`EACCES` error — whose `.message`
 * embeds the full path — is never what the caller relays.
 *
 * A filename returned "so the UI can show which file was picked" would undo
 * this without a single line of it looking wrong, which is why the tests walk
 * every returned object for path separators rather than trusting a reading of
 * the diff.
 *
 * ## Bounded *before* the read, not after
 *
 * `readBoundedImage` stats the file and refuses on size before it allocates
 * anything — the same discipline `readBounded` in
 * `electron/main/favicons/fetch.ts` applies to a network body, for the same
 * reason: reading first and measuring afterwards has already paid for the
 * gigabyte. A 2 GB video selected by accident is a refusal that never touches
 * the bytes. The cap is the target's, because it is not one number: a company
 * banner may be twice what a company logo may (`COMPANY_IMAGE_MAX_BYTES`), and
 * a workspace slot has its own (`BRANDING_MAX_BYTES`). `deps.readFile` is
 * injectable so a test can *observe* that the reader was never called in the
 * oversized case.
 *
 * The size is re-checked after the read too, by every store this feeds
 * (`writeBrandingSlot`, `writeCompanyImage`), which closes the gap between the
 * stat and the read (a file that grew in between).
 *
 * ## `data:`, because the CSP says so
 *
 * `imageDataUrl` builds the one image transport the renderer's CSP admits —
 * `img-src 'self' data:` (`electron/main/security.ts`) — exactly as
 * `electron/main/favicons/service.ts` does. An object URL minted from a
 * `Blob`, or a custom scheme registered on Electron's `protocol` module and
 * served off disk, would each mean widening the policy that keeps the
 * renderer from addressing local files. Neither is used here and neither
 * should be added. (Named indirectly on purpose: T-260829-05's and
 * T-260901-12's acceptance both run a `grep` over `electron/` for those API
 * names and require it to find nothing, and a comment that mentioned them
 * verbatim would answer that grep with prose.)
 *
 * ## Extensions are a courtesy; the sniff is the decision
 *
 * A target's `extensions` narrow what the native dialog offers so the operator
 * is not scrolling past their tax returns. They admit nothing: a `.png` that
 * is really an SVG document is refused by the store's magic-number sniff, and
 * so is a `.txt` renamed to `.png`. No target lists `svg` — SVG is refused
 * everywhere (`electron/shared/branding.ts`'s header says why), and listing it
 * would tell an operator it is accepted, which is worse than not listing it.
 */

/**
 * The window a picker is opened over. Opaque on purpose: nothing here reads a
 * property of it. It is a modality anchor handed straight back to
 * `showOpenDialog`, and the identity `IN_FLIGHT` keys on. Typed as `object`
 * rather than Electron's `BrowserWindow` so unit tests can pass a plain `{}`,
 * in the same spirit as the structural dialog below.
 */
export type PickerWindow = object

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
export interface PickerDialog {
  showOpenDialog(
    window: PickerWindow,
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
export interface PickerWindowSource {
  getFocusedWindow(): PickerWindow | null
}

export interface ImagePickerDeps {
  /** Tests only — production gets the real `electron` `dialog` singleton. */
  readonly dialog?: PickerDialog
  /** Tests only — production gets `BrowserWindow`. */
  readonly windows?: PickerWindowSource
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
 * What differs between the pickers' callers, and nothing that does not. The
 * guards — focused window, single flight, stat-then-read, path-free
 * refusals — are not on this interface because a caller must not be able to
 * opt out of one.
 */
export interface PickTarget {
  /** The native dialog's title, e.g. "Choose a logo". */
  readonly title: string
  /** The extensions the dialog offers. A courtesy, never a decision — see this file's header. */
  readonly extensions: readonly string[]
  /** The byte cap the stat is checked against before the read. */
  readonly maxBytes: number
  /**
   * How the cap refusal names what the cap is *for* — "one branding slot",
   * "a company banner" — so the operator is told what to fix. Never a path.
   */
  readonly limitLabel: string
}

/** What `pickImage` resolves to: the bytes of the chosen file, or the fact that the operator chose nothing. Never a path. */
export type ImagePick = { readonly outcome: 'cancelled' } | { readonly outcome: 'picked'; readonly bytes: Uint8Array }

/**
 * The windows with a picker open right now. A `WeakSet` rather than a `Map`:
 * membership is the whole state, and a closed window should not be kept alive
 * by this module's bookkeeping.
 *
 * Module-level, matching `favicons/service.ts`'s `IN_FLIGHT` and the
 * single-process assumption every repository here already makes. Shared by
 * every caller on purpose: what must not overlap is the native dialog, and a
 * branding picker and a company picker over the same window are two of them.
 */
const IN_FLIGHT = new WeakSet<PickerWindow>()

/** The refusal for a file that cannot be stat'd or read — one message, path-free, for every `fs` failure. */
const UNREADABLE = 'That file could not be read. It may have been moved, renamed or be unreadable by this user.'

/**
 * Exactly `favicons/service.ts`'s construction. `data:` is the only image
 * transport the renderer's CSP admits — see this file's header.
 */
export function imageDataUrl(contentType: string, bytes: Uint8Array): string {
  return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
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
async function readBoundedImage(path: string, target: PickTarget, deps: ImagePickerDeps): Promise<Uint8Array> {
  const stat = deps.stat ?? ((file: string) => statOnDisk(file))
  const readFile = deps.readFile ?? (async (file: string) => new Uint8Array(await readFileFromDisk(file)))

  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    throw new ValidationError(UNREADABLE)
  }

  if (size > target.maxBytes) {
    throw new ValidationError(
      `That image is ${size} bytes, over the ${target.maxBytes}-byte limit for ${target.limitLabel}. ` +
        'Export it smaller and choose it again.'
    )
  }

  try {
    return await readFile(path)
  } catch {
    throw new ValidationError(UNREADABLE)
  }
}

/**
 * Opens the picker over the focused window and reads the chosen file bounded
 * by the target's cap — or reports that the operator cancelled, which is a
 * success. Storing what comes back is the caller's job, and so is deciding
 * what the bytes are: the stores sniff magic numbers, this does not.
 *
 * Throws `ValidationError` (caught by `registry.ts` and returned as a
 * `{ ok: false }` envelope) when there is no focused window, when the file is
 * over the cap, or when it cannot be read. Every one of those messages is
 * path-free.
 *
 * ## Two guards, both load-bearing
 *
 * **No focused window is a refusal, not a fallback.** `showOpenDialog` with a
 * destroyed or absent parent can leave a modal nobody can dismiss and a main
 * process nobody can quit (T-260829-05's Risks). Refusing is the mitigation.
 *
 * **Single-flight per window.** A second call while a picker is open resolves
 * as `cancelled` rather than stacking a second native dialog over the first.
 * The guard runs before the first `await` when the dependencies are injected
 * (`??` does not evaluate its right side when the left is present), so two
 * calls made in the same tick cannot both pass it. In production the two
 * dependency reads are plain module bindings, not awaits, so the same holds
 * there.
 */
export async function pickImage(target: PickTarget, deps: ImagePickerDeps = {}): Promise<ImagePick> {
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
      title: target.title,
      buttonLabel: 'Use this image',
      // Extensions narrow what the dialog offers. They admit nothing — the
      // magic-number sniff in the store is the only thing that decides.
      filters: [{ name: 'Images', extensions: [...target.extensions] }]
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

  return { outcome: 'picked', bytes: await readBoundedImage(path, target, deps) }
}
