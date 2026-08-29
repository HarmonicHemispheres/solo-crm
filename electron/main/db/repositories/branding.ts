import type Database from 'better-sqlite3'
import {
  BRANDING_MAX_BYTES,
  BRANDING_SLOTS,
  brandingSlotSchema,
  type BrandingContentType,
  type BrandingSlot
} from '../../../shared/branding'
import { nowTimestamp } from '../../../shared/format'
import type { Timestamp } from '../../../shared/types'
import { sniffImageContentType } from '../../favicons/sniff'
import { ValidationError } from './errors'

/**
 * The `branding` table's whole read/write surface (T-260829-04). Five
 * columns, from migration 0005:
 *
 * ```sql
 * CREATE TABLE `branding` (
 *   `slot` text PRIMARY KEY NOT NULL,
 *   `bytes` blob NOT NULL,
 *   `content_type` text NOT NULL,
 *   `byte_length` integer NOT NULL,
 *   `updated_at` text NOT NULL
 * );
 * ```
 *
 * Keyed by `slot` under ADR-002's natural-identity exemption — no UUID, no
 * `created_at` — with ADR-012 recording this table's membership of that class
 * and the two storage alternatives it rejected.
 *
 * ## Absence is the default, so clearing is a DELETE
 *
 * Two rows at most, ever. A slot with no row means "use the app's built-in
 * mark", which is why `clearBrandingSlot` deletes rather than writing a
 * sentinel and why it is a no-op on an absent slot rather than a
 * `NotFoundError`: "there is no operator logo" is the state the caller asked
 * for, and it is already true. Every column is `NOT NULL`, so a half-written
 * row — bytes with no type, a type with no bytes — is not representable.
 *
 * ## The bytes decide what they are; nothing else gets a vote
 *
 * `writeBrandingSlot` takes bytes and a slot, and *no* declared content type.
 * The type is sniffed from the bytes' own magic numbers via
 * `electron/main/favicons/sniff.ts` — the same sniffer the favicon cache
 * uses, deliberately not a second copy — and a payload that sniffs as nothing
 * on `BRANDING_CONTENT_TYPES` is refused with a `ValidationError` and writes
 * no row.
 *
 * That is what refuses an SVG: SVG has no magic number on that list, so an
 * `<svg …>` document (or an HTML page, or a PDF, or a renamed `.txt`) fails
 * here regardless of its filename or of anything a picker reported about it.
 * `electron/shared/branding.ts`'s header carries the argument for why raster
 * only, and why it is a *stronger* rule here than for favicons rather than a
 * weaker one.
 *
 * ## Why there is a cap at all
 *
 * `BRANDING_MAX_BYTES` (512 KB, declared once in the shared module) is
 * enforced here, before the sniff, so an oversized but otherwise valid PNG is
 * refused for the reason that is actually true of it. The cap is about read
 * timing rather than disk: both slots are read on every app start to paint
 * the rail and are base64-inflated on the way across IPC.
 *
 * ## Sniffing is the only gate, and that is a bounded exposure
 *
 * A file that sniffs as PNG but is malformed still reaches Chromium's decoder
 * as a `data:` URL. That is the same exposure `electron/main/favicons/` already
 * accepts, bounded by the same three things: raster only, no SVG, a hard byte
 * cap. There is no decoder in main and this task deliberately does not add
 * one — see the task's Scope on resizing and dimension validation.
 */

/** One stored slot, exactly as the table holds it. The `data:` URL the renderer needs is built at the IPC edge (T-260829-05), not here — this layer deals in bytes. */
export interface StoredBranding {
  readonly slot: BrandingSlot
  readonly bytes: Uint8Array
  readonly contentType: BrandingContentType
  /** `bytes.length`, stored so a caller that only wants the size need not load the blob. */
  readonly byteLength: number
  readonly updatedAt: Timestamp
}

interface BrandingRow {
  readonly slot: string
  readonly bytes: Uint8Array
  readonly content_type: string
  readonly byte_length: number
  readonly updated_at: string
}

/**
 * Narrows a `slot` that may have arrived already widened to `string` — a
 * future IPC request body deserialised from the renderer — before it reaches
 * SQL. Every exported function below is typed `slot: BrandingSlot`, so a call
 * site inside main fails to compile on a bad slot; this is the runtime half of
 * the same check, in the pattern `settings.ts`'s `requireKnownKey` established.
 */
function requireKnownSlot(slot: BrandingSlot): BrandingSlot {
  const parsed = brandingSlotSchema.safeParse(slot)
  if (!parsed.success) {
    throw new ValidationError(`"${String(slot)}" is not a branding slot`, parsed.error.issues)
  }
  return parsed.data
}

function toStored(row: BrandingRow): StoredBranding {
  return {
    slot: row.slot as BrandingSlot,
    bytes: row.bytes,
    contentType: row.content_type as BrandingContentType,
    byteLength: row.byte_length,
    updatedAt: row.updated_at as Timestamp
  }
}

/** `null` when the operator has set nothing for this slot — the ordinary case, and the one that means "render the built-in default". */
export function readBrandingSlot(db: Database.Database, slot: BrandingSlot): StoredBranding | null {
  const known = requireKnownSlot(slot)
  const row = db
    .prepare('SELECT slot, bytes, content_type, byte_length, updated_at FROM branding WHERE slot = ?')
    .get(known) as BrandingRow | undefined
  return row ? toStored(row) : null
}

/**
 * Both slots in one call — what the shell wants on load, rather than two round
 * trips it would have to sequence. Total by construction over
 * `BRANDING_SLOTS`: a slot with no row is `null`, never a missing key, so a
 * caller destructuring the result never has to distinguish "absent" from
 * "not asked for".
 */
export function readAllBranding(db: Database.Database): Record<BrandingSlot, StoredBranding | null> {
  const rows = db
    .prepare('SELECT slot, bytes, content_type, byte_length, updated_at FROM branding')
    .all() as BrandingRow[]
  const bySlot = new Map(rows.map((row) => [row.slot, row]))
  const result = {} as Record<BrandingSlot, StoredBranding | null>
  for (const slot of BRANDING_SLOTS) {
    const row = bySlot.get(slot)
    result[slot] = row ? toStored(row) : null
  }
  return result
}

/**
 * Stores the bytes exactly as they arrived — no resizing, no re-encoding, no
 * dimension check (this task's Scope). An upsert, so writing a slot twice
 * replaces the image rather than accumulating rows; `slot` is the primary key,
 * so it could not accumulate even if this were an INSERT.
 *
 * Throws `ValidationError`, before any SQL runs, for an empty payload, one
 * over `BRANDING_MAX_BYTES`, or one whose magic numbers are not on
 * `BRANDING_CONTENT_TYPES` — SVG included. In every refusal case the table is
 * left exactly as it was, including a previously-stored image for that slot: a
 * rejected pick must not also destroy the mark that was already working.
 */
export function writeBrandingSlot(db: Database.Database, slot: BrandingSlot, bytes: Uint8Array): StoredBranding {
  const known = requireKnownSlot(slot)

  if (bytes.length === 0) {
    throw new ValidationError(`branding "${known}": the file is empty`)
  }
  // Checked before the sniff so an oversized but otherwise perfectly valid PNG
  // is refused for the reason that is actually true of it, rather than being
  // reported as an unrecognised format.
  if (bytes.length > BRANDING_MAX_BYTES) {
    throw new ValidationError(
      `branding "${known}": ${bytes.length} bytes exceeds the ${BRANDING_MAX_BYTES}-byte limit for one slot`
    )
  }

  const contentType = sniffImageContentType(bytes)
  if (contentType === null) {
    throw new ValidationError(
      `branding "${known}": the file is not a supported image. Accepted: PNG, JPEG, WEBP, GIF, BMP, ICO. SVG is not accepted.`
    )
  }

  const updatedAt = nowTimestamp()
  db.prepare(
    'INSERT INTO branding (slot, bytes, content_type, byte_length, updated_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(slot) DO UPDATE SET bytes = excluded.bytes, content_type = excluded.content_type, ' +
      'byte_length = excluded.byte_length, updated_at = excluded.updated_at'
  ).run(known, Buffer.from(bytes), contentType, bytes.length, updatedAt)

  return { slot: known, bytes, contentType, byteLength: bytes.length, updatedAt }
}

/**
 * Removes the operator's image for this slot, so the rail falls back to the
 * built-in default. Returns whether a row was actually removed.
 *
 * Deliberately **not** a `NotFoundError` on an absent slot: the caller asked
 * for "no operator image here" and that is already the state, so there is
 * nothing to report and nothing that went wrong. It also makes a reset of both
 * slots a straight loop with no per-slot existence check.
 */
export function clearBrandingSlot(db: Database.Database, slot: BrandingSlot): boolean {
  const known = requireKnownSlot(slot)
  const result = db.prepare('DELETE FROM branding WHERE slot = ?').run(known)
  return result.changes > 0
}
