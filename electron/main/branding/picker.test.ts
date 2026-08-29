import type Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BRANDING_MAX_BYTES } from '../../shared/branding'
import { closeDatabase, getDatabase, openDatabase } from '../db/connection'
import { readBrandingSlot, writeBrandingSlot } from '../db/repositories/branding'
import { ValidationError } from '../db/repositories/errors'
import type { BrandingDialog, BrandingPickerWindow, BrandingWindowSource } from './picker'
import { chooseBrandingImage, getBrandingSnapshot, IMAGE_FILTER_EXTENSIONS } from './picker'
import { pathLikeStrings } from './test-support/path-leak'

/**
 * The picker's whole point is what does **not** come back across the boundary
 * (`picker.ts`'s header), so the tests below are mostly about absence: no
 * path in any response, no read of a file that was already too big, no second
 * native dialog, no dialog at all without a focused window.
 *
 * Every test injects a fake `dialog` and a fake window source. The real
 * `electron` module cannot be imported as a callable value outside a genuine
 * Electron process (`renderer-globals.test.ts` explains why), and a native
 * file picker is not something an automated test can click — which is exactly
 * why `BrandingDialog` is a structural interface, following
 * `data-location-prompt.ts`'s `FirstRunDialog` and `app-menu.ts`'s
 * `MoveDataFolderDialog`.
 *
 * The database is a real, migrated file database opened through
 * `openDatabase({ userDataDir })`, never a directly-constructed better-sqlite3
 * handle — `connection.test.ts` walks every `.ts` file under `electron/` to
 * enforce that, this one included.
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

let dbDir: string | null = null
let fixtureDir: string | null = null

function openTmpDb(): Database.Database {
  dbDir = mkdtempSync(join(tmpdir(), 'solo-crm-picker-db-'))
  openDatabase({ userDataDir: dbDir })
  return getDatabase()
}

/**
 * A real file on disk, in a directory whose absolute path contains `sep` —
 * which is what makes the "no path crosses back" assertions below meaningful
 * rather than vacuous.
 */
function fixtureFile(name: string, bytes: Uint8Array): string {
  fixtureDir ??= mkdtempSync(join(tmpdir(), 'solo-crm-picker-files-'))
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

/** A promise plus its resolver, so a test can hold a fake dialog open for exactly as long as it needs to observe what a second, overlapping call does. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** The one window every test opens the picker over. A plain object: `BrandingPickerWindow` is opaque by design — nothing in `picker.ts` reads a property of it. */
const WINDOW: BrandingPickerWindow = { id: 'test-window' }

function windowSource(window: BrandingPickerWindow | null = WINDOW): BrandingWindowSource {
  return { getFocusedWindow: () => window }
}

interface FakeDialog extends BrandingDialog {
  /** Every options object `showOpenDialog` was called with, in order — so the filter list and the properties are asserted rather than assumed. */
  readonly calls: Array<Parameters<BrandingDialog['showOpenDialog']>[1]>
  /** The window each call was made modal to. */
  readonly windows: BrandingPickerWindow[]
}

function fakeDialog(result: { canceled: boolean; filePaths: string[] } | (() => Promise<{ canceled: boolean; filePaths: string[] }>)): FakeDialog {
  const calls: Array<Parameters<BrandingDialog['showOpenDialog']>[1]> = []
  const windows: BrandingPickerWindow[] = []
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

describe('chooseBrandingImage — the ordinary case', () => {
  it('stores the chosen file and answers with a data: URL, not a path', async () => {
    const db = openTmpDb()
    const path = fixtureFile('logo.png', REAL_PNG)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    const choice = await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    expect(choice.outcome).toBe('chosen')
    if (choice.outcome !== 'chosen') return
    expect(choice.state).toEqual({
      state: 'present',
      slot: 'logo',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(REAL_PNG).toString('base64')}`,
      byteLength: REAL_PNG.length,
      updatedAt: expect.any(String)
    })

    // The bytes actually landed in the table, and are the file's own bytes.
    const stored = readBrandingSlot(db, 'logo')
    // `.equals` rather than `toEqual`: better-sqlite3 hands a blob back as a
    // Buffer, which is a Uint8Array with a different constructor — comparing
    // the contents is the fact worth asserting.
    expect(Buffer.from(stored?.bytes ?? []).equals(Buffer.from(REAL_PNG))).toBe(true)
    expect(stored?.contentType).toBe('image/png')
  })

  it('opens the picker as a single-file open dialog over the focused window', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('icon.png', REAL_PNG)] })

    await chooseBrandingImage(db, 'icon', { dialog, windows: windowSource() })

    expect(dialog.calls).toHaveLength(1)
    expect(dialog.calls[0].properties).toEqual(['openFile'])
    expect(dialog.windows[0]).toBe(WINDOW)
  })

  it('does not list svg among the offered extensions — an operator who saw it there would believe it is accepted', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('icon.png', REAL_PNG)] })

    await chooseBrandingImage(db, 'icon', { dialog, windows: windowSource() })

    const extensions = (dialog.calls[0].filters ?? []).flatMap((filter) => filter.extensions)
    expect(extensions).not.toContain('svg')
    expect(extensions).toEqual([...IMAGE_FILTER_EXTENSIONS])
    expect(IMAGE_FILTER_EXTENSIONS).not.toContain('svg')
  })
})

describe('chooseBrandingImage — a cancelled picker is a success', () => {
  it('answers { outcome: cancelled } and leaves an empty slot empty', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: true, filePaths: [] })

    const before = getBrandingSnapshot(db)
    const choice = await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    expect(choice).toEqual({ outcome: 'cancelled' })
    expect(getBrandingSnapshot(db)).toEqual(before)
    expect(readBrandingSlot(db, 'logo')).toBeNull()
  })

  it('leaves an already-stored image byte-identical', async () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'logo', REAL_PNG)
    const before = readBrandingSlot(db, 'logo')
    const dialog = fakeDialog({ canceled: true, filePaths: [] })

    const choice = await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    expect(choice).toEqual({ outcome: 'cancelled' })
    expect(readBrandingSlot(db, 'logo')).toEqual(before)
  })

  it('treats an empty selection with canceled: false as a cancellation rather than reading nothing', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: false, filePaths: [] })

    await expect(chooseBrandingImage(db, 'icon', { dialog, windows: windowSource() })).resolves.toEqual({
      outcome: 'cancelled'
    })
    expect(readBrandingSlot(db, 'icon')).toBeNull()
  })
})

describe('chooseBrandingImage — what the bytes are is decided by the bytes', () => {
  it('refuses an SVG document chosen through the dialog and stores nothing', async () => {
    const db = openTmpDb()
    // Named `.png` on purpose: the extension filter is a courtesy, and this
    // proves it is not what decides.
    const path = fixtureFile('brand.png', SVG_DOCUMENT)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    await expect(chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })).rejects.toThrow(ValidationError)
    expect(readBrandingSlot(db, 'logo')).toBeNull()
  })

  it('refuses a file that does not exist without leaking the path it was asked for', async () => {
    const db = openTmpDb()
    const missing = join(tmpdir(), 'solo-crm-picker-missing', 'nothing-here.png')
    const dialog = fakeDialog({ canceled: false, filePaths: [missing] })

    const error = await chooseBrandingImage(db, 'icon', { dialog, windows: windowSource() }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    // Node's own ENOENT message embeds the absolute path; this must not be
    // that message.
    expect((error as Error).message).not.toContain(missing)
    expect(pathLikeStrings((error as Error).message)).toEqual([])
  })
})

describe('chooseBrandingImage — the cap is applied before the read', () => {
  it('refuses an oversized file, names the cap, and never reads the file', async () => {
    const db = openTmpDb()
    const oversized = new Uint8Array(BRANDING_MAX_BYTES + 1)
    oversized.set(REAL_PNG, 0)
    const path = fixtureFile('huge.png', oversized)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    // The seam that makes "never read" observable: the reader is injected and
    // records every path it was handed. The stat is the real one, against the
    // real oversized file on disk.
    const readCalls: string[] = []
    const recordingReadFile = async (target: string): Promise<Uint8Array> => {
      readCalls.push(target)
      return new Uint8Array(await readFile(target))
    }

    const error = await chooseBrandingImage(db, 'logo', {
      dialog,
      windows: windowSource(),
      readFile: recordingReadFile
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(readCalls).toEqual([])
    expect((error as Error).message).toContain(String(BRANDING_MAX_BYTES))
    expect(pathLikeStrings((error as Error).message)).toEqual([])
    expect(readBrandingSlot(db, 'logo')).toBeNull()
  })

  it('reads a file that is within the cap — the same seam, proving the refusal above is the cap and not the injection', async () => {
    const db = openTmpDb()
    const path = fixtureFile('small.png', REAL_PNG)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    const readCalls: string[] = []
    const choice = await chooseBrandingImage(db, 'logo', {
      dialog,
      windows: windowSource(),
      readFile: async (target: string) => {
        readCalls.push(target)
        return new Uint8Array(await readFile(target))
      }
    })

    expect(choice.outcome).toBe('chosen')
    expect(readCalls).toEqual([path])
  })

  it('refuses before the read using the size on disk, not a size the caller declared', async () => {
    const db = openTmpDb()
    const path = fixtureFile('small.png', REAL_PNG)
    const dialog = fakeDialog({ canceled: false, filePaths: [path] })

    // A stat that reports a 2 GB file for a file that is 70 bytes: the
    // refusal has to come from the stat, before any allocation, which is the
    // whole ordering this test pins.
    const readCalls: string[] = []
    const error = await chooseBrandingImage(db, 'logo', {
      dialog,
      windows: windowSource(),
      stat: async () => ({ size: 2 * 1024 * 1024 * 1024 }),
      readFile: async (target: string) => {
        readCalls.push(target)
        return new Uint8Array(await readFile(target))
      }
    }).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ValidationError)
    expect(readCalls).toEqual([])
  })
})

describe('chooseBrandingImage — the two guards on the native dialog', () => {
  it('refuses when no window has focus, and opens no dialog at all', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('icon.png', REAL_PNG)] })

    const error = await chooseBrandingImage(db, 'icon', { dialog, windows: windowSource(null) }).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ValidationError)
    expect(dialog.calls).toEqual([])
    expect(readBrandingSlot(db, 'icon')).toBeNull()
  })

  it('opens one dialog for two overlapping calls — the second resolves as cancelled', async () => {
    const db = openTmpDb()
    const path = fixtureFile('logo.png', REAL_PNG)

    const open = deferred()
    const dialog = fakeDialog(async () => {
      await open.promise
      return { canceled: false, filePaths: [path] }
    })

    const first = chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })
    const second = chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    // Resolves without the dialog having closed: the guard answered it.
    await expect(second).resolves.toEqual({ outcome: 'cancelled' })
    expect(dialog.calls).toHaveLength(1)

    open.resolve()
    const firstChoice = await first
    expect(firstChoice.outcome).toBe('chosen')
    expect(dialog.calls).toHaveLength(1)
  })

  it('releases the guard once the picker closes, so the next call opens a dialog again', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: true, filePaths: [] })

    await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })
    await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    expect(dialog.calls).toHaveLength(2)
  })

  it('guards per window — a second window may open its own picker', async () => {
    const db = openTmpDb()
    const other: BrandingPickerWindow = { id: 'other-window' }
    const path = fixtureFile('logo.png', REAL_PNG)

    const open = deferred()
    const dialog = fakeDialog(async () => {
      await open.promise
      return { canceled: false, filePaths: [path] }
    })

    const first = chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })
    const fromOther = chooseBrandingImage(db, 'icon', { dialog, windows: windowSource(other) })

    open.resolve()
    await Promise.all([first, fromOther])
    expect(dialog.calls).toHaveLength(2)
    expect(dialog.windows).toEqual([WINDOW, other])
  })
})

describe('no filesystem path crosses back to the renderer', () => {
  it('the chosen response contains no path separator anywhere in it', async () => {
    const db = openTmpDb()
    const path = fixtureFile('logo.png', REAL_PNG)
    // The premise of the assertion: the path the dialog returned really does
    // look like a path, so finding none in the response means something.
    expect(path).toContain(sep)

    const dialog = fakeDialog({ canceled: false, filePaths: [path] })
    const choice = await chooseBrandingImage(db, 'logo', { dialog, windows: windowSource() })

    expect(pathLikeStrings(choice)).toEqual([])
  })

  it('the snapshot read after a pick contains no path separator either', async () => {
    const db = openTmpDb()
    const dialog = fakeDialog({ canceled: false, filePaths: [fixtureFile('icon.png', REAL_PNG)] })
    await chooseBrandingImage(db, 'icon', { dialog, windows: windowSource() })

    const snapshot = getBrandingSnapshot(db)
    expect(snapshot.icon.state).toBe('present')
    expect(pathLikeStrings(snapshot)).toEqual([])
  })

  it('pathLikeStrings would catch a path if one were there', () => {
    // Guards the guard: a walker that always returned [] would make every
    // assertion above pass silently.
    expect(
      pathLikeStrings({
        outcome: 'chosen',
        state: { dataUrl: 'data:image/png;base64,AA/BB', contentType: 'image/png', from: join('a', 'b') }
      })
    ).toEqual([`state.from: ${join('a', 'b')}`])
    // A string that merely starts like a data: URL is not exempt.
    expect(pathLikeStrings({ dataUrl: 'data:image/png;base64,AA C:\\Users\\someone\\logo.png' })).toHaveLength(1)
  })
})

describe('getBrandingSnapshot', () => {
  it('answers absent for both slots on a fresh database — absence is the default, not an error', () => {
    const db = openTmpDb()
    expect(getBrandingSnapshot(db)).toEqual({
      icon: { state: 'absent', slot: 'icon' },
      logo: { state: 'absent', slot: 'logo' }
    })
  })

  it('builds each present slot as a data: URL of the stored bytes', () => {
    const db = openTmpDb()
    writeBrandingSlot(db, 'icon', REAL_PNG)

    const snapshot = getBrandingSnapshot(db)
    expect(snapshot.logo).toEqual({ state: 'absent', slot: 'logo' })
    expect(snapshot.icon).toMatchObject({
      state: 'present',
      slot: 'icon',
      contentType: 'image/png',
      dataUrl: `data:image/png;base64,${Buffer.from(REAL_PNG).toString('base64')}`,
      byteLength: REAL_PNG.length
    })
  })
})
