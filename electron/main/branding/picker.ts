import type Database from 'better-sqlite3'
import { BRANDING_MAX_BYTES, type BrandingChoice, type BrandingSlot, type BrandingSlotState } from '../../shared/branding'
import { readAllBranding, readBrandingSlot, writeBrandingSlot, type StoredBranding } from '../db/repositories/branding'
import type { BrandingSnapshot } from '../../shared/branding'
import { imageDataUrl, pickImage } from '../images/picker'
import type { ImagePickerDeps, PickerDialog, PickerWindow, PickerWindowSource, PickTarget } from '../images/picker'

/**
 * The operator's brand image picker (T-260829-05) — the branding half of
 * what used to be one file. The dialog, both guards, the stat-then-read bound
 * and the path-free refusals now live in `electron/main/images/picker.ts`
 * (generalised by T-260901-12 so per-company images could share them rather
 * than copy them); read that file's header first. What stays here is what is
 * branding's: the two slots, their one cap, the raster set the dialog offers,
 * the `branding` table, and the `BrandingSlotState` the renderer receives.
 *
 * The property has not moved: the renderer asks for a picker by slot and
 * receives an image. It never receives the chosen file's path, its directory,
 * or its basename — `pickImage` hands back bytes and nothing else, so there
 * is nothing here that *could* relay one. The tests beside this file walk
 * every returned object for path separators regardless.
 */

/**
 * The extensions the picker offers, matching `BRANDING_CONTENT_TYPES`'
 * raster set. `jpg`/`jpeg` are both listed because both name the same format
 * on disk. **No `svg`** — SVG is refused (`electron/shared/branding.ts`'s
 * header says why), and listing it would tell an operator it is accepted.
 */
export const IMAGE_FILTER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico'] as const

/** The names T-260829-05 introduced, kept for its callers and tests; each is exactly the generic picker's type. */
export type BrandingPickerWindow = PickerWindow
export type BrandingDialog = PickerDialog
export type BrandingWindowSource = PickerWindowSource
export type BrandingPickerDeps = ImagePickerDeps

/** What differs for a workspace slot: its title, its raster set, and the one cap both slots share. */
function brandingTarget(slot: BrandingSlot): PickTarget {
  return {
    title: slot === 'icon' ? 'Choose an icon' : 'Choose a logo',
    extensions: IMAGE_FILTER_EXTENSIONS,
    maxBytes: BRANDING_MAX_BYTES,
    limitLabel: 'one branding slot'
  }
}

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
    dataUrl: imageDataUrl(stored.contentType, stored.bytes),
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
 * Opens the picker over the focused window, reads the chosen file bounded by
 * `BRANDING_MAX_BYTES`, and stores it — or reports that the operator
 * cancelled, which is a success.
 *
 * Throws `ValidationError` (caught by `registry.ts` and returned as a
 * `{ ok: false }` envelope) from `pickImage` when there is no focused window,
 * when the file is over the cap, or when it cannot be read — and from
 * `writeBrandingSlot` when its bytes are not one of the accepted raster
 * formats. Every one of those messages is path-free.
 */
export async function chooseBrandingImage(
  db: Database.Database,
  slot: BrandingSlot,
  deps: BrandingPickerDeps = {}
): Promise<BrandingChoice> {
  const pick = await pickImage(brandingTarget(slot), deps)
  if (pick.outcome === 'cancelled') return { outcome: 'cancelled' }

  const stored = writeBrandingSlot(db, slot, pick.bytes)
  return { outcome: 'chosen', state: brandingSlotState(slot, stored) }
}
