import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  COMPANY_IMAGE_CONTENT_TYPES,
  COMPANY_IMAGE_MAX_BYTES,
  COMPANY_IMAGE_MAX_PIXELS,
  COMPANY_IMAGE_SLOTS,
  COMPANY_IMAGE_THUMBNAILS,
  companyImageSlotSchema,
  type CompanyImageContentType,
  type CompanyImageSlot
} from '../../../shared/company-images'
import { nowTimestamp } from '../../../shared/format'
import type { Timestamp } from '../../../shared/types'
import { sniffImageContentType } from '../../favicons/sniff'
import { nativeImageDeriver, type ImageDeriver } from '../../images/derive'
import { readDeclaredPixelSize } from '../../images/dimensions'
import { NotFoundError, ValidationError } from './errors'

/**
 * The `company_images` table's whole read/write surface (T-260901-08,
 * ADR-015). Thirteen columns, from migration 0007 — that file's header carries
 * the table's reasoning; this one carries the code's.
 *
 * ## Two renditions, two readers, and that is the whole point
 *
 * Every write stores the bytes the operator picked *and* a downscaled
 * derivative generated at write time. They are read by different callers and
 * by nothing else:
 *
 * - `listCompanyImageThumbnails` — one query, every company, **derivatives
 *   only**. What the companies grid reads. About 1.5 MB of base64 at sixty
 *   companies with every slot filled, against the 83.9 MB the same grid would
 *   cost reading originals, and it can not exceed 9 MB even if every image is
 *   pure noise.
 * - `readCompanyImages` — one company's two slots, **originals**. What a
 *   detail page reads, once, cached by its query key until an upload
 *   invalidates it.
 *
 * `companies:list` is untouched and gains no image column: it is fetched by
 * Activity, Engagements, People, every sheet and both detail routes for name
 * lookups, and none of them wants a picture.
 *
 * The `data:` URLs the renderer needs are built at the IPC edge (T-260901-12),
 * not here, exactly as `branding/picker.ts` does it — this layer deals in
 * bytes. That is also where the thumbnail rows below become the map keyed by
 * company id that `companyImages:thumbnails` answers with.
 *
 * ## The write path refuses in a fixed order, and every step is load-bearing
 *
 * 1. **The company exists.** The foreign key would raise
 *    `SQLITE_CONSTRAINT_FOREIGNKEY` on its own, but that message is neither
 *    actionable nor path-free, so this pre-checks and throws `NotFoundError`.
 * 2. **The byte cap for that slot** (512 KB logo, 1 MB banner), checked before
 *    the sniff so an oversized but otherwise valid PNG is refused for the
 *    reason that is actually true of it.
 * 3. **The magic-number sniff**, via the sniffer `favicons` and `branding`
 *    already share. PNG and JPEG only. This is what refuses an `<svg …>`
 *    document regardless of what the file was called, and it is also what
 *    refuses WEBP/GIF/BMP/ICO here though the rail accepts them — see
 *    `electron/shared/company-images.ts` for why the set is narrower.
 * 4. **The declared pixel count**, read from the container's own header
 *    (`images/dimensions.ts`) and refused over `COMPANY_IMAGE_MAX_PIXELS`.
 *    A byte cap does not bound a decode: a 1 MB PNG can describe a
 *    256-megapixel image, and the decoder allocates the whole bitmap. This is
 *    the step that keeps a decompression bomb out of main.
 * 5. **Only then, the decode.** An image that passes all four and still
 *    decodes empty is refused too, so a malformed raster never reaches the
 *    renderer at all.
 *
 * Steps 2-4 are enforced here rather than inside the deriver precisely because
 * the deriver is injectable: a fake must not be able to replace a guard.
 *
 * Every refusal is a `ValidationError` with a hand-written message that names
 * no filesystem path — `branding/picker.ts`'s discipline, and T-260901-12
 * runs its path-leak walker over these channels too.
 *
 * ## Deleting
 *
 * Clearing a slot is a `DELETE`; the absence is the default and there is no
 * sentinel row. Deleting a *company* takes its images with it through the
 * foreign key's `ON DELETE cascade` — the engine, not repository code, so it
 * covers `seed/index.ts` and any future importer that never calls
 * `deleteCompany`. Nothing here has to remember to do it.
 */

/** One slot's stored original, exactly as the table holds it. */
export interface StoredCompanyImage {
  readonly companyId: string
  readonly slot: CompanyImageSlot
  readonly bytes: Uint8Array
  readonly contentType: CompanyImageContentType
  /** `bytes.length`, stored so a caller that only wants the size need not load the blob. */
  readonly byteLength: number
  /** The original's pixel dimensions — what a view reserves the banner's box with. */
  readonly width: number
  readonly height: number
  readonly createdAt: Timestamp
  readonly updatedAt: Timestamp
}

/**
 * One slot's stored derivative. Carries the **original's** `width`/`height`,
 * which is what an `aspect-ratio` box wants; the derivative's own size is not
 * stored, being a function of those and the slot's box.
 */
export interface StoredCompanyImageThumbnail {
  readonly companyId: string
  readonly slot: CompanyImageSlot
  readonly bytes: Uint8Array
  readonly contentType: CompanyImageContentType
  readonly byteLength: number
  readonly width: number
  readonly height: number
  readonly updatedAt: Timestamp
}

interface OriginalRow {
  readonly company_id: string
  readonly slot: string
  readonly bytes: Uint8Array
  readonly content_type: string
  readonly byte_length: number
  readonly width: number
  readonly height: number
  readonly created_at: string
  readonly updated_at: string
}

interface ThumbnailRow {
  readonly company_id: string
  readonly slot: string
  readonly thumb_bytes: Uint8Array
  readonly thumb_content_type: string
  readonly thumb_byte_length: number
  readonly width: number
  readonly height: number
  readonly updated_at: string
}

/** Injected in tests only — production gets `nativeImageDeriver`, which needs a real Electron process. */
export interface CompanyImageDeps {
  readonly derive?: ImageDeriver
}

/**
 * Narrows a `slot` that may have arrived already widened to `string` — an IPC
 * request body deserialised from the renderer — before it reaches SQL. Every
 * exported function is typed `slot: CompanyImageSlot`, so a call site inside
 * main fails to compile on a bad slot; this is the runtime half of the same
 * check, in the pattern `branding.ts`'s `requireKnownSlot` established.
 */
function requireKnownSlot(slot: CompanyImageSlot): CompanyImageSlot {
  const parsed = companyImageSlotSchema.safeParse(slot)
  if (!parsed.success) {
    throw new ValidationError(`"${String(slot)}" is not a company image slot`, parsed.error.issues)
  }
  return parsed.data
}

function toStored(row: OriginalRow): StoredCompanyImage {
  return {
    companyId: row.company_id,
    slot: row.slot as CompanyImageSlot,
    bytes: row.bytes,
    contentType: row.content_type as CompanyImageContentType,
    byteLength: row.byte_length,
    width: row.width,
    height: row.height,
    createdAt: row.created_at as Timestamp,
    updatedAt: row.updated_at as Timestamp
  }
}

function toThumbnail(row: ThumbnailRow): StoredCompanyImageThumbnail {
  return {
    companyId: row.company_id,
    slot: row.slot as CompanyImageSlot,
    bytes: row.thumb_bytes,
    contentType: row.thumb_content_type as CompanyImageContentType,
    byteLength: row.thumb_byte_length,
    width: row.width,
    height: row.height,
    updatedAt: row.updated_at as Timestamp
  }
}

/**
 * The original's columns, `bytes` included. Only ever selected for one company
 * at a time — a list read that named `bytes` is the failure ADR-015 exists to
 * refuse.
 */
const ORIGINAL_COLUMNS = 'company_id, slot, bytes, content_type, byte_length, width, height, created_at, updated_at'

/** The derivative's columns. `bytes` is deliberately absent. */
const THUMBNAIL_COLUMNS =
  'company_id, slot, thumb_bytes, thumb_content_type, thumb_byte_length, width, height, updated_at'

/** `null` when this company has no image in this slot — the ordinary case, and the one that means "render the derived mark". */
export function readCompanyImage(
  db: Database.Database,
  companyId: string,
  slot: CompanyImageSlot
): StoredCompanyImage | null {
  const known = requireKnownSlot(slot)
  const row = db
    .prepare(`SELECT ${ORIGINAL_COLUMNS} FROM company_images WHERE company_id = ? AND slot = ?`)
    .get(companyId, known) as OriginalRow | undefined
  return row ? toStored(row) : null
}

/**
 * Both of one company's slots in one call — what a detail page wants, rather
 * than two reads it would have to sequence. Total by construction over
 * `COMPANY_IMAGE_SLOTS`: a slot with no row is `null`, never a missing key.
 *
 * This is the **only** read that returns originals, and it is deliberately
 * per-company: a version of it that took a list of ids would be the naive
 * whole-grid read wearing a different signature.
 */
export function readCompanyImages(
  db: Database.Database,
  companyId: string
): Record<CompanyImageSlot, StoredCompanyImage | null> {
  const rows = db
    .prepare(`SELECT ${ORIGINAL_COLUMNS} FROM company_images WHERE company_id = ?`)
    .all(companyId) as OriginalRow[]
  const bySlot = new Map(rows.map((row) => [row.slot, row]))
  const result = {} as Record<CompanyImageSlot, StoredCompanyImage | null>
  for (const slot of COMPANY_IMAGE_SLOTS) {
    const row = bySlot.get(slot)
    result[slot] = row ? toStored(row) : null
  }
  return result
}

/**
 * Every present slot's derivative, for every company, in **one** query — the
 * companies grid's whole image read, regardless of how many companies there
 * are.
 *
 * Present slots only: a company with no images produces no row, so the caller
 * building the map keyed by company id simply has no entry for it and the grid
 * draws that company's derived mark. Ordered by company then slot so the
 * result is stable rather than incidental.
 *
 * The `SELECT` names `thumb_bytes` and never `bytes`. That is not a detail —
 * with the original declared last in the table, this read walks the handful of
 * overflow pages a thumbnail occupies and never touches the up-to-256 pages
 * the original does.
 */
export function listCompanyImageThumbnails(db: Database.Database): StoredCompanyImageThumbnail[] {
  const rows = db
    .prepare(`SELECT ${THUMBNAIL_COLUMNS} FROM company_images ORDER BY company_id, slot`)
    .all() as ThumbnailRow[]
  return rows.map(toThumbnail)
}

function companyExists(db: Database.Database, companyId: string): boolean {
  return db.prepare('SELECT 1 FROM companies WHERE id = ?').get(companyId) !== undefined
}

/**
 * Stores an operator-picked image for one company slot, together with the
 * derivative the grid will read.
 *
 * An upsert on `(company_id, slot)`, so choosing a second image replaces the
 * first in one statement rather than accumulating rows — and keeps the row's
 * `id` and `created_at`, which describe the slot's history, not this
 * particular picture. It does **not** touch `companies.updated_at`: the
 * company record did not change, and the image row carries its own timestamps.
 *
 * Throws `NotFoundError` for a company that does not exist, and
 * `ValidationError` — before any SQL runs — for an empty payload, one over the
 * slot's cap, one whose magic numbers are not PNG or JPEG (SVG included), one
 * whose header declares more than `COMPANY_IMAGE_MAX_PIXELS`, or one that
 * decodes empty. In every refusal case the table is left exactly as it was,
 * including a previously-stored image for that slot: a rejected pick must not
 * also destroy the picture that was already working.
 */
export function writeCompanyImage(
  db: Database.Database,
  companyId: string,
  slot: CompanyImageSlot,
  bytes: Uint8Array,
  deps: CompanyImageDeps = {}
): StoredCompanyImage {
  const known = requireKnownSlot(slot)
  const derive = deps.derive ?? nativeImageDeriver

  if (!companyExists(db, companyId)) {
    throw new NotFoundError('Company', companyId)
  }

  if (bytes.length === 0) {
    throw new ValidationError(`company ${known}: the file is empty`)
  }

  const maxBytes = COMPANY_IMAGE_MAX_BYTES[known]
  if (bytes.length > maxBytes) {
    throw new ValidationError(
      `company ${known}: ${bytes.length} bytes exceeds the ${maxBytes}-byte limit for this slot`
    )
  }

  const contentType = sniffImageContentType(bytes)
  if (contentType === null || !isAcceptedContentType(contentType)) {
    throw new ValidationError(
      `company ${known}: the file is not a supported image. Accepted: PNG, JPEG. ` +
        'SVG, WEBP, GIF, BMP and ICO are not accepted.'
    )
  }

  // Before the decode, never after: the decoder allocates the whole bitmap,
  // and a byte cap says nothing about how many pixels those bytes describe.
  const declared = readDeclaredPixelSize(bytes, contentType)
  if (declared === null) {
    throw new ValidationError(`company ${known}: the image's dimensions could not be read. The file may be damaged.`)
  }
  if (declared.width * declared.height > COMPANY_IMAGE_MAX_PIXELS) {
    throw new ValidationError(
      `company ${known}: ${declared.width}x${declared.height} is over the ${COMPANY_IMAGE_MAX_PIXELS}-pixel limit ` +
        'for one image. Export it smaller and choose it again.'
    )
  }

  const derived = derive(bytes, known)
  if (derived === null) {
    throw new ValidationError(`company ${known}: the image could not be read. The file may be damaged.`)
  }

  const thumbSpec = COMPANY_IMAGE_THUMBNAILS[known]
  const timestamp = nowTimestamp()
  db.prepare(
    'INSERT INTO company_images ' +
      '(id, company_id, slot, content_type, byte_length, width, height, created_at, updated_at, ' +
      'thumb_content_type, thumb_byte_length, thumb_bytes, bytes) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ' +
      'ON CONFLICT(company_id, slot) DO UPDATE SET content_type = excluded.content_type, ' +
      'byte_length = excluded.byte_length, width = excluded.width, height = excluded.height, ' +
      'updated_at = excluded.updated_at, thumb_content_type = excluded.thumb_content_type, ' +
      'thumb_byte_length = excluded.thumb_byte_length, thumb_bytes = excluded.thumb_bytes, ' +
      'bytes = excluded.bytes'
  ).run(
    randomUUID(),
    companyId,
    known,
    contentType,
    bytes.length,
    derived.source.width,
    derived.source.height,
    timestamp,
    timestamp,
    thumbSpec.contentType,
    derived.thumbnail.bytes.length,
    Buffer.from(derived.thumbnail.bytes),
    Buffer.from(bytes)
  )

  // Only the three columns the upsert may not have written as given: on a
  // replace the row keeps its original `id` and `created_at`. Deliberately not
  // a re-read of the whole row — that would load the blob this function was
  // just handed.
  const stamps = db
    .prepare('SELECT created_at, updated_at FROM company_images WHERE company_id = ? AND slot = ?')
    .get(companyId, known) as { created_at: string; updated_at: string }

  return {
    companyId,
    slot: known,
    bytes,
    contentType,
    byteLength: bytes.length,
    width: derived.source.width,
    height: derived.source.height,
    createdAt: stamps.created_at as Timestamp,
    updatedAt: stamps.updated_at as Timestamp
  }
}

/**
 * Removes this company's image for this slot, so the card and the header fall
 * back to the derived mark. Returns whether a row was actually removed.
 *
 * Deliberately **not** a `NotFoundError` on an absent slot, for
 * `clearBrandingSlot`'s reason: the caller asked for "no image here" and that
 * is already the state, so nothing went wrong and there is nothing to report.
 */
export function clearCompanyImage(db: Database.Database, companyId: string, slot: CompanyImageSlot): boolean {
  const known = requireKnownSlot(slot)
  const result = db.prepare('DELETE FROM company_images WHERE company_id = ? AND slot = ?').run(companyId, known)
  return result.changes > 0
}

/**
 * Narrows the sniffer's wider union to the two formats this table accepts.
 * Written as a guard over `COMPANY_IMAGE_CONTENT_TYPES` rather than as two
 * literal comparisons so the accepted set has exactly one definition.
 */
function isAcceptedContentType(contentType: string): contentType is CompanyImageContentType {
  return (COMPANY_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
}
