import type Database from 'better-sqlite3'
import { COMPANY_IMAGE_MAX_BYTES } from '../../shared/company-images'
import type {
  CompanyImageChoice,
  CompanyImageSlot,
  CompanyImageSlotState,
  CompanyImagesSnapshot,
  CompanyImageThumbnail,
  CompanyImageThumbnails
} from '../../shared/company-images'
import {
  listCompanyImageThumbnails,
  readCompanyImage,
  readCompanyImages,
  writeCompanyImage,
  type StoredCompanyImage,
  type StoredCompanyImageThumbnail
} from '../db/repositories/company-images'
import type { ImageDeriver } from './derive'
import { imageDataUrl, pickImage } from './picker'
import type { ImagePickerDeps, PickTarget } from './picker'

/**
 * A company's own logo and banner at the IPC edge (T-260901-12, ADR-015) —
 * the second caller of `./picker.ts`, and the reason it was generalised
 * rather than copied. Read that file's header for the guards; nothing about
 * them is decided here. What is decided here:
 *
 * - **which bytes the picker offers and bounds by**: PNG and JPEG only
 *   (`COMPANY_IMAGE_CONTENT_TYPES` — the repository refuses everything else,
 *   so offering `.webp` would tell an operator something false), and a cap
 *   that is the *slot's* (`COMPANY_IMAGE_MAX_BYTES`), because a banner may be
 *   twice what a logo may;
 * - **what the renderer receives**: `data:` URLs built by `imageDataUrl`, the
 *   one transport the CSP admits, with the original's dimensions beside them;
 * - **the shape of the list read**: `getCompanyImageThumbnails` folds the
 *   repository's flat, derivative-only rows into ADR-015's id-keyed map, and
 *   that fold is the only place the map is built.
 *
 * Nothing here re-validates what `writeCompanyImage` refuses — the empty
 * file, the sniff, the pixel ceiling, the post-read cap, the unknown company.
 * Each of those is a `RepositoryError` with a path-free message, and
 * `registry.ts`'s `runMutationAsync` relays that message as the reason. An
 * unknown company id in particular is refused by the repository's own
 * `NotFoundError('Company', id)`, which names the id the renderer sent and
 * nothing else — there is no second check here that could word it
 * differently.
 */

/**
 * PNG and JPEG on disk, and nothing else — the two formats
 * `writeCompanyImage` accepts (`electron/shared/company-images.ts` says why
 * the set is narrower than branding's). `jpg`/`jpeg` both name JPEG. No
 * `svg`, no `webp`: an extension the dialog offers and the store refuses is a
 * promise the app cannot keep.
 */
export const COMPANY_IMAGE_FILTER_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const

/**
 * The picker's own seams plus the derivative generator's. `derive` is the
 * repository's injection point (`CompanyImageDeps`), surfaced here so a test
 * of this edge can run under plain Node, where `nativeImage` is `undefined`;
 * production passes nothing and gets `nativeImageDeriver`.
 */
export interface CompanyImagePickerDeps extends ImagePickerDeps {
  readonly derive?: ImageDeriver
}

/** What differs per company slot: its title and its cap. The raster set is the same for both. */
function companyImageTarget(slot: CompanyImageSlot): PickTarget {
  return {
    title: slot === 'logo' ? 'Choose a company logo' : 'Choose a company banner',
    extensions: COMPANY_IMAGE_FILTER_EXTENSIONS,
    maxBytes: COMPANY_IMAGE_MAX_BYTES[slot],
    limitLabel: `a company ${slot}`
  }
}

/**
 * A stored slot as the renderer sees it — the original, as a `data:` URL,
 * with the dimensions the decoder measured. `null` means the company has set
 * nothing here, which is the ordinary case and the one that means "draw the
 * derived mark": not an error, not a pending read.
 */
export function companyImageSlotState(slot: CompanyImageSlot, stored: StoredCompanyImage | null): CompanyImageSlotState {
  if (!stored) return { state: 'absent', slot }
  return {
    state: 'present',
    slot,
    contentType: stored.contentType,
    dataUrl: imageDataUrl(stored.contentType, stored.bytes),
    byteLength: stored.byteLength,
    width: stored.width,
    height: stored.height,
    updatedAt: stored.updatedAt
  }
}

/**
 * One company's two slots, originals — what `companyImages:get` answers and
 * the only read that carries an original, one company at a time (ADR-015). A
 * pure database read: no dialog, no file. A company id nothing is stored
 * against — including one that does not exist — answers absent for both
 * slots, which is the same answer a detail page wants for a company that
 * exists and has set nothing.
 */
export function getCompanyImagesSnapshot(db: Database.Database, companyId: string): CompanyImagesSnapshot {
  const stored = readCompanyImages(db, companyId)
  return {
    logo: companyImageSlotState('logo', stored.logo),
    banner: companyImageSlotState('banner', stored.banner)
  }
}

/** One slot's current state, read from the database — what `companyImages:clear` answers with afterwards. */
export function getCompanyImageSlotState(
  db: Database.Database,
  companyId: string,
  slot: CompanyImageSlot
): CompanyImageSlotState {
  return companyImageSlotState(slot, readCompanyImage(db, companyId, slot))
}

function companyImageThumbnail(stored: StoredCompanyImageThumbnail): CompanyImageThumbnail {
  return {
    slot: stored.slot,
    contentType: stored.contentType,
    dataUrl: imageDataUrl(stored.contentType, stored.bytes),
    width: stored.width,
    height: stored.height,
    updatedAt: stored.updatedAt
  }
}

/**
 * Every present slot's derivative, for every company, as the map ADR-015
 * specifies: keyed by company id, present slots only, and a company with no
 * images has no entry. One query (`listCompanyImageThumbnails`, which selects
 * `thumb_bytes` and never the original) folded into the map here — the grid's
 * whole image read, regardless of how many companies there are.
 */
export function getCompanyImageThumbnails(db: Database.Database): CompanyImageThumbnails {
  const thumbnails: CompanyImageThumbnails = {}
  for (const stored of listCompanyImageThumbnails(db)) {
    const entry = (thumbnails[stored.companyId] ??= {})
    entry[stored.slot] = companyImageThumbnail(stored)
  }
  return thumbnails
}

/**
 * Opens the picker over the focused window, reads the chosen file bounded by
 * the slot's cap, and stores it for this company — or reports that the
 * operator cancelled, which is a success that changed nothing.
 *
 * Throws `ValidationError` from `pickImage` (no focused window, over the cap,
 * unreadable — all path-free) and `ValidationError`/`NotFoundError` from
 * `writeCompanyImage` (empty, not PNG or JPEG, over the pixel ceiling, does
 * not decode, no such company). `registry.ts` turns each into a
 * `{ ok: false }` envelope; in every one of those cases the table — including
 * an image already stored in this slot — is exactly as it was.
 */
export async function chooseCompanyImage(
  db: Database.Database,
  companyId: string,
  slot: CompanyImageSlot,
  deps: CompanyImagePickerDeps = {}
): Promise<CompanyImageChoice> {
  const pick = await pickImage(companyImageTarget(slot), deps)
  if (pick.outcome === 'cancelled') return { outcome: 'cancelled' }

  const stored = writeCompanyImage(db, companyId, slot, pick.bytes, deps.derive ? { derive: deps.derive } : {})
  return { outcome: 'chosen', state: companyImageSlotState(slot, stored) }
}
