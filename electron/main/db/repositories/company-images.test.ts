import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  COMPANY_IMAGE_MAX_BYTES,
  COMPANY_IMAGE_MAX_PIXELS,
  COMPANY_IMAGE_SLOTS,
  type CompanyImageSlot
} from '../../../shared/company-images'
import type { DerivedImage, ImageDeriver } from '../../images/derive'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { deleteCompany } from './companies'
import {
  clearCompanyImage,
  listCompanyImageThumbnails,
  readCompanyImage,
  readCompanyImages,
  writeCompanyImage
} from './company-images'
import { NotFoundError, ValidationError } from './errors'

/**
 * Every test here runs against a real, migrated file database opened through
 * `openDatabase({ userDataDir })` — never a directly-constructed better-sqlite3
 * handle, which `connection.test.ts`'s "single owner of the SQLite connection"
 * test enforces by walking every `.ts` file under `electron/`, this one
 * included.
 *
 * The deriver is faked throughout, for the reason ADR-015 §3 gives: the real
 * one is `nativeImage`, and `electron` under plain-Node vitest resolves to a
 * string path rather than the API. `derive.electron.test.ts` exercises the
 * real one inside a throwaway Electron.
 *
 * The fake is deliberately *not* a stand-in for the guards. The byte cap, the
 * magic-number sniff and the pixel-count ceiling all run in the repository,
 * before the deriver is called, so a fake cannot make an unbounded image
 * acceptable — which is exactly what the refusal tests below assert, with a
 * fake that would happily derive anything.
 */

// A genuine 1x1 PNG (IHDR + IDAT + IEND), the same fixture branding.test.ts
// uses — its IHDR honestly declares 1x1, so the pixel guard reads a true
// answer from a real file rather than from a hand-built header.
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)

/** A PNG whose IHDR declares `width` x `height`. Only the header is real — the pixel guard is a header read, by design. */
function pngDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8) // IHDR chunk length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  new DataView(bytes.buffer).setUint32(16, width, false)
  new DataView(bytes.buffer).setUint32(20, height, false)
  bytes[24] = 8 // bit depth
  bytes[25] = 6 // colour type
  return bytes
}

/** A JPEG whose first SOF0 segment declares `width` x `height`, behind a JFIF APP0 — so the marker walk has something to walk past. */
function jpegDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // SOF0
    0xff, 0xd9 // EOI
  ])
  const sof = 20
  bytes[sof + 5] = (height >> 8) & 0xff
  bytes[sof + 6] = height & 0xff
  bytes[sof + 7] = (width >> 8) & 0xff
  bytes[sof + 8] = width & 0xff
  return bytes
}

const SVG_DOCUMENT = new Uint8Array(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf-8')
)

/** A real GIF — a valid image the *sniffer* recognises, refused here because `nativeImage` cannot decode one from a buffer (ADR-015 §5). */
const REAL_GIF = new Uint8Array(Buffer.from('R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAI=', 'base64'))

/** Long enough to clear `sniff.ts`'s 12-byte minimum, so it is refused for being an unrecognised format rather than for being too short to look at. */
const NOT_AN_IMAGE = new Uint8Array(Buffer.from('this is definitely not an image at all', 'utf-8'))

/**
 * A deriver that decodes nothing. It answers a fixed source size (1200 x 400,
 * deliberately nothing like the fixtures' real dimensions, so a stored
 * `width`/`height` taken from the header instead of from the decoder would be
 * visible) and thumbnail bytes that spell out which slot asked for them.
 */
function fakeDeriver(): ImageDeriver & { calls: CompanyImageSlot[] } {
  const calls: CompanyImageSlot[] = []
  const derive = (bytes: Uint8Array, slot: CompanyImageSlot): DerivedImage => {
    calls.push(slot)
    return {
      source: { width: 1200, height: 400 },
      thumbnail: {
        bytes: new Uint8Array(Buffer.from(`thumb:${slot}:${bytes.length}`, 'utf-8')),
        contentType: slot === 'logo' ? 'image/png' : 'image/jpeg',
        size: { width: 96, height: 32 }
      }
    }
  }
  return Object.assign(derive, { calls })
}

/** A deriver that always fails to decode — the malformed-raster case. */
const emptyDeriver: ImageDeriver = () => null

let tmpDir: string | null = null

function openTmpDb(): Database.Database {
  tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-company-images-'))
  openDatabase({ userDataDir: tmpDir })
  return getDatabase()
}

afterEach(() => {
  closeDatabase()
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = null
  }
})

const T = '2026-09-01T10:00:00.000Z'

function addCompany(db: Database.Database, id: string, name: string): string {
  db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, T, T)
  return id
}

function rowCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM company_images').get() as { n: number }).n
}

describe('writeCompanyImage / readCompanyImage: the round trip', () => {
  it('stores the original byte-for-byte, with the type sniffed and the size from the decoder', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    const written = writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    expect(written.contentType).toBe('image/png')
    expect(written.byteLength).toBe(REAL_PNG.length)
    // 1200x400 is the *deriver's* answer, not the 1x1 the PNG header declares:
    // ADR-015 stores the decoder's `getSize()`, which the header read only
    // bounds.
    expect(written.width).toBe(1200)
    expect(written.height).toBe(400)

    const read = readCompanyImage(db, 'co-1', 'logo')
    expect(read?.contentType).toBe('image/png')
    expect(read?.byteLength).toBe(REAL_PNG.length)
    expect(Array.from(read?.bytes ?? [])).toEqual(Array.from(REAL_PNG))
    expect(read?.width).toBe(1200)
    expect(read?.height).toBe(400)
    expect(read?.createdAt).toBe(written.createdAt)
    expect(read?.updatedAt).toBe(written.updatedAt)
  })

  it('accepts a JPEG as well as a PNG, and stores the sniffed type for each', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-1', 'banner', jpegDeclaring(2400, 800), { derive })

    expect(readCompanyImage(db, 'co-1', 'logo')?.contentType).toBe('image/png')
    expect(readCompanyImage(db, 'co-1', 'banner')?.contentType).toBe('image/jpeg')
  })

  it('reads an untouched slot as null — absence is the answer, not an error', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(readCompanyImage(db, 'co-1', 'banner')).toBeNull()
    expect(readCompanyImages(db, 'co-1')).toEqual({ logo: null, banner: null })
  })

  it('takes no declared content type — the bytes decide what they are', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    // db, companyId, slot, bytes, deps — five parameters, and `deps` has a
    // default so `.length` counts four. None of them is a content type: a
    // parameter for one would be a way to lie about the bytes, which is how a
    // `.png` that is really an `<svg …>` document would get in.
    expect(writeCompanyImage.length).toBe(4)
    const written = writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: fakeDeriver() })
    expect(written.contentType).toBe('image/png')
  })

  it("the derivative's format is a function of the slot, not of the original's — a PNG banner is stored as JPEG", () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    writeCompanyImage(db, 'co-1', 'banner', REAL_PNG, { derive })

    const [thumb] = listCompanyImageThumbnails(db)
    expect(thumb.contentType).toBe('image/jpeg')
    expect(readCompanyImage(db, 'co-1', 'banner')?.contentType).toBe('image/png')
    expect(derive.calls).toEqual(['banner'])
  })
})

describe('listCompanyImageThumbnails: the grid read never carries an original', () => {
  it('returns the derivative for every present slot of every company, and no originals', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    addCompany(db, 'co-2', 'Northwind')
    addCompany(db, 'co-3', 'No Pictures Ltd')
    const derive = fakeDeriver()

    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-1', 'banner', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-2', 'logo', REAL_PNG, { derive })

    const thumbnails = listCompanyImageThumbnails(db)
    expect(thumbnails.map((t) => `${t.companyId}/${t.slot}`)).toEqual(['co-1/banner', 'co-1/logo', 'co-2/logo'])
    // Present slots only: a company with no images is simply absent, and the
    // grid draws its derived mark.
    expect(thumbnails.some((t) => t.companyId === 'co-3')).toBe(false)

    for (const thumb of thumbnails) {
      const decoded = Buffer.from(thumb.bytes).toString('utf-8')
      expect(decoded).toBe(`thumb:${thumb.slot}:${REAL_PNG.length}`)
      expect(thumb.byteLength).toBe(thumb.bytes.length)
      // Byte-for-byte *not* the original — the assertion the whole decision
      // rests on. A read that returned originals would still pass every shape
      // check above.
      expect(Array.from(thumb.bytes)).not.toEqual(Array.from(REAL_PNG))
      // The original's dimensions travel with the derivative so a card can
      // reserve the box before the image decodes.
      expect(thumb.width).toBe(1200)
      expect(thumb.height).toBe(400)
    }
  })

  it('is empty on a database where nobody has uploaded anything', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(listCompanyImageThumbnails(db)).toEqual([])
  })
})

describe('writeCompanyImage: what it refuses, and that a refusal writes nothing', () => {
  it('refuses an <svg …> document on its bytes, whatever the file was called', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(() => writeCompanyImage(db, 'co-1', 'logo', SVG_DOCUMENT, { derive: fakeDeriver() })).toThrow(
      ValidationError
    )
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a real GIF — the accepted set here is PNG and JPEG, narrower than the rail’s', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(() => writeCompanyImage(db, 'co-1', 'logo', REAL_GIF, { derive: fakeDeriver() })).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)
  })

  it('refuses bytes that sniff as nothing, and an empty payload', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(() => writeCompanyImage(db, 'co-1', 'logo', NOT_AN_IMAGE, { derive: fakeDeriver() })).toThrow(
      ValidationError
    )
    expect(() => writeCompanyImage(db, 'co-1', 'logo', new Uint8Array(0), { derive: fakeDeriver() })).toThrow(
      ValidationError
    )
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a payload one byte over the slot’s own cap, and no row is written', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    const overLogoCap = new Uint8Array(COMPANY_IMAGE_MAX_BYTES.logo + 1)
    overLogoCap.set(REAL_PNG, 0)
    expect(() => writeCompanyImage(db, 'co-1', 'logo', overLogoCap, { derive })).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)

    // The caps are per slot, not one shared number: the same payload is
    // comfortably inside the banner's 1 MB.
    expect(() => writeCompanyImage(db, 'co-1', 'banner', overLogoCap, { derive })).not.toThrow()
    expect(readCompanyImage(db, 'co-1', 'banner')?.byteLength).toBe(COMPANY_IMAGE_MAX_BYTES.logo + 1)

    const overBannerCap = new Uint8Array(COMPANY_IMAGE_MAX_BYTES.banner + 1)
    overBannerCap.set(REAL_PNG, 0)
    expect(() => writeCompanyImage(db, 'co-1', 'banner', overBannerCap, { derive })).toThrow(ValidationError)
  })

  it('accepts a payload of exactly the cap — the boundary is inclusive', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const atCap = new Uint8Array(COMPANY_IMAGE_MAX_BYTES.logo)
    atCap.set(REAL_PNG, 0)
    expect(writeCompanyImage(db, 'co-1', 'logo', atCap, { derive: fakeDeriver() }).byteLength).toBe(
      COMPANY_IMAGE_MAX_BYTES.logo
    )
  })

  it('refuses an image over the pixel ceiling before the decoder is ever called', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    // 20000 x 20000 = 400 MP in a 64-byte file: a byte cap says nothing about
    // this, which is the whole reason the header is read.
    expect(() => writeCompanyImage(db, 'co-1', 'logo', pngDeclaring(20_000, 20_000), { derive })).toThrow(
      ValidationError
    )
    expect(() => writeCompanyImage(db, 'co-1', 'banner', jpegDeclaring(20_000, 20_000), { derive })).toThrow(
      ValidationError
    )
    // Never handed to the decoder — the guard is before it, not after.
    expect(derive.calls).toEqual([])
    expect(rowCount(db)).toBe(0)
  })

  it('accepts an image right at the pixel ceiling, and refuses one pixel more', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()
    const side = Math.sqrt(COMPANY_IMAGE_MAX_PIXELS)
    expect(Number.isInteger(side)).toBe(true)

    expect(() => writeCompanyImage(db, 'co-1', 'logo', pngDeclaring(side, side), { derive })).not.toThrow()
    expect(() => writeCompanyImage(db, 'co-1', 'banner', pngDeclaring(side + 1, side), { derive })).toThrow(
      ValidationError
    )
  })

  it('refuses an image whose header cannot be read at all', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    // A PNG signature with no IHDR behind it: it sniffs, and then says nothing
    // about its own size — which cannot be bounded, so it is refused.
    const headerless = new Uint8Array(32)
    headerless.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    expect(() => writeCompanyImage(db, 'co-1', 'logo', headerless, { derive: fakeDeriver() })).toThrow(
      ValidationError
    )
    expect(rowCount(db)).toBe(0)
  })

  it('refuses an image that passes every guard and still decodes empty', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(() => writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: emptyDeriver })).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a company that does not exist, with NotFoundError rather than a raw constraint error', () => {
    const db = openTmpDb()
    expect(() => writeCompanyImage(db, 'no-such-co', 'logo', REAL_PNG, { derive: fakeDeriver() })).toThrow(
      NotFoundError
    )
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a slot name that arrived widened to string, before any SQL runs', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(() =>
      writeCompanyImage(db, 'co-1', 'icon' as unknown as CompanyImageSlot, REAL_PNG, { derive: fakeDeriver() })
    ).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)
  })

  it('a refused write does not destroy the image already in that slot', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })

    expect(() => writeCompanyImage(db, 'co-1', 'logo', SVG_DOCUMENT, { derive })).toThrow(ValidationError)

    const still = readCompanyImage(db, 'co-1', 'logo')
    expect(still?.contentType).toBe('image/png')
    expect(Array.from(still?.bytes ?? [])).toEqual(Array.from(REAL_PNG))
  })

  it('names no filesystem path in any refusal — the renderer asked for a picture, not a location', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()
    const oversized = new Uint8Array(COMPANY_IMAGE_MAX_BYTES.logo + 1)
    oversized.set(REAL_PNG, 0)

    const attempts: Array<() => unknown> = [
      () => writeCompanyImage(db, 'co-1', 'logo', SVG_DOCUMENT, { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', REAL_GIF, { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', NOT_AN_IMAGE, { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', new Uint8Array(0), { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', oversized, { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', pngDeclaring(20_000, 20_000), { derive }),
      () => writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: emptyDeriver }),
      () => writeCompanyImage(db, 'no-such-co', 'logo', REAL_PNG, { derive })
    ]

    for (const attempt of attempts) {
      let message: string | null = null
      try {
        attempt()
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      expect(message, 'every attempt above must refuse').not.toBeNull()
      // No path separator of either kind, and no drive root. The drive-letter
      // pattern requires the letter to stand alone — a word ending in a colon
      // ("company logo:") is prose, not a location.
      expect(message).not.toMatch(/[\\/]/)
      expect(message).not.toMatch(/(^|[^A-Za-z])[A-Za-z]:/)
    }
  })
})

describe('writeCompanyImage: writing twice replaces rather than accumulates', () => {
  it('keeps one row per (company, slot), keeps its id and created_at, and serves the second image', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()

    const first = writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    const firstId = (db.prepare('SELECT id FROM company_images WHERE company_id = ?').get('co-1') as { id: string }).id

    const replacement = jpegDeclaring(800, 600)
    const second = writeCompanyImage(db, 'co-1', 'logo', replacement, { derive })

    expect(rowCount(db)).toBe(1)
    const secondId = (db.prepare('SELECT id FROM company_images WHERE company_id = ?').get('co-1') as { id: string }).id
    // The row describes the slot, not the picture: a replacement is the same
    // row, so its id and creation moment survive.
    expect(secondId).toBe(firstId)
    expect(second.createdAt).toBe(first.createdAt)

    const read = readCompanyImage(db, 'co-1', 'logo')
    expect(read?.contentType).toBe('image/jpeg')
    expect(Array.from(read?.bytes ?? [])).toEqual(Array.from(replacement))
  })

  it('never holds more than one row per slot across both slots', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()
    for (const slot of [...COMPANY_IMAGE_SLOTS, ...COMPANY_IMAGE_SLOTS]) {
      writeCompanyImage(db, 'co-1', slot, REAL_PNG, { derive })
    }
    expect(rowCount(db)).toBe(COMPANY_IMAGE_SLOTS.length)
  })

  it('does not touch companies.updated_at — the company record did not change', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: fakeDeriver() })
    expect(db.prepare('SELECT updated_at FROM companies WHERE id = ?').get('co-1')).toEqual({ updated_at: T })
  })

  it('two companies are independent — writing one does not touch the other’s row', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    addCompany(db, 'co-2', 'Northwind')
    const derive = fakeDeriver()

    const other = writeCompanyImage(db, 'co-2', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-1', 'logo', jpegDeclaring(800, 600), { derive })
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })

    const unchanged = readCompanyImage(db, 'co-2', 'logo')
    expect(unchanged?.updatedAt).toBe(other.updatedAt)
    expect(unchanged?.createdAt).toBe(other.createdAt)
    expect(unchanged?.contentType).toBe('image/png')
  })
})

describe('clearCompanyImage', () => {
  it('removes the row, and the slot reads back absent rather than as a sentinel', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    const derive = fakeDeriver()
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-1', 'banner', REAL_PNG, { derive })

    expect(clearCompanyImage(db, 'co-1', 'logo')).toBe(true)
    expect(readCompanyImage(db, 'co-1', 'logo')).toBeNull()
    expect(rowCount(db)).toBe(1)
    // The other slot is untouched, and so is the other company's would-be row.
    expect(readCompanyImage(db, 'co-1', 'banner')).not.toBeNull()
  })

  it('is a no-op on an absent slot rather than an error', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    expect(clearCompanyImage(db, 'co-1', 'banner')).toBe(false)
  })

  it('clears only the named company’s slot', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    addCompany(db, 'co-2', 'Northwind')
    const derive = fakeDeriver()
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-2', 'logo', REAL_PNG, { derive })

    clearCompanyImage(db, 'co-1', 'logo')
    expect(readCompanyImage(db, 'co-1', 'logo')).toBeNull()
    expect(readCompanyImage(db, 'co-2', 'logo')).not.toBeNull()
  })
})

describe('deleting a company takes its images with it (ADR-015 §6)', () => {
  it('deleteCompany removes both slots, counted rather than read off the DDL', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    addCompany(db, 'co-2', 'Northwind')
    const derive = fakeDeriver()
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-1', 'banner', REAL_PNG, { derive })
    writeCompanyImage(db, 'co-2', 'logo', REAL_PNG, { derive })
    expect(rowCount(db)).toBe(3)

    // An image is not a blocker: `deleteCompany`'s `refuseIfReferenced` list
    // deliberately does not gain this table, so a company with pictures
    // deletes rather than refusing.
    deleteCompany(db, 'co-1')

    expect(rowCount(db)).toBe(1)
    expect(listCompanyImageThumbnails(db).map((t) => t.companyId)).toEqual(['co-2'])
    expect(db.pragma('foreign_key_check')).toEqual([])
  })

  it('the cascade is the engine’s, so a delete that never goes through the repository still fires it', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: fakeDeriver() })

    db.prepare('DELETE FROM companies WHERE id = ?').run('co-1')

    expect(rowCount(db)).toBe(0)
  })
})

describe('the company_images table takes ADR-015 §2’s shape', () => {
  interface ColumnInfo {
    cid: number
    name: string
    type: string
    notnull: number
    pk: number
    dflt_value: unknown
  }

  it('is keyed by a UUID `id`, carries created_at/updated_at, and every column is NOT NULL with no SQL-side default', () => {
    const db = openTmpDb()
    const columns = db.prepare('PRAGMA table_info(company_images)').all() as ColumnInfo[]

    const id = columns.find((c) => c.name === 'id')
    expect(id?.type.toUpperCase()).toBe('TEXT')
    expect(id?.pk).toBe(1)

    for (const field of ['created_at', 'updated_at']) {
      expect(columns.find((c) => c.name === field)?.type.toUpperCase()).toBe('TEXT')
    }

    for (const column of columns) {
      expect(column.notnull, `${column.name} NOT NULL`).toBe(1)
      // CONVENTIONS.md: no SQL-side timestamp default, anywhere.
      expect(column.dflt_value, `${column.name} has no SQL-side default`).toBeNull()
    }
  })

  it('declares the original LAST, which is what makes the thumbnail read cheap', () => {
    const db = openTmpDb()
    const columns = db.prepare('PRAGMA table_info(company_images)').all() as ColumnInfo[]
    // Not a style preference: SQLite walks a row's overflow pages in declared
    // order, so the grid's read of `thumb_bytes` only stays cheap while the
    // up-to-1 MB original sits behind it.
    expect(columns.map((c) => c.name)).toEqual([
      'id',
      'company_id',
      'slot',
      'content_type',
      'byte_length',
      'width',
      'height',
      'created_at',
      'updated_at',
      'thumb_content_type',
      'thumb_byte_length',
      'thumb_bytes',
      'bytes'
    ])
  })

  it('enforces (company_id, slot) as a unique index rather than as the key', () => {
    const db = openTmpDb()
    addCompany(db, 'co-1', 'Rinvii')
    writeCompanyImage(db, 'co-1', 'logo', REAL_PNG, { derive: fakeDeriver() })

    expect(() =>
      db
        .prepare(
          'INSERT INTO company_images (id, company_id, slot, content_type, byte_length, width, height, ' +
            'created_at, updated_at, thumb_content_type, thumb_byte_length, thumb_bytes, bytes) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('second-row', 'co-1', 'logo', 'image/png', 1, 1, 1, T, T, 'image/png', 1, Buffer.from([1]), Buffer.from([1]))
    ).toThrow(/UNIQUE constraint failed/i)
  })

  it('refuses a row naming a company that does not exist', () => {
    const db = openTmpDb()
    expect(() =>
      db
        .prepare(
          'INSERT INTO company_images (id, company_id, slot, content_type, byte_length, width, height, ' +
            'created_at, updated_at, thumb_content_type, thumb_byte_length, thumb_bytes, bytes) ' +
            'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run('orphan', 'no-such-co', 'logo', 'image/png', 1, 1, 1, T, T, 'image/png', 1, Buffer.from([1]), Buffer.from([1]))
    ).toThrow(/FOREIGN KEY constraint failed/i)
  })
})
