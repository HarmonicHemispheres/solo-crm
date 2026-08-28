import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'

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
 */
export function resolveDataRoot(options: DataRootOptions = {}): string {
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
 */
export function writeDataRootPointer(dataRoot: string, options: DataRootOptions = {}): void {
  const userDataDir = options.userDataDir ?? app.getPath('userData')
  const pointerPath = pointerPathFor(userDataDir)
  const tmpPath = `${pointerPath}.${randomUUID()}.tmp`

  const content = `${JSON.stringify({ dataRoot } satisfies z.infer<typeof dataRootPointerSchema>, null, 2)}\n`
  writeFileSync(tmpPath, content, 'utf-8')
  renameSync(tmpPath, pointerPath)
}
