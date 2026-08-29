import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BRANDING_MAX_BYTES, BRANDING_SLOTS, type BrandingSlot } from '../../../shared/branding'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { MIGRATIONS } from '../migrations'
import { clearBrandingSlot, readAllBranding, readBrandingSlot, writeBrandingSlot } from './branding'
import { ValidationError } from './errors'

/**
 * Every test here runs against a real, migrated file database opened through
 * `openDatabase({ userDataDir })` — never a directly-constructed better-sqlite3
 * handle, which `connection.test.ts`'s "single owner of the SQLite connection"
 * test enforces by walking every `.ts` file under `electron/`, this one
 * included.
 */

// A genuine 1x1 PNG (IHDR + IDAT + IEND, not just the 8-byte signature), so
// the round-trip case is a real file rather than a header that happens to
// sniff. Decoded once at module load.
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)

const SVG_DOCUMENT = new Uint8Array(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf-8')
)

/** Long enough to clear `sniff.ts`'s 12-byte minimum, so it is refused for being an unrecognised format rather than for being too short to look at. */
const NOT_AN_IMAGE = new Uint8Array(Buffer.from('this is definitely not an image at all', 'utf-8'))

/** A valid PNG header padded to exactly one byte over the cap: the cap is what must refuse it, not the sniffer. */
function oversizedPng(): Uint8Array {
  const bytes = new Uint8Array(BRANDING_MAX_BYTES + 1)
  bytes.set(REAL_PNG.subarray(0, Math.min(REAL_PNG.length, bytes.length)), 0)
  return bytes
}

let tmpDir: string | null = null

function openTmpDb(): Database.Database {
  tmpDir = mkdtempSync(join(tmpdir(), 'solo-crm-branding-'))
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

function rowCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM branding').get() as { n: number }).n
}

describe('writeBrandingSlot / readBrandingSlot: the round trip', () => {
  it('stores a real PNG and reads back the exact bytes with content_type image/png', () => {
    const db = openTmpDb()

    const written = writeBrandingSlot(db, 'logo', REAL_PNG)
    expect(written.contentType).toBe('image/png')
    expect(written.byteLength).toBe(REAL_PNG.length)

    const read = readBrandingSlot(db, 'logo')
    expect(read).not.toBeNull()
    expect(read?.contentType).toBe('image/png')
    expect(read?.byteLength).toBe(REAL_PNG.length)
    // Byte-for-byte, not merely the same length: nothing resizes or re-encodes.
    expect(Array.from(read?.bytes ?? [])).toEqual(Array.from(REAL_PNG))
    expect(read?.updatedAt).toBe(written.updatedAt)
  })

  it('reads an untouched slot as null — absence is the answer, not an error', () => {
    const db = openTmpDb()
    expect(readBrandingSlot(db, 'icon')).toBeNull()
  })

  it('the stored content_type is sniffed, never taken from a caller — writeBrandingSlot accepts no declared type', () => {
    const db = openTmpDb()
    // The signature is the whole contract: two arguments after `db`, neither a
    // content type. A third parameter would be a way to lie about the bytes.
    expect(writeBrandingSlot.length).toBe(3)
    const written = writeBrandingSlot(db, 'icon', REAL_PNG)
    expect(written.contentType).toBe('image/png')
  })
})

describe('writeBrandingSlot: what it refuses, and that a refusal writes nothing', () => {
  it('refuses an <svg …> document and leaves the slot absent', () => {
    const db = openTmpDb()

    expect(() => writeBrandingSlot(db, 'logo', SVG_DOCUMENT)).toThrow(ValidationError)
    expect(readBrandingSlot(db, 'logo')).toBeNull()
    expect(rowCount(db)).toBe(0)
  })

  it('refuses bytes that sniff as nothing and leaves the slot absent', () => {
    const db = openTmpDb()

    expect(() => writeBrandingSlot(db, 'icon', NOT_AN_IMAGE)).toThrow(ValidationError)
    expect(readBrandingSlot(db, 'icon')).toBeNull()
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a payload one byte over the cap and leaves the slot absent', () => {
    const db = openTmpDb()
    const tooBig = oversizedPng()
    expect(tooBig.length).toBe(BRANDING_MAX_BYTES + 1)

    expect(() => writeBrandingSlot(db, 'logo', tooBig)).toThrow(ValidationError)
    expect(readBrandingSlot(db, 'logo')).toBeNull()
    expect(rowCount(db)).toBe(0)
  })

  it('accepts a payload of exactly the cap — the boundary is inclusive', () => {
    const db = openTmpDb()
    const atCap = new Uint8Array(BRANDING_MAX_BYTES)
    atCap.set(REAL_PNG, 0)

    const written = writeBrandingSlot(db, 'logo', atCap)
    expect(written.byteLength).toBe(BRANDING_MAX_BYTES)
    expect(readBrandingSlot(db, 'logo')?.byteLength).toBe(BRANDING_MAX_BYTES)
  })

  it('refuses an empty payload', () => {
    const db = openTmpDb()
    expect(() => writeBrandingSlot(db, 'icon', new Uint8Array(0))).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)
  })

  it('a refused write does not destroy the image already in that slot', () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'logo', REAL_PNG)

    expect(() => writeBrandingSlot(db, 'logo', SVG_DOCUMENT)).toThrow(ValidationError)

    const still = readBrandingSlot(db, 'logo')
    expect(still?.contentType).toBe('image/png')
    expect(Array.from(still?.bytes ?? [])).toEqual(Array.from(REAL_PNG))
  })

  it('refuses a slot name that arrived widened to string, before any SQL runs', () => {
    const db = openTmpDb()
    // The cast is what a future IPC request body deserialised from the
    // renderer looks like after `unknown` is narrowed by something other than
    // `brandingSlotSchema`. `requireKnownSlot` is the runtime half of the
    // compile-time narrowing every in-process call site already gets.
    expect(() => writeBrandingSlot(db, 'favicon' as unknown as BrandingSlot, REAL_PNG)).toThrow(ValidationError)
    expect(rowCount(db)).toBe(0)
  })
})

describe('writeBrandingSlot: writing twice replaces rather than accumulates', () => {
  it('keeps exactly one row per slot and serves the second image', () => {
    const db = openTmpDb()

    // A GIF the second time, so "replaced" is visible in the content type as
    // well as in the row count.
    const gif = new Uint8Array(Buffer.from('R0lGODlhAQABAAAAACH5BAEAAAAALAAAAAABAAEAAAI=', 'base64'))

    writeBrandingSlot(db, 'icon', REAL_PNG)
    writeBrandingSlot(db, 'icon', gif)

    expect(rowCount(db)).toBe(1)
    const read = readBrandingSlot(db, 'icon')
    expect(read?.contentType).toBe('image/gif')
    expect(read?.byteLength).toBe(gif.length)
    expect(Array.from(read?.bytes ?? [])).toEqual(Array.from(gif))
  })

  it('never holds more than one row per slot across both slots', () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'icon', REAL_PNG)
    writeBrandingSlot(db, 'logo', REAL_PNG)
    writeBrandingSlot(db, 'icon', REAL_PNG)
    writeBrandingSlot(db, 'logo', REAL_PNG)
    expect(rowCount(db)).toBe(BRANDING_SLOTS.length)
  })
})

describe('clearBrandingSlot', () => {
  it('is a no-op on an absent slot rather than an error', () => {
    const db = openTmpDb()
    expect(() => clearBrandingSlot(db, 'logo')).not.toThrow()
    expect(clearBrandingSlot(db, 'logo')).toBe(false)
    expect(readBrandingSlot(db, 'logo')).toBeNull()
  })

  it('removes a stored image and leaves the other slot alone', () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'icon', REAL_PNG)
    writeBrandingSlot(db, 'logo', REAL_PNG)

    expect(clearBrandingSlot(db, 'icon')).toBe(true)
    expect(readBrandingSlot(db, 'icon')).toBeNull()
    expect(readBrandingSlot(db, 'logo')).not.toBeNull()
  })
})

describe('readAllBranding', () => {
  it('answers for every declared slot, with null for the ones never set', () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'logo', REAL_PNG)

    const all = readAllBranding(db)
    expect(Object.keys(all).sort()).toEqual([...BRANDING_SLOTS].sort())
    expect(all.icon).toBeNull()
    expect(all.logo?.contentType).toBe('image/png')
  })
})

describe('migration 0005 against a database created before it existed', () => {
  /** Everything up to and including 0004 — the schema a database from before this task is at. */
  const BEFORE_0005 = MIGRATIONS.filter((m) => m.version <= 4)

  it('adds `branding`, leaves existing rows untouched, and re-running the set changes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'solo-crm-branding-migrate-'))
    tmpDir = dir
    const now = '2026-08-29T10:15:00.000Z'

    // 1. A database at 0004, with a row in it.
    openDatabase({ userDataDir: dir, migrations: BEFORE_0005 })
    let db = getDatabase()
    expect(BEFORE_0005.map((m) => m.version)).toEqual([1, 2, 3, 4])
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='branding'").get()).toBeUndefined()
    db.prepare('INSERT INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'pre-branding-co',
      'Pre Branding Co',
      now,
      now
    )
    closeDatabase()

    // 2. Reopened with the real set: 0005 applies on top.
    openDatabase({ userDataDir: dir })
    db = getDatabase()
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='branding'").get()).toBeDefined()
    expect(db.prepare('SELECT name FROM companies WHERE id = ?').get('pre-branding-co')).toEqual({
      name: 'Pre Branding Co'
    })
    writeBrandingSlot(db, 'icon', REAL_PNG)
    const appliedOnce = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()
    closeDatabase()

    // 3. A second boot re-runs the same set: `schema_migrations` already holds
    //    version 5, so nothing is applied again and no data moves.
    openDatabase({ userDataDir: dir })
    db = getDatabase()
    expect(db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all()).toEqual(appliedOnce)
    expect(appliedOnce).toContainEqual({ version: 5, name: '0005_branding' })
    expect(readBrandingSlot(db, 'icon')?.contentType).toBe('image/png')
    expect(db.prepare('SELECT COUNT(*) AS n FROM companies').get()).toEqual({ n: 1 })
  })
})

describe('the branding table takes ADR-002/ADR-012 natural-identity shape', () => {
  it('is keyed by `slot`, has no `id` and no `created_at`, and every column is NOT NULL', () => {
    const db = openTmpDb()
    const columns = db.prepare('PRAGMA table_info(branding)').all() as {
      name: string
      type: string
      notnull: number
      pk: number
      dflt_value: unknown
    }[]

    expect(columns.find((c) => c.name === 'id')).toBeUndefined()
    expect(columns.find((c) => c.name === 'created_at')).toBeUndefined()

    const slot = columns.find((c) => c.name === 'slot')
    expect(slot?.type.toUpperCase()).toBe('TEXT')
    expect(slot?.pk).toBe(1)

    expect(columns.map((c) => c.name).sort()).toEqual(['byte_length', 'bytes', 'content_type', 'slot', 'updated_at'])
    for (const column of columns) {
      expect(column.notnull, `${column.name} NOT NULL`).toBe(1)
      // CONVENTIONS.md: no SQL-side timestamp default, anywhere.
      expect(column.dflt_value, `${column.name} has no SQL-side default`).toBeNull()
    }
  })
})
