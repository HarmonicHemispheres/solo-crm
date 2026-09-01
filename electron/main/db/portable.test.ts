import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveDatabasePath } from './connection'
import { DATA_ROOT_POINTER_FILENAME, DataRootPointerError, resolveDataRoot, writeDataRootPointer } from './data-root'
import { moveDataRoot } from './move-data-root'
import {
  isPortableLaunch,
  isSameOrInside,
  observePortableLaunch,
  PORTABLE_EXECUTABLE_DIR_ENV,
  PortableDataRootError,
  PortableDataRootPointerError,
  portableDataRoot,
  type PortableLaunchProbe
} from './portable'
import { SYNC_FOLDER_GUARD_OVERRIDE_ENV, SyncFolderGuardError } from './sync-folder-guard'

/**
 * T-260831-03 / ADR-013. The portable build's data root, tested without a
 * packaged build and without a real NSIS launch — every case goes through
 * `DataRootOptions.portableLaunch`, the test-only injection point that
 * mirrors `userDataDir` exactly (production calls `observePortableLaunch()`
 * and uses what the process actually reports).
 *
 * `data-root.test.ts` is deliberately untouched by this task and everything
 * new lives here instead. That file passing unmodified is T-260831-03's first
 * acceptance criterion and the proof the installed build's resolution did not
 * change; splitting the new cases out keeps that proof a `git diff` away
 * rather than an argument about which assertions moved.
 *
 * **The case this file exists for** is `refuses a root equal to, or inside,
 * the extraction directory` below. `portable.nsi` runs `RMDir /r $INSTDIR`
 * *after* the app exits, so a database written there is destroyed on close
 * with no error at any point: the app launches, works, and loses everything.
 * If that refusal is ever removed, those tests fail loudly.
 */

const cleanupDirs: string[] = []

afterEach(() => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
  vi.unstubAllEnvs()
})

function trackedTmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

/**
 * A real portable launch, as directories that actually exist on disk so the
 * `realpath` half of the containment check has something to resolve.
 *
 * `tempDir` is a throwaway directory standing in for `os.tmpdir()` rather
 * than the real one — which is what lets `stick` be a genuinely *outside*
 * location while still being a temp directory this suite can clean up. The
 * shape mirrors the artifact: `extractionDir` sits inside `tempDir` (NSIS
 * unpacks into `$PLUGINSDIR\app` under `%TEMP%`), and `stick` is the folder
 * the operator's `.exe` is actually sitting in.
 */
interface PortableFixture {
  readonly tempDir: string
  readonly extractionDir: string
  readonly stick: string
  /** A portable probe whose `PORTABLE_EXECUTABLE_DIR` is `dir`, or unset when omitted. */
  readonly probeFor: (dir?: string) => PortableLaunchProbe
}

function portableFixture(): PortableFixture {
  const tempDir = trackedTmpDir('solo-crm-portable-temp-')
  const extractionDir = join(tempDir, 'app')
  mkdirSync(extractionDir)
  const stick = trackedTmpDir('solo-crm-portable-stick-')

  return {
    tempDir,
    extractionDir,
    stick,
    probeFor: (dir?: string): PortableLaunchProbe => ({
      isPackaged: true,
      executableDir: extractionDir,
      tempDir,
      env: dir === undefined ? {} : { [PORTABLE_EXECUTABLE_DIR_ENV]: dir }
    })
  }
}

/** A launch that is not portable: packaged, but running from a real install directory. */
function installedProbe(): PortableLaunchProbe {
  const programs = trackedTmpDir('solo-crm-installed-')
  return {
    isPackaged: true,
    executableDir: programs,
    tempDir: join(programs, 'not-the-temp-dir'),
    env: {}
  }
}

describe('isSameOrInside — the containment check both refusals rest on', () => {
  it('is true for the container itself, and for anything beneath it', () => {
    const container = trackedTmpDir('solo-crm-contain-')
    const child = join(container, 'child')
    mkdirSync(child)
    const grandchild = join(child, 'deeper')
    mkdirSync(grandchild)

    expect(isSameOrInside(container, container)).toBe(true)
    expect(isSameOrInside(container, child)).toBe(true)
    expect(isSameOrInside(container, grandchild)).toBe(true)
  })

  it('is false for a parent, and for an unrelated sibling', () => {
    const container = trackedTmpDir('solo-crm-contain-')
    const child = join(container, 'child')
    mkdirSync(child)
    const sibling = trackedTmpDir('solo-crm-elsewhere-')

    expect(isSameOrInside(child, container)).toBe(false)
    expect(isSameOrInside(container, sibling)).toBe(false)
  })

  it('matches whole segments, so a sibling whose name merely starts with the container does not match', () => {
    // The `startsWith` bug in its most dangerous direction: `C:\Temp2` is not
    // inside `C:\Temp`, so a data root there must NOT be refused... and
    // `C:\Temp2\x` is not inside the extraction directory either, so it must
    // not be silently treated as one.
    const parent = trackedTmpDir('solo-crm-segments-')
    const container = join(parent, 'Temp')
    const lookalike = join(parent, 'Temp2')
    mkdirSync(container)
    mkdirSync(lookalike)

    expect(isSameOrInside(container, lookalike)).toBe(false)
    expect(isSameOrInside(container, join(lookalike, 'data'))).toBe(false)
  })

  it('ignores case and accepts either separator', () => {
    const container = trackedTmpDir('solo-crm-case-')
    const child = join(container, 'Data')
    mkdirSync(child)

    expect(isSameOrInside(container.toUpperCase(), child.toLowerCase())).toBe(true)
    expect(isSameOrInside(container, child.split('\\').join('/'))).toBe(true)
  })

  it('normalises a trailing separator and a `..` hop rather than comparing raw strings', () => {
    const container = trackedTmpDir('solo-crm-normalise-')
    const child = join(container, 'child')
    mkdirSync(child)

    expect(isSameOrInside(`${container}${'\\'}`, child)).toBe(true)
    expect(isSameOrInside(join(container, '..', basename(container)), child)).toBe(true)
    expect(isSameOrInside(container, join(child, '..', 'child'))).toBe(true)
  })

  it('resolves symlinks, so a link into the container is still inside it', () => {
    // The case a raw `startsWith` misses entirely, and the reason ADR-013
    // asks for `realpath` here: an 8.3 or symlinked `%TEMP%` reaches the
    // check under a name that shares no prefix with the container at all.
    const container = trackedTmpDir('solo-crm-symlink-target-')
    const real = join(container, 'real')
    mkdirSync(real)
    const linkHome = trackedTmpDir('solo-crm-symlink-home-')
    const link = join(linkHome, 'link')
    symlinkSync(real, link, 'junction')

    expect(isSameOrInside(container, link)).toBe(true)
    // And the link's own unresolved location is genuinely elsewhere, so this
    // is not passing for the trivial reason.
    expect(isSameOrInside(container, linkHome)).toBe(false)
  })
})

describe('isPortableLaunch — ADR-013 Decision 2, the marker is where the process runs from', () => {
  it('is true only when the build is packaged AND runs from inside the temporary directory', () => {
    const { probeFor, extractionDir, tempDir } = portableFixture()

    expect(isPortableLaunch(probeFor())).toBe(true)
    expect(isPortableLaunch({ ...probeFor(), isPackaged: false })).toBe(false)
    expect(isPortableLaunch({ ...probeFor(), executableDir: dirname(tempDir) })).toBe(false)
    // Deeper inside the temporary directory still counts — `$PLUGINSDIR\app`
    // is a level below `%TEMP%` and `$TEMP\<ksuid>` is another shape again.
    expect(isPortableLaunch({ ...probeFor(), executableDir: join(extractionDir, 'resources') })).toBe(true)
  })

  it('is false for an installed build, which is why nothing about the installed path changes', () => {
    expect(isPortableLaunch(installedProbe())).toBe(false)
  })

  it('is false for a directory whose name merely begins with the temporary directory’s', () => {
    const parent = trackedTmpDir('solo-crm-marker-segments-')
    const tempDir = join(parent, 'Temp')
    const lookalike = join(parent, 'Temporary')
    mkdirSync(tempDir)
    mkdirSync(lookalike)

    expect(isPortableLaunch({ isPackaged: true, executableDir: lookalike, tempDir, env: {} })).toBe(false)
  })

  it('the environment variable alone never makes a launch portable', () => {
    // ADR-013 Decision 2's ordering, as a test: a user who sets
    // PORTABLE_EXECUTABLE_DIR in a shell, a shortcut or the registry gets
    // nothing — which is what keeps this from being the general-purpose data
    // root override ADR-006 refused.
    const installed = installedProbe()
    const chosen = trackedTmpDir('solo-crm-wishful-')

    const wishful: PortableLaunchProbe = { ...installed, env: { [PORTABLE_EXECUTABLE_DIR_ENV]: chosen } }

    expect(isPortableLaunch(wishful)).toBe(false)
    // And so the installed build resolves to its own userData, not to the
    // folder the variable named.
    expect(resolveDataRoot({ userDataDir: installed.executableDir, portableLaunch: wishful })).toBe(
      installed.executableDir
    )
  })
})

describe('observePortableLaunch — what the real process reports', () => {
  it('reports a non-portable launch outside a packaged Electron app, so the default path is unchanged', () => {
    const probe = observePortableLaunch()

    expect(probe.isPackaged).toBe(false)
    expect(isPortableLaunch(probe)).toBe(false)
    expect(probe.tempDir).toBe(tmpdir())
    expect(probe.env).toBe(process.env)
  })
})

describe('portableDataRoot — ADR-013 Decision 3, the root is where the artifact sits', () => {
  it('returns the launcher-supplied directory unchanged, with no subfolder', () => {
    const { probeFor, stick } = portableFixture()

    expect(portableDataRoot(probeFor(stick))).toBe(stick)
  })

  it('resolveDataRoot returns it, and resolveDatabasePath puts solocrm.db directly beside the exe', () => {
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    expect(resolveDataRoot({ userDataDir, portableLaunch: probeFor(stick) })).toBe(stick)
    expect(resolveDatabasePath({ userDataDir, portableLaunch: probeFor(stick) })).toBe(join(stick, 'solocrm.db'))
  })
})

describe('portableDataRoot — ADR-013 Decision 4, a root it cannot trust is refused', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['whitespace only', '   ']
  ])('refuses when the launcher directory is %s', (_label, value) => {
    const { probeFor } = portableFixture()

    const thrown = captureThrow(() => portableDataRoot(probeFor(value)))
    expect(thrown).toBeInstanceOf(PortableDataRootError)
    expect((thrown as PortableDataRootError).refusal).toBe('no-launcher-directory')
    expect((thrown as PortableDataRootError).message).toContain(PORTABLE_EXECUTABLE_DIR_ENV)
  })

  it('refuses a relative directory, naming it', () => {
    const { probeFor } = portableFixture()

    const thrown = captureThrow(() => portableDataRoot(probeFor(join('relative', 'path'))))
    expect(thrown).toBeInstanceOf(PortableDataRootError)
    expect((thrown as PortableDataRootError).refusal).toBe('not-absolute')
    expect((thrown as PortableDataRootError).message).toContain(join('relative', 'path'))
  })

  /**
   * The single most important behaviour in this task. `portable.nsi:90` runs
   * `RMDir /r $INSTDIR` after the app exits, so a database in the extraction
   * directory is destroyed on close with no error anywhere. Every wrong
   * version of this still launches and still shows a working app. If these
   * assertions ever start failing, the refusal has been removed and the
   * portable build silently loses the operator's entire database on quit.
   */
  it('refuses a root equal to, or inside, the extraction directory — the silent-total-loss case', () => {
    const { probeFor, extractionDir } = portableFixture()
    const inside = join(extractionDir, 'resources')
    mkdirSync(inside)

    for (const candidate of [extractionDir, inside]) {
      const thrown = captureThrow(() => portableDataRoot(probeFor(candidate)))
      expect(thrown).toBeInstanceOf(PortableDataRootError)
      expect((thrown as PortableDataRootError).refusal).toBe('extraction-directory')

      const message = (thrown as PortableDataRootError).message
      expect(message).toContain(candidate)
      expect(message).toContain(extractionDir)
      // The dialog has to say what is actually at stake — data destroyed when
      // the app closes — not merely "invalid location".
      expect(message.toLowerCase()).toContain('deleted when solo crm closes')
      expect(message.toLowerCase()).toContain('destroyed')
    }
  })

  it('refuses a root elsewhere under the temporary directory, which is not durable storage', () => {
    const { probeFor, tempDir } = portableFixture()
    const elsewhereInTemp = join(tempDir, 'somewhere-else')
    mkdirSync(elsewhereInTemp)

    const thrown = captureThrow(() => portableDataRoot(probeFor(elsewhereInTemp)))
    expect(thrown).toBeInstanceOf(PortableDataRootError)
    expect((thrown as PortableDataRootError).refusal).toBe('temporary-directory')
    expect((thrown as PortableDataRootError).message).toContain(elsewhereInTemp)
  })

  it('never falls back to userData or to the executable’s own directory', () => {
    // ADR-013 Decision 4 names both tempting fallbacks and refuses each. This
    // asserts the refusal reaches `resolveDataRoot`'s caller as a throw
    // rather than as a plausible-looking directory.
    const { probeFor, extractionDir } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    const thrown = captureThrow(() => resolveDataRoot({ userDataDir, portableLaunch: probeFor() }))
    expect(thrown).toBeInstanceOf(PortableDataRootError)
    expect((thrown as Error).message).not.toContain(userDataDir)
    expect((thrown as Error).message).not.toContain(join(extractionDir, 'solocrm.db'))
  })
})

describe('resolveDataRoot in portable mode — ADR-013 Decision 6, the pointer file is not read', () => {
  it('ignores a pointer file naming somewhere else', () => {
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')
    const elsewhere = trackedTmpDir('solo-crm-installed-root-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), JSON.stringify({ dataRoot: elsewhere }), 'utf-8')

    expect(resolveDataRoot({ userDataDir, portableLaunch: probeFor(stick) })).toBe(stick)
  })

  it('does not read the pointer file at all — an unparseable one is not even an error', () => {
    // "Not read at all", not "read and ignored if invalid": a portable copy
    // must not be stopped by the state of the *host machine's* pointer file,
    // and a host that has one is the ordinary case (any installed Solo CRM
    // shares `%APPDATA%\Solo CRM` with it).
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')
    writeFileSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME), '{ not json at all', 'utf-8')

    expect(resolveDataRoot({ userDataDir, portableLaunch: probeFor(stick) })).toBe(stick)
    // The same pointer stops a non-portable launch dead, which is what makes
    // the assertion above meaningful rather than vacuous.
    expect(() => resolveDataRoot({ userDataDir, portableLaunch: installedProbe() })).toThrow(DataRootPointerError)
  })

  it('writes nothing into the host machine’s userData folder', () => {
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    expect(resolveDataRoot({ userDataDir, portableLaunch: probeFor(stick) })).toBe(stick)
    expect(readdirSync(userDataDir)).toEqual([])
    expect(existsSync(join(userDataDir, DATA_ROOT_POINTER_FILENAME))).toBe(false)
  })
})

describe('writeDataRootPointer in portable mode — never written', () => {
  it('refuses, and leaves the host machine’s userData folder untouched', () => {
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    expect(() => writeDataRootPointer(stick, { userDataDir, portableLaunch: probeFor(stick) })).toThrow(
      PortableDataRootPointerError
    )
    expect(readdirSync(userDataDir)).toEqual([])
  })

  it('does not repoint an installed copy that already has a pointer', () => {
    // The cross-contamination case in the direction that costs someone else
    // their data: the pointer's fixed home is the host's `%APPDATA%`, shared
    // with any installed Solo CRM, so a portable run that wrote there would
    // move the *installed* app's data root on its next launch.
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')
    const installedRoot = trackedTmpDir('solo-crm-installed-root-')
    writeDataRootPointer(installedRoot, { userDataDir, portableLaunch: installedProbe() })

    expect(() => writeDataRootPointer(stick, { userDataDir, portableLaunch: probeFor(stick) })).toThrow(
      PortableDataRootPointerError
    )
    expect(resolveDataRoot({ userDataDir, portableLaunch: installedProbe() })).toBe(installedRoot)
  })
})

describe('moveDataRoot in portable mode — no relocatable root to move', () => {
  it('refuses before anything is closed or copied', () => {
    const { probeFor, stick } = portableFixture()
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')
    const target = trackedTmpDir('solo-crm-portable-move-target-')

    const result = moveDataRoot(target, { userDataDir, portableLaunch: probeFor(stick) })

    expect(result.kind).toBe('refused')
    expect(result).toMatchObject({ code: 'portable', dataRoot: stick })
    expect(readdirSync(target)).toEqual([])
    expect(readdirSync(userDataDir)).toEqual([])
  })
})

describe('the sync-folder guard applies to the portable root — ADR-013 Decision 5', () => {
  it('refuses a portable root inside a OneDrive folder, and names moving the .exe as the fix', () => {
    const { probeFor } = portableFixture()
    const syncedStick = join(trackedTmpDir('solo-crm-portable-synced-'), 'OneDrive', 'Apps')
    mkdirSync(syncedStick, { recursive: true })
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    const thrown = captureThrow(() => resolveDatabasePath({ userDataDir, portableLaunch: probeFor(syncedStick) }))

    expect(thrown).toBeInstanceOf(SyncFolderGuardError)
    const message = (thrown as SyncFolderGuardError).message
    expect(message).toContain('OneDrive')
    expect(message).toContain(join(syncedStick, 'solocrm.db'))
    // The installed build's implicit advice ("choose another folder") is
    // useless here — a portable operator has no chooser.
    expect(message).toContain('.exe')
    expect(message).not.toContain("Move Solo CRM's data out of the synced folder")
    // The one documented override is still named, and is still the only one.
    expect(message).toContain(SYNC_FOLDER_GUARD_OVERRIDE_ENV)
  })

  it('leaves the installed build’s refusal message exactly as it was', () => {
    const syncedUserDataDir = join(trackedTmpDir('solo-crm-installed-synced-'), 'Dropbox')
    mkdirSync(syncedUserDataDir)

    const thrown = captureThrow(() =>
      resolveDatabasePath({ userDataDir: syncedUserDataDir, portableLaunch: installedProbe() })
    )

    expect(thrown).toBeInstanceOf(SyncFolderGuardError)
    const message = (thrown as SyncFolderGuardError).message
    expect(message).toContain("Move Solo CRM's data out of the synced folder and restart the app.")
    expect(message).not.toContain('.exe')
  })

  it('is still overridden by SOLOCRM_ALLOW_SYNC_FOLDER_DB=1, and by nothing else', () => {
    const { probeFor } = portableFixture()
    const syncedStick = join(trackedTmpDir('solo-crm-portable-synced-'), 'Dropbox')
    mkdirSync(syncedStick)
    const userDataDir = trackedTmpDir('solo-crm-portable-userdata-')

    vi.stubEnv(SYNC_FOLDER_GUARD_OVERRIDE_ENV, '1')
    expect(resolveDatabasePath({ userDataDir, portableLaunch: probeFor(syncedStick) })).toBe(
      join(syncedStick, 'solocrm.db')
    )

    vi.stubEnv(SYNC_FOLDER_GUARD_OVERRIDE_ENV, 'true')
    expect(() => resolveDatabasePath({ userDataDir, portableLaunch: probeFor(syncedStick) })).toThrow(
      SyncFolderGuardError
    )
  })
})

/** `expect(() => …).toThrow()` proves *that* it threw; this keeps the value to assert about. */
function captureThrow(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  expect.unreachable('expected the call to throw')
}
