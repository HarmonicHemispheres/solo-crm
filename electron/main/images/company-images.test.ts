import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COMPANY_IMAGE_MAX_BYTES } from '../../shared/company-images'
import type { CompanyImageSlot } from '../../shared/company-images'
import { createCompany } from '../db/repositories/companies'
import { readCompanyImage } from '../db/repositories/company-images'
import { closeDatabase, getDatabase, openDatabase } from '../db/connection'
import { NotFoundError, ValidationError } from '../db/repositories/errors'
import { pathLikeStrings } from '../branding/test-support/path-leak'
import type { DerivedImage, ImageDeriver } from './derive'
import {
  chooseCompanyImage,
  COMPANY_IMAGE_FILTER_EXTENSIONS,
  getCompanyImagesSnapshot,
  getCompanyImageThumbnails
} from './company-images'
import type { PickerDialog, PickerWindow, PickerWindowSource } from './picker'

/**
 * The company image edge (T-260901-12) is `branding/picker.test.ts`'s
 * subject a second time, with a company in front of the slot and a cap that
 * differs by slot — so the tests are, as there, mostly about absence: no path
 * in any response or refusal, no read of a file that was already too big, no
 * second native dialog, no dialog at all without a focused window, and no row
 * for a company that does not exist.
 *
 * Every test injects a fake `dialog`, a fake window source and a fake
 * deriver. The real `electron` module cannot be imported as a callable value
 * outside a genuine Electron process, a native file picker is not something an
 * automated test can click, and `nativeImage` — the derivative's decoder — is
 * `undefined` under vitest's `node` pool; `derive.electron.test.ts` proves the
 * real one.
 *
 * The single-flight guard is one `WeakSet` shared with the branding picker
 * (it lives in `./picker.ts`), so the overlapping-call test below is also the
 * proof that generalising the picker did not give this caller a guard of its
 * own that could drift.
 */

/** A genuine 1x1 PNG (IHDR + IDAT + IEND), so the round trip is a real file rather than a header that happens to sniff. */
const REAL_PNG = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
)

const SVG_DOCUMENT = new Uint8Array(
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24"/></svg>', 'utf-8')
)

/** A deriver that answers with a fixed source size and thumbnail bytes that spell out which slot asked, so a thumbnail's `data:` URL can be asserted exactly. */
function fakeDeriver(): ImageDeriver {
  return (bytes: Uint8Array, slot: CompanyImageSlot): DerivedImage => ({
    source: { width: 1200, height: 400 },
    thumbnail: {
      bytes: new Uint8Array(Buffer.from(`thumb:${slot}:${bytes.length}`, 'utf-8')),
      contentType: slot === 'logo' ? 'image/png' : 'image/jpeg',
      size: { width: 96, height: 32 }
    }
  })
}

let dbDir: string | null = null
let fixtureDir: string | null = null

function openTmpDb(): Database.Database {
  dbDir = mkdtempSync(join(tmpdir(), 'solo-crm-company-images-edge-db-'))
  openDatabase({ userDataDir: dbDir })
  return getDatabase()
}

/** A real file on disk, in a directory whose absolute path contains `sep` — what makes the "no path crosses back" assertions meaningful. */
function fixtureFile(name: string, bytes: Uint8Array): string {
  fixtureDir ??= mkdtempSync(join(tmpdir(), 'solo-crm-company-images-files-'))
  const path = join(fixtureDir, name)
  writeFileSync(path, bytes)
  return path
}

afterEach(() => {
  closeDatabase()
  if (dbDir) {
    rmSync(dbDir, { recursive: true, force: true })
    dbDir = null
  }
  if (fixtureDir) {
    rmSync(fixtureDir, { recursive: true, force: true })
    fixtureDir = null
  }
})

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const WINDOW: PickerWindow = { id: 'test-window' }

function windowSource(window: PickerWindow | null = WINDOW): PickerWindowSource {
  return { getFocusedWindow: () => window }
}

interface FakeDialog extends PickerDialog {
  readonly calls: Array<Parameters<PickerDialog['showOpenDialog']>[1]>
  readonly windows: PickerWindow[]
}

function fakeDialog(
  result: { canceled: boolean; filePaths: string[] } | (() => Promise<{ canceled: boolean; filePaths: string[] }>)
): FakeDialog {
  const calls: Array<Parameters<PickerDialog['showOpenDialog']>[1]> = []
  const windows: PickerWindow[] = []
  return {
    calls,
    windows,
    showOpenDialog: async (window, options) => {
      calls.push(options)
      windows.push(window)
      return typeof result === 'function' ? await result() : result
    }
  }
}

/** The dependencies every ordinary test passes: a dialog answering `result`, the focused test window, and the fake deriver. */
function deps(dialog: FakeDialog, window: PickerWindow | null = WINDOW) {
  return { dialog, windows: windowSource(window), derive: fakeDeriver() }
}

function rowCount(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM company_images').get() as { n: number }).n
}

describe('chooseCompanyImage — the ordinary case', () => {
  it('stores the chosen file for that company and answers with a data: URL and the decoded size, not a path', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const path = fixtureFile('logo.png', REAL_PNG)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    const choice = await chooseCompanyImage(db, company.id, 'logo', deps(dialog))

    expect(choice.outcome).toBe('chosen')
    if (choice.outcome !== 'chosen') return
    expect(choice.state).toEqual({
      state: 'present',
      slot: 'logo',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(REAL_PNG).toString('base64')}`,
      byteLength: REAL_PNG.length,
      width: 1200,
      height: 400,
      updatedAt: expect.any(String)
    })

    const stored = readCompanyImage(db, company.id, 'logo')
    expect(Buffer.from(stored?.bytes ?? []).equals(Buffer.from(REAL_PNG))).toBe(true)
    expect(stored?.contentType).toBe('image/png')
  })

  it('opens a single-file open dialog over the focused window, offering PNG and JPEG only — never svg, never a format the store refuses', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('banner.png', REAL_PNG)] })

    await chooseCompanyImage(db, company.id, 'banner', deps(dialog))

    expect(dialog.calls).toHaveLength(1)
    expect(dialog.calls[0].properties).toEqual(['openFile'])
    expect(dialog.windows[0]).toBe(WINDOW)
    const extensions = (dialog.calls[0].filters ?? []).flatMap((filter) => filter.extensions)
    expect(extensions).toEqual([...COMPANY_IMAGE_FILTER_EXTENSIONS])
    expect(extensions).not.toContain('svg')
    expect(extensions).not.toContain('webp')
    expect(extensions).not.toContain('gif')
  })
})

describe('chooseCompanyImage — a cancelled picker is a success that changed nothing', () => {
  it('answers { outcome: cancelled } and leaves an empty slot empty', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: true, filePaths: [] })

    const choice = await chooseCompanyImage(db, company.id, 'logo', deps(dialog))

    expect(choice).toEqual({ outcome: 'cancelled' })
    expect(rowCount(db)).toBe(0)
  })

  it('leaves an already-stored image byte-identical, timestamp included', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    await chooseCompanyImage(db, company.id, 'banner', deps(fakeDialog({ canceled: false, filePaths: [fixtureFile('a.png', REAL_PNG)] })))
    const before = readCompanyImage(db, company.id, 'banner')
    expect(before).not.toBeNull()

    const choice = await chooseCompanyImage(db, company.id, 'banner', deps(fakeDialog({ canceled: true, filePaths: [] })))

    expect(choice).toEqual({ outcome: 'cancelled' })
    expect(readCompanyImage(db, company.id, 'banner')).toEqual(before)
  })

  it('treats an empty selection with canceled: false as a cancellation rather than reading nothing', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })

    await expect(chooseCompanyImage(db, company.id, 'logo', deps(fakeDialog({ canceled: false, filePaths: [] })))).resolves.toEqual({
      outcome: 'cancelled'
    })
    expect(rowCount(db)).toBe(0)
  })
})

describe('chooseCompanyImage — a company that does not exist', () => {
  it('is refused as not-found, says nothing beyond that, and writes no row', async () => {
    const db = openTmpDb()
    const path = fixtureFile('logo.png', REAL_PNG)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    const error = await chooseCompanyImage(db, 'no-such-company', 'logo', deps(dialog)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(NotFoundError)
    // The refusal names the id the caller sent — a UUID it already held —
    // and nothing about the file it picked: not its path, not its name, not
    // its size.
    expect((error as Error).message).toBe('Company "no-such-company" was not found')
    expect(pathLikeStrings((error as Error).message)).toEqual([])
    expect(rowCount(db)).toBe(0)
  })
})

describe('chooseCompanyImage — what the bytes are is decided by the bytes', () => {
  it('refuses an SVG document chosen through the dialog and stores nothing', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('brand.png', SVG_DOCUMENT)] })

    const error = await chooseCompanyImage(db, company.id, 'logo', deps(dialog)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(pathLikeStrings((error as Error).message)).toEqual([])
    expect(rowCount(db)).toBe(0)
  })

  it('refuses a file that does not exist without leaking the path it was asked for', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const missing = join(tmpdir(), 'solo-crm-company-images-missing', 'nothing-here.png')
    const dialog = fakeDialog({ canceled: false, filePaths: [missing] })

    const error = await chooseCompanyImage(db, company.id, 'logo', deps(dialog)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect((error as Error).message).not.toContain(missing)
    expect(pathLikeStrings((error as Error).message)).toEqual([])
  })
})

describe('chooseCompanyImage — the cap is the slot’s, and it is applied before the read', () => {
  /** A file between the two caps: over a logo's, under a banner's. */
  const BETWEEN_CAPS = COMPANY_IMAGE_MAX_BYTES.logo + 1
  const recordingReader = () => {
    const readCalls: string[] = []
    const readFile_ = async (target: string): Promise<Uint8Array> => {
      readCalls.push(target)
      return new Uint8Array(await readFile(target))
    }
    return { readCalls, readFile: readFile_ }
  }

  it('refuses a logo over the logo cap, names that cap, and never reads the file', async () => {
    expect(BETWEEN_CAPS).toBeLessThanOrEqual(COMPANY_IMAGE_MAX_BYTES.banner)
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const oversized = new Uint8Array(BETWEEN_CAPS)
    oversized.set(REAL_PNG, 0)
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('huge.png', oversized)] })
    const reader = recordingReader()

    const error = await chooseCompanyImage(db, company.id, 'logo', { ...deps(dialog), readFile: reader.readFile }).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ValidationError)
    expect(reader.readCalls).toEqual([])
    expect((error as Error).message).toContain(String(COMPANY_IMAGE_MAX_BYTES.logo))
    expect((error as Error).message).toContain('a company logo')
    expect(pathLikeStrings((error as Error).message)).toEqual([])
    expect(rowCount(db)).toBe(0)
  })

  it('reads the same file for the banner slot, whose cap is larger — the bound is per slot, not one number', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const oversizedForLogo = new Uint8Array(BETWEEN_CAPS)
    oversizedForLogo.set(REAL_PNG, 0)
    const path = fixtureFile('wide.png', oversizedForLogo)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })
    const reader = recordingReader()

    const choice = await chooseCompanyImage(db, company.id, 'banner', { ...deps(dialog), readFile: reader.readFile })

    expect(choice.outcome).toBe('chosen')
    expect(reader.readCalls).toEqual([path])
  })

  it('refuses a banner over the banner cap before the read, naming the banner cap', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const oversized = new Uint8Array(COMPANY_IMAGE_MAX_BYTES.banner + 1)
    oversized.set(REAL_PNG, 0)
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('huge-banner.png', oversized)] })
    const reader = recordingReader()

    const error = await chooseCompanyImage(db, company.id, 'banner', { ...deps(dialog), readFile: reader.readFile }).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ValidationError)
    expect(reader.readCalls).toEqual([])
    expect((error as Error).message).toContain(String(COMPANY_IMAGE_MAX_BYTES.banner))
    expect(pathLikeStrings((error as Error).message)).toEqual([])
  })

  it('refuses before the read using the size on disk, not a size the caller declared', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('small.png', REAL_PNG)] })
    const reader = recordingReader()

    const error = await chooseCompanyImage(db, company.id, 'logo', {
      ...deps(dialog),
      stat: async () => ({ size: 2 * 1024 * 1024 * 1024 }),
      readFile: reader.readFile
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(reader.readCalls).toEqual([])
  })
})

describe('chooseCompanyImage — the two guards on the native dialog', () => {
  it('refuses when no window has focus, with a path-free message, and opens no dialog at all', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('logo.png', REAL_PNG)] })

    const error = await chooseCompanyImage(db, company.id, 'logo', deps(dialog, null)).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(pathLikeStrings((error as Error).message)).toEqual([])
    expect(dialog.calls).toEqual([])
    expect(rowCount(db)).toBe(0)
  })

  it('opens one dialog for two overlapping calls — the second resolves as cancelled', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const path = fixtureFile('logo.png', REAL_PNG)

    const open = deferred()
    const dialog = fakeDialog(async () => {
      await open.promise
      return { canceled: false, filePaths: [path] }
    })

    const first = chooseCompanyImage(db, company.id, 'logo', deps(dialog))
    const second = chooseCompanyImage(db, company.id, 'banner', deps(dialog))

    await expect(second).resolves.toEqual({ outcome: 'cancelled' })
    expect(dialog.calls).toHaveLength(1)

    open.resolve()
    expect((await first).outcome).toBe('chosen')
    expect(dialog.calls).toHaveLength(1)
  })

  it('releases the guard once the picker closes, so the next call opens a dialog again', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const dialog = fakeDialog({ canceled: true, filePaths: [] })

    await chooseCompanyImage(db, company.id, 'logo', deps(dialog))
    await chooseCompanyImage(db, company.id, 'logo', deps(dialog))

    expect(dialog.calls).toHaveLength(2)
  })
})

describe('no filesystem path crosses back to the renderer', () => {
  it('the chosen response, the snapshot and the thumbnails map contain no path separator anywhere', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const path = fixtureFile('logo.png', REAL_PNG)
    expect(path).toContain(sep)

    const choice = await chooseCompanyImage(db, company.id, 'logo', deps(fakeDialog({ canceled: false, filePaths: [path] })))
    expect(choice.outcome).toBe('chosen')

    expect(pathLikeStrings(choice)).toEqual([])
    expect(pathLikeStrings(getCompanyImagesSnapshot(db, company.id))).toEqual([])
    expect(pathLikeStrings(getCompanyImageThumbnails(db))).toEqual([])
  })
})

describe('getCompanyImagesSnapshot', () => {
  it('answers absent for both slots when nothing is stored — for a company that exists and for an id that does not', () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    const absent = { logo: { state: 'absent', slot: 'logo' }, banner: { state: 'absent', slot: 'banner' } }
    expect(getCompanyImagesSnapshot(db, company.id)).toEqual(absent)
    expect(getCompanyImagesSnapshot(db, 'no-such-company')).toEqual(absent)
  })

  it('builds each present slot as a data: URL of the stored original with the decoded size', async () => {
    const db = openTmpDb()
    const company = createCompany(db, { name: 'Rinvii' })
    await chooseCompanyImage(db, company.id, 'banner', deps(fakeDialog({ canceled: false, filePaths: [fixtureFile('b.png', REAL_PNG)] })))

    const snapshot = getCompanyImagesSnapshot(db, company.id)
    expect(snapshot.logo).toEqual({ state: 'absent', slot: 'logo' })
    expect(snapshot.banner).toMatchObject({
      state: 'present',
      slot: 'banner',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(REAL_PNG).toString('base64')}`,
      byteLength: REAL_PNG.length,
      width: 1200,
      height: 400
    })
  })
})

describe('getCompanyImageThumbnails — ADR-015’s list read, exactly', () => {
  it('is empty on a database with no images', () => {
    const db = openTmpDb()
    createCompany(db, { name: 'Rinvii' })
    expect(getCompanyImageThumbnails(db)).toEqual({})
  })

  it('is keyed by company id, holds present slots only, carries the derivative and never the original', async () => {
    const db = openTmpDb()
    const both = createCompany(db, { name: 'Both' })
    const logoOnly = createCompany(db, { name: 'Logo only' })
    createCompany(db, { name: 'Nothing' })
    const pick = (bytes: Uint8Array, name: string) => deps(fakeDialog({ canceled: false, filePaths: [fixtureFile(name, bytes)] }))

    await chooseCompanyImage(db, both.id, 'logo', pick(REAL_PNG, 'a.png'))
    await chooseCompanyImage(db, both.id, 'banner', pick(REAL_PNG, 'b.png'))
    await chooseCompanyImage(db, logoOnly.id, 'logo', pick(REAL_PNG, 'c.png'))

    const thumbnails = getCompanyImageThumbnails(db)

    // Present companies only, present slots only: no key for `Nothing`, no
    // `banner` key (not even a null one) for `Logo only`.
    expect(Object.keys(thumbnails).sort()).toEqual([both.id, logoOnly.id].sort())
    expect(Object.keys(thumbnails[logoOnly.id])).toEqual(['logo'])
    expect(Object.keys(thumbnails[both.id]).sort()).toEqual(['banner', 'logo'])

    // The derivative — the fake deriver's bytes, encoded — with the
    // *original's* dimensions beside it, and the slot's own content type.
    const logoThumb = Buffer.from(`thumb:logo:${REAL_PNG.length}`, 'utf-8').toString('base64')
    const bannerThumb = Buffer.from(`thumb:banner:${REAL_PNG.length}`, 'utf-8').toString('base64')
    expect(thumbnails[both.id].logo).toEqual({
      slot: 'logo',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${logoThumb}`,
      width: 1200,
      height: 400,
      updatedAt: expect.any(String)
    })
    expect(thumbnails[both.id].banner).toEqual({
      slot: 'banner',
      contentType: 'image/jpeg',
      dataUrl: `data:image/jpeg;base64,${bannerThumb}`,
      width: 1200,
      height: 400,
      updatedAt: expect.any(String)
    })

    // And nowhere in the map are the original's bytes.
    const original = Buffer.from(REAL_PNG).toString('base64')
    expect(JSON.stringify(thumbnails)).not.toContain(original)
  })
})
