import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import {
  isPortableLaunch,
  observePortableLaunch,
  portableDataRoot,
  PortableDataRootPointerError,
  type PortableLaunchProbe
} from './portable'

/**
 * Resolves the **data root** — the folder holding `solocrm.db` and its
 * `-wal`/`-shm` sidecars — from an optional pointer file, per ADR-006.
 * Nothing broader lives here: X-04's backup-folder setting is a separate
 * value (a `settings` row, once P2-01 exists) and is deliberately allowed to
 * be a sync folder, unlike this one.
 *
 * The pointer's own location is fixed and never itself configurable —
 * `app.getPath('userData')/data-location.json` — because a configurable
 * pointer-to-the-pointer just moves the chicken-and-egg problem this file
 * exists to solve up one level (ADR-006's Alternatives).
 *
 * `connection.ts`'s `resolveDatabasePath()` composes with `resolveDataRoot`
 * below rather than reading the pointer inline — its own Risks note (this
 * task's task file) calls that composition out by name: the file read (and
 * the directory creation it can trigger) has to live in this module, not be
 * inlined into `resolveDatabasePath`, so that module's callers can keep
 * reasoning about it as "join a filename onto a root" plus one explicit,
 * visible call, rather than a hidden filesystem read. T-260828-06's
 * sync-folder guard needed no change at all: it already runs against
 * whatever `resolveDatabasePath()` returns, so a pointer-supplied path is
 * checked exactly as a hardcoded one would have been, for free.
 *
 * T-260831-03 added one branch above all of that, and only one: ADR-013's
 * portable build, which resolves its root from where the process is running
 * rather than from the pointer file. It composes *inside* this function
 * (`portable.ts` decides, this file dispatches) for the same reason the
 * pointer does — so `resolveDatabasePath()` stays the single seam the
 * sync-folder guard runs on. For every non-portable launch nothing below
 * changed, which is what the untouched `data-root.test.ts` proves.
 */

export const DATA_ROOT_POINTER_FILENAME = 'data-location.json'

/**
 * `.strict()` — an unknown key fails validation rather than being silently
 * ignored, the same discipline ADR-007 states for entity wire schemas: an
 * absent/rejected field fails fast instead of accepting and dropping a value
 * a hand-edited pointer file's author thought they were setting.
 */
const dataRootPointerSchema = z
  .object({
    dataRoot: z.string()
  })
  .strict()

export interface DataRootOptions {
  /**
   * Overrides the directory the pointer file is read from (and the
   * fallback root when none is present). Tests only, mirroring
   * `OpenDatabaseOptions.userDataDir` in connection.ts exactly: production
   * never passes this, so a test's throwaway directory can never leak into
   * a real boot. Not widened into a production escape hatch — see ADR-006's
   * Alternatives on why a data-root env var was rejected on the same
   * reasoning T-260828-05 already applied to this option.
   */
  userDataDir?: string
  /**
   * Overrides what the process reports about its own image location — ADR-013
   * Decision 2's portable marker, and the launcher-supplied directory
   * Decision 3 reads once that marker has matched. Tests only, on exactly the
   * terms `userDataDir` above is: production never passes this, it calls
   * `observePortableLaunch()` and uses what the process actually reports. It
   * is deliberately not widened into a production escape hatch — an injected
   * probe reaching a real boot would be a way to name a data root from
   * outside, which is the mechanism ADR-006 refused, and it would do so
   * *around* the marker that is the only reason ADR-013 could accept an
   * environment variable at all.
   *
   * It exists because the portable cases are otherwise only reachable from a
   * packaged single-file build launched through NSIS, and the case that
   * matters most — a root inside the extraction directory, which
   * `portable.nsi` deletes after the app exits — must be a test that fails
   * loudly if its refusal is ever removed, not a thing discovered in a QA
   * pass by losing a database.
   */
  portableLaunch?: PortableLaunchProbe
}

/**
 * Thrown for any pointer file this app cannot trust — missing key, wrong
 * type, non-absolute path, unreadable, malformed JSON, or a named directory
 * whose parent does not exist. Reaches `electron/main/index.ts`'s existing
 * `dialog.showErrorBox` + `app.exit(1)` startup-failure path unchanged,
 * exactly like `SyncFolderGuardError` (`sync-folder-guard.ts`) — its message
 * is written to be shown verbatim there. Deliberately never caught and
 * turned into a fallback to the default root: ADR-006's Risks/Consequences
 * section is explicit that a silent fallback here would look exactly like
 * total data loss, which is worse than a startup dialog naming the exact
 * file to fix or delete.
 */
export class DataRootPointerError extends Error {
  readonly pointerPath: string

  constructor(pointerPath: string, problem: string) {
    super(
      `Solo CRM could not use its data-location pointer at "${pointerPath}": ${problem} ` +
        `Delete this file and restart Solo CRM to restore the default data location.`
    )
    this.name = 'DataRootPointerError'
    this.pointerPath = pointerPath
  }
}

function pointerPathFor(userDataDir: string): string {
  return join(userDataDir, DATA_ROOT_POINTER_FILENAME)
}

/**
 * Ensures `dataRoot` exists as a directory, creating it if its parent
 * already exists. Never creates missing parents (`mkdir -p` is explicitly
 * out of scope — this task's Scope section): a pointer at
 * `<missing parent>/newfolder` is a configuration error, not something this
 * app should paper over by inventing an entire directory tree the user never
 * confirmed.
 */
function ensureDataRootDirectory(pointerPath: string, dataRoot: string): void {
  if (existsSync(dataRoot)) {
    if (!statSync(dataRoot).isDirectory()) {
      throw new DataRootPointerError(pointerPath, `"${dataRoot}" already exists and is not a directory.`)
    }
    return
  }

  const parent = dirname(dataRoot)
  if (!existsSync(parent)) {
    throw new DataRootPointerError(
      pointerPath,
      `its parent directory "${parent}" does not exist. Solo CRM creates the folder named by ` +
        `"dataRoot" itself, but will not create missing parent directories.`
    )
  }

  mkdirSync(dataRoot)
}

/**
 * Resolves the data root: the folder `connection.ts`'s `resolveDatabasePath`
 * joins `solocrm.db` onto. With no pointer file present at
 * `<userDataDir>/data-location.json`, returns `userDataDir` unchanged —
 * byte-for-byte today's behaviour, per ADR-006 and this task's Why. A
 * pointer file that exists is read, JSON-parsed, validated against
 * `dataRootPointerSchema`, and — only once every check above has passed —
 * has its named directory created if missing (see `ensureDataRootDirectory`).
 * Any failure along the way throws `DataRootPointerError` rather than
 * falling back to `userDataDir`.
 *
 * **The portable branch comes first and returns before the pointer file is
 * so much as looked at** (ADR-013 Decisions 2, 3 and 6). Not "read and
 * ignored if it disagrees" — not read at all: the pointer's fixed home is
 * `app.getPath('userData')`, which a portable copy shares with any installed
 * Solo CRM on the host, so honouring it would let whichever machine the stick
 * is plugged into decide where the portable copy's data lives and point two
 * copies of the app at one database. `portableDataRoot` throws rather than
 * falling through on a portable launch it cannot trust, so there is no path
 * from a portable launch to `userDataDir` below.
 *
 * `app.setPath('userData', …)` is not used to achieve any of this and must
 * not be (ADR-013 Decision 6): it is the obvious one-liner, and it silently
 * moves ADR-004's `safeStorage` credentials onto the stick where DPAPI cannot
 * decrypt them elsewhere, moves Electron's caches and window state,
 * relocates the pointer file, and does all of it outside this function where
 * none of the guards can see it.
 */
export function resolveDataRoot(options: DataRootOptions = {}): string {
  const probe = options.portableLaunch ?? observePortableLaunch()
  if (isPortableLaunch(probe)) {
    return portableDataRoot(probe)
  }

  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const pointerPath = pointerPathFor(userDataDir)

  if (!existsSync(pointerPath)) {
    return userDataDir
  }

  let raw: string
  try {
    raw = readFileSync(pointerPath, 'utf-8')
  } catch (error) {
    throw new DataRootPointerError(
      pointerPath,
      `it could not be read (${error instanceof Error ? error.message : String(error)}).`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new DataRootPointerError(pointerPath, 'its contents are not valid JSON.')
  }

  const result = dataRootPointerSchema.safeParse(parsed)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    throw new DataRootPointerError(
      pointerPath,
      `its contents do not match the expected shape { "dataRoot": "<absolute path>" } — ${issues.join('; ')}.`
    )
  }

  const { dataRoot } = result.data
  if (dataRoot.length === 0) {
    throw new DataRootPointerError(pointerPath, '"dataRoot" is an empty string.')
  }
  if (!isAbsolute(dataRoot)) {
    throw new DataRootPointerError(pointerPath, `"dataRoot" ("${dataRoot}") is not an absolute path.`)
  }

  ensureDataRootDirectory(pointerPath, dataRoot)

  return dataRoot
}

/**
 * Writes (or overwrites) the pointer file naming `dataRoot` as the data
 * root. Exported for T-260828-18 (the first-run chooser) to call once a
 * folder has been picked; nothing in this task calls it — T-260828-17 builds
 * the read/resolve path only.
 *
 * Atomic by construction: the full contents are written to a temp file in
 * the same directory (so the rename below is a same-filesystem rename, not a
 * cross-device copy) and only then renamed onto the real pointer path. A
 * crash between those two steps leaves the temp file orphaned and the real
 * pointer exactly as it was before this call — either absent or still
 * naming the previous root — never a truncated `data-location.json` that
 * would then fail every future launch. `data-root.test.ts` proves this by
 * making the rename step itself fail and asserting the pointer path is left
 * untouched.
 *
 * **Refuses outright on a portable launch** (ADR-013 Decision 6): the file
 * this would write lives in `app.getPath('userData')`, which a portable copy
 * shares with any installed Solo CRM on the host, so writing it would move
 * the *installed* app's data root on its next launch — a portable run, which
 * the operator believes touched nothing on the machine, silently relocating
 * another copy's data. The refusal lives here rather than only at the call
 * sites so that every future caller inherits it; the two that exist today
 * (the first-run chooser and `Data ▸ Move Data Folder…`) are to be hidden in
 * portable mode by a separate `ui` task, and until they are this is what
 * stands between them and the host's installed copy.
 */
export function writeDataRootPointer(dataRoot: string, options: DataRootOptions = {}): void {
  const probe = options.portableLaunch ?? observePortableLaunch()
  if (isPortableLaunch(probe)) {
    throw new PortableDataRootPointerError()
  }

  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const pointerPath = pointerPathFor(userDataDir)
  const tmpPath = `${pointerPath}.${randomUUID()}.tmp`

  const content = `${JSON.stringify({ dataRoot } satisfies z.infer<typeof dataRootPointerSchema>, null, 2)}\n`
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, pointerPath)
}
