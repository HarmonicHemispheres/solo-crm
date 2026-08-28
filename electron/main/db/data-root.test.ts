import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DATA_ROOT_POINTER_FILENAME, DataRootPointerError, resolveDataRoot, writeDataRootPointer } from './data-root'

/**
 * Every test below passes an explicit `userDataDir` — this module's own
 * `DataRootOptions.userDataDir` override, mirroring `connection.test.ts`'s
 * discipline for `OpenDatabaseOptions.userDataDir` (T-260828-05's Risks
 * note): no test relies on the real `app.getPath('userData')`.
 *
 * `node:fs` is mocked wholesale (`vi.mock` below), with every export left as
 * the real implementation except `renameSync`, wrapped in a `vi.fn` that
 * still calls through by default. Node's built-in ESM modules are frozen —
 * `vi.spyOn` on a live `node:fs` import throws "Module namespace is not
 * configurable" — so replacing the whole module is the only way to make one
 * call fail on demand, which the atomic-write tests below need.
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, renameSync: vi.fn(actual.renameSync) }
})

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const cleanupDirs: string[] = []

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  vi.restoreAllMocks()
})

function trackedTmpDir(prefix: string): string {
  const dir = makeTmpDir(prefix)
  cleanupDirs.push(dir)
  return dir
}

describe('resolveDataRoot with no pointer file', () => {
  it('returns userDataDir unchanged — the default, byte-for-byte today\'s behaviour', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-default-')
    expect(resolveDataRoot({ userDataDir })).toBe(userDataDir)
    // No pointer file was created as a side effect of resolving.
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })
})

describe('resolveDataRoot with a pointer naming an existing directory', () => {
  it('returns the pointed-at directory rather than userDataDir', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const dataRoot = trackedTmpDir('solo-crm-dataroot-target-')
    writeFileSync(
      join(userDataDir, DATA_ROOT_POINTER_FILENAME),
      JSON.stringify({ dataRoot }),
      'utf-8'
    )

    expect(resolveDataRoot({ userDataDir })).toBe(dataRoot)
  })
})

describe('resolveDataRoot with a pointer naming a missing directory', () => {
  it('creates the named directory when its parent exists', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const parent = trackedTmpDir('solo-crm-dataroot-parent-')
    const dataRoot = join(parent, 'newfolder')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot }), 'utf-8')

    expect(existsSync(dataRoot)).toBe(false)
    expect(resolveDataRoot({ userDataDir })).toBe(dataRoot)
    expect(existsSync(dataRoot)).toBe(true)
  })

  it('throws, distinguishing the missing-parent case, when the parent does not exist', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const parent = trackedTmpDir('solo-crm-dataroot-parent-')
    rmSync(parent, { recursive: true, force: true }) // parent itself now missing
    const dataRoot = join(parent, 'newfolder')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot }), 'utf-8')

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
    try {
      resolveDataRoot({ userDataDir })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(DataRootPointerError)
      expect((error as DataRootPointerError).message).toContain(parent)
    }
    expect(existsSync(dataRoot)).toBe(false)
  })
})

describe('resolveDataRoot with a pointer that cannot be trusted', () => {
  it('throws on malformed JSON, naming the pointer file, and creates no directory', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)
    writeFileSync(pointerPath, '{ this is not json', 'utf-8')

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
    try {
      resolveDataRoot({ userDataDir })
      expect.unreachable()
    } catch (error) {
      expect((error as DataRootPointerError).message).toContain(pointerPath)
    }
  })

  it('throws when the dataRoot key is missing', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({}), 'utf-8')

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
  })

  it('throws when dataRoot is an empty string', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot: '' }), 'utf-8')

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
  })

  it('throws when dataRoot is a relative path', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    writeFileSync(
      join(userDataDir, DATA_ROOT_POINTER_FILENAME),
      JSON.stringify({ dataRoot: `relative${sep}path` }),
      'utf-8'
    )

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
  })

  it('throws when dataRoot is the wrong type', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot: 12345 }), 'utf-8')

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
  })

  it('throws on an unknown extra key rather than silently ignoring it', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const dataRoot = trackedTmpDir('solo-crm-dataroot-target-')
    writeFileSync(
      join(userDataDir, DATA_ROOT_POINTER_FILENAME),
      JSON.stringify({ dataRoot, extra: 'surprise' }),
      'utf-8'
    )

    expect(() => resolveDataRoot({ userDataDir })).toThrow(DataRootPointerError)
  })

  it('every failure names data-location.json and mentions deleting it restores the default', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), 'not json', 'utf-8')

    try {
      resolveDataRoot({ userDataDir })
      expect.unreachable()
    } catch (error) {
      const message = (error as DataRootPointerError).message
      expect(message).toContain(DATA_ROOT_POINTER_FILENAME)
      expect(message.toLowerCase()).toContain('delete')
      expect(message.toLowerCase()).toContain('default')
    }
  })
})

describe('writeDataRootPointer', () => {
  it('writes a pointer resolveDataRoot then reads back to the same directory', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const dataRoot = trackedTmpDir('solo-crm-dataroot-target-')

    writeDataRootPointer(dataRoot, { userDataDir })

    expect(resolveDataRoot({ userDataDir })).toBe(dataRoot)
  })

  it('writes valid JSON matching the documented shape, with no leftover temp file', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const dataRoot = trackedTmpDir('solo-crm-dataroot-target-')

    writeDataRootPointer(dataRoot, { userDataDir })

    const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)
    const parsed = JSON.parse(readFileSync(pointerPath, 'utf-8'))
    expect(parsed).toEqual({ dataRoot })

    const leftovers = readdirSync(userDataDir).filter((name) => name !== DATA_ROOT_POINTER_FILENAME)
    expect(leftovers).toEqual([])
  })

  it('overwrites a previous pointer', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const firstRoot = trackedTmpDir('solo-crm-dataroot-first-')
    const secondRoot = trackedTmpDir('solo-crm-dataroot-second-')

    writeDataRootPointer(firstRoot, { userDataDir })
    expect(resolveDataRoot({ userDataDir })).toBe(firstRoot)

    writeDataRootPointer(secondRoot, { userDataDir })
    expect(resolveDataRoot({ userDataDir })).toBe(secondRoot)
  })

  it('leaves the previous pointer completely untouched if the rename step fails partway', async () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const originalRoot = trackedTmpDir('solo-crm-dataroot-original-')
    const attemptedRoot = trackedTmpDir('solo-crm-dataroot-attempted-')

    writeDataRootPointer(originalRoot, { userDataDir })
    const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)
    const beforeContents = readFileSync(pointerPath, 'utf-8')

    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('simulated crash between write and rename')
    })

    expect(() => writeDataRootPointer(attemptedRoot, { userDataDir })).toThrow(
      'simulated crash between write and rename'
    )

    // The real pointer file is exactly what it was before the failed write —
    // never a partial or half-written file — so it still resolves to the
    // original root, not the attempted one.
    expect(readFileSync(pointerPath, 'utf-8')).toBe(beforeContents)
    expect(resolveDataRoot({ userDataDir })).toBe(originalRoot)
  })

  it('creates no pointer file at all if the rename step fails on a first-ever write', () => {
    const userDataDir = trackedTmpDir('solo-crm-dataroot-userdata-')
    const dataRoot = trackedTmpDir('solo-crm-dataroot-target-')
    const pointerPath = join(userDataDir, DATA_ROOT_POINTER_FILENAME)

    vi.mocked(renameSync).mockImplementationOnce(() => {
      throw new Error('simulated crash before rename')
    })

    expect(() => writeDataRootPointer(dataRoot, { userDataDir })).toThrow()

    expect(existsSync(pointerPath)).toBe(false)
    // No pointer file present still means: resolve to the default.
    expect(resolveDataRoot({ userDataDir })).toBe(userDataDir)
  })
})
