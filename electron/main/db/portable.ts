import { tmpdir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import { app } from 'electron'
import { realpathWithFallback } from './sync-folder-guard'

/**
 * ADR-013: what makes *this* process a portable launch, and where a portable
 * launch is allowed to keep its data.
 *
 * Nothing here opens, names or joins a database path — this module answers
 * "which folder is the data root" and `data-root.ts` composes it into
 * `resolveDataRoot()`, which keeps `connection.ts`'s `resolveDatabasePath()`
 * the single seam the sync-folder guard runs on (ADR-006 item 3, and the
 * AGENTS.md gotcha it enforces). A portable path that reached better-sqlite3's
 * constructor by any other route would be a bypass of that guard, not a
 * shortcut, and `connection.test.ts` pins it structurally — including by
 * refusing to let any module outside its two declared owners so much as spell
 * that constructor, which is why this sentence describes it instead.
 *
 * **Why the marker is an observation rather than a flag.** Both Windows
 * artifacts — the NSIS installer and the single-file `portable` target —
 * are packed from one `electron-vite build` and one `electron-builder --win`
 * invocation over the same `win-unpacked` payload, and electron-builder's
 * per-target option surface is `artifactName` and `publish` only. A
 * build-time define, a marker file in `resources/`, or a distinct `appId`
 * would therefore be *identical in both artifacts* and would mark the
 * installer portable too. ADR-013's Alternatives records that this option
 * does not exist; it only looks like it does. So the app asks where it is
 * running from instead.
 */

/**
 * The variable `portable.nsi:77` sets on the child process — `$EXEDIR`, the
 * folder holding the `.exe` the operator actually double-clicked — moments
 * before it runs the extracted app.
 *
 * **It is never the signal that this is a portable launch.** It supplies a
 * value only once `isPortableLaunch()` below has already established, from
 * the process's own image location, that this *is* one. That ordering is the
 * whole of ADR-013 Decision 2: it is what makes a portable launch with no
 * usable variable a state the app can detect and refuse
 * (`portableDataRoot()`), rather than one it silently mistakes for an
 * ordinary install.
 *
 * ADR-006 item 6 refused `SOLOCRM_DATA_ROOT` and this does not reopen it.
 * ADR-013 Decision 3 states the four-part test an environment variable must
 * pass to name a data location at all — written by this project's own build
 * output, reporting an observable fact rather than a preference, read only
 * in a process state the environment cannot fake, and unable to select any
 * location the artifact's own placement does not already determine. This
 * one passes all four; anything that does not needs its own ADR.
 */
export const PORTABLE_EXECUTABLE_DIR_ENV = 'PORTABLE_EXECUTABLE_DIR'

/**
 * Everything the two decisions below are allowed to look at, as plain data.
 *
 * Taking it as an argument rather than reading `app`/`os`/`process` inline is
 * what makes the portable cases testable without a packaged build and without
 * a real portable launch — the same discipline, and the same test-only
 * boundary, as `DataRootOptions.userDataDir` and
 * `OpenDatabaseOptions.userDataDir` (T-260828-05's Risks note, ADR-006's
 * note on `userDataDir`). Production never constructs one of these by hand:
 * it calls `observePortableLaunch()` below and passes what the process
 * actually reports. This is deliberately **not** widened into a production
 * escape hatch — an injected probe that reached a real boot would be a way to
 * name a data root from outside, which is precisely the mechanism ADR-006
 * refused.
 */
export interface PortableLaunchProbe {
  /** `app.isPackaged` — false under `electron .`, and outside Electron entirely. */
  readonly isPackaged: boolean
  /** `dirname(app.getPath('exe'))` — under the portable target, the extraction directory. */
  readonly executableDir: string
  /** `os.tmpdir()`. */
  readonly tempDir: string
  /** `process.env`, read only for `PORTABLE_EXECUTABLE_DIR`. */
  readonly env: NodeJS.ProcessEnv
}

/**
 * What this process actually reports about itself. The one place production
 * reads Electron and the environment for any of this.
 *
 * `app` is `undefined` outside an Electron main process — a Vitest `node`
 * worker, `npm run seed` — and its type says otherwise, so the widened alias
 * below is what keeps the check from reading as dead code. Absent `app` is
 * not a special case being papered over: it is `isPackaged === false`
 * arriving by a shorter route, since a process with no Electron `app` object
 * is definitionally not a packaged Electron launch and so cannot be a
 * portable one. In a packaged app this branch is unreachable.
 *
 * `getPath('exe')` is asked for only when packaged, so a test double that
 * throws from `getPath` (the shape `readonly-connection.test.ts`,
 * `stats.test.ts` and `ipc/registry.test.ts` already use, to make a test that
 * forgot its `userDataDir` override fail loudly) is never called here.
 */
export function observePortableLaunch(): PortableLaunchProbe {
  const electronApp: typeof app | undefined = app
  const isPackaged = electronApp?.isPackaged === true

  return {
    isPackaged,
    executableDir: dirname(electronApp && isPackaged ? electronApp.getPath('exe') : process.execPath),
    tempDir: tmpdir(),
    env: process.env
  }
}

/**
 * True when `candidate` *is* `container` or sits beneath it — normalised,
 * and matched on whole path segments.
 *
 * This is `sync-folder-guard.ts`'s approach rather than a second, subtly
 * different one (ADR-013 Decision 2 says so in as many words): symlinks
 * resolved through the same `realpathWithFallback`, split on both separators,
 * compared case-insensitively, segment by segment. A raw `startsWith` on the
 * unresolved strings gets this wrong in both directions — it misses an 8.3 or
 * symlinked `%TEMP%` (`C:\Users\ROBBY~1\AppData\Local\Temp`), which is a
 * *missed refusal* and therefore silent data loss, and it matches a sibling
 * whose name merely begins with the container's (`C:\Temp2` under `C:\Temp`),
 * which is a spurious startup failure.
 *
 * Case-insensitive on every platform, exactly like `segmentMatchesMarker` in
 * `sync-folder-guard.ts`, rather than only on Windows. The two directions are
 * not symmetric: an extra match here costs a startup dialog, a missed one
 * costs the whole database, and this predicate only ever runs on Windows
 * paths in practice — the portable target is an NSIS `.exe`.
 */
export function isSameOrInside(container: string, candidate: string): boolean {
  const containerSegments = normalisedSegments(container)
  const candidateSegments = normalisedSegments(candidate)

  // A container that reduces to no segments at all is a filesystem root
  // (`/`), which carries nothing to match on. Answering "yes, everything is
  // inside it" would make every packaged app portable the moment
  // `os.tmpdir()` misbehaved — the silent direction. Unreachable in practice:
  // `os.tmpdir()` is `%TEMP%`/`$TMPDIR` and the extraction directory is
  // `$PLUGINSDIR\app`; neither is a drive root, and the refusals in
  // `portableDataRoot()` are only reached once the marker has already matched
  // a non-empty `tempDir`.
  if (containerSegments.length === 0) return false
  if (candidateSegments.length < containerSegments.length) return false

  return containerSegments.every((segment, index) => segment === candidateSegments[index])
}

function normalisedSegments(target: string): string[] {
  return realpathWithFallback(resolve(target))
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase())
}

/**
 * ADR-013 Decision 2. Solo CRM is running portable when the build is packaged
 * **and** the directory holding the running executable is inside the OS
 * temporary directory. Under the single-file `portable` target that is
 * exactly the extraction directory — `$PLUGINSDIR\app`, itself created under
 * `%TEMP%` by `InitPluginsDir`, or `$TEMP\<UNPACK_DIR_NAME>`. An installed
 * build runs from `%LOCALAPPDATA%\Programs\…` and can never satisfy it, which
 * is why `resolveDataRoot()`'s existing behaviour is untouched for every
 * non-portable launch.
 *
 * ADR-013 records the residual honestly and it is worth repeating here: a
 * user who copies an installed build's whole program directory into `%TEMP%`,
 * runs it from there and sets `PORTABLE_EXECUTABLE_DIR` gets portable
 * behaviour. That is deliberately reconstructing a portable launch, not
 * something a shell one-liner does by accident.
 */
export function isPortableLaunch(probe: PortableLaunchProbe): boolean {
  if (!probe.isPackaged) return false
  return isSameOrInside(probe.tempDir, probe.executableDir)
}

/** Which of ADR-013 Decision 4's four refusals fired. */
export type PortableDataRootRefusal =
  /** `PORTABLE_EXECUTABLE_DIR` absent, empty, or only whitespace. */
  | 'no-launcher-directory'
  /** Set, but not an absolute path. */
  | 'not-absolute'
  /** Equal to, or inside, the folder `portable.nsi:90` deletes after the app exits. */
  | 'extraction-directory'
  /** Elsewhere under `os.tmpdir()` — not durable storage regardless of what NSIS deletes. */
  | 'temporary-directory'

/**
 * Thrown when this is a portable launch whose data root cannot be trusted.
 * Reaches `electron/main/index.ts`'s existing `dialog.showErrorBox` +
 * `app.exit(1)` startup-failure path unchanged, exactly like
 * `DataRootPointerError` and `SyncFolderGuardError` — its message is written
 * to be shown verbatim there.
 *
 * **Never caught and turned into a fallback**, and ADR-013 Decision 4 names
 * both tempting fallbacks and refuses each on its own grounds. Falling back
 * to `app.getPath('userData')` ships a "portable" build that is silently an
 * installed one: the operator's stick carries the app and none of the data,
 * and they find out on the second machine, having by then done real work in
 * two places. Falling back to the executable's own directory writes into the
 * folder `portable.nsi:90` deletes after the app exits — total, silent data
 * loss, with a working app right up until it closes.
 */
export class PortableDataRootError extends Error {
  readonly refusal: PortableDataRootRefusal

  constructor(refusal: PortableDataRootRefusal, detail: string) {
    super(
      `Solo CRM is running as a portable copy, so it keeps its data in the folder the Solo CRM .exe you ` +
        `launched is sitting in — but it could not work out where that folder is. ${detail} ` +
        `Solo CRM has not opened or created a database. Copy Solo CRM's .exe to a USB stick or an ordinary ` +
        `folder on this machine and run it from there.`
    )
    this.name = 'PortableDataRootError'
    this.refusal = refusal
  }
}

/**
 * ADR-013 Decision 3 and Decision 4: the portable data root, or a refusal.
 *
 * Returns `PORTABLE_EXECUTABLE_DIR` — the folder holding the artifact the
 * operator double-clicked — with **no subfolder appended**, so
 * `resolveDatabasePath()` yields `<that folder>/solocrm.db` and the `.exe`
 * and its database sit side by side, which is the operator's whole mental
 * model of the artifact.
 *
 * The extraction-directory refusal is checked before the broader
 * temporary-directory one so the message names the specific danger rather
 * than the general one. It is the single most important check in this
 * module: `portable.nsi:38` and `:90` both run `RMDir /r $INSTDIR`, the
 * second of them *after the app exits*, so a database written there is
 * destroyed on close with no error at any point. Every wrong version of this
 * function still launches, still shows a working app, and still loses
 * everything. `portable.test.ts` fails loudly if the check is removed.
 *
 * The default extraction directory is `%TEMP%\<ksuid>` with the ksuid fixed
 * at build time, so it is the *same path on every launch of a given build* —
 * which is what makes "it seemed to work when I tested it twice" a plausible
 * way not to notice.
 */
export function portableDataRoot(probe: PortableLaunchProbe): string {
  const raw = probe.env[PORTABLE_EXECUTABLE_DIR_ENV]
  // Trimmed before every check *and* used trimmed: ADR-013 refuses a
  // whitespace-only value, and a value that arrived with a stray newline is
  // the same launcher mistake one character later. Windows strips trailing
  // spaces from real path components anyway, so nothing legitimate is lost.
  const supplied = raw === undefined ? '' : raw.trim()

  if (supplied.length === 0) {
    throw new PortableDataRootError(
      'no-launcher-directory',
      `The portable launcher did not say: the ${PORTABLE_EXECUTABLE_DIR_ENV} environment variable was ` +
        `not set, or was empty. This usually means the unpacked Solo CRM.exe was run directly rather than ` +
        `through the portable launcher.`
    )
  }

  if (!isAbsolute(supplied)) {
    throw new PortableDataRootError(
      'not-absolute',
      `${PORTABLE_EXECUTABLE_DIR_ENV} names "${supplied}", which is not a full path.`
    )
  }

  const root = resolve(supplied)

  if (isSameOrInside(probe.executableDir, root)) {
    throw new PortableDataRootError(
      'extraction-directory',
      `${PORTABLE_EXECUTABLE_DIR_ENV} names "${root}", which is inside the temporary folder Solo CRM ` +
        `unpacks itself into ("${probe.executableDir}"). That folder is deleted when Solo CRM closes, so a ` +
        `database kept there — and everything in it — would be destroyed the moment you quit the app.`
    )
  }

  if (isSameOrInside(probe.tempDir, root)) {
    throw new PortableDataRootError(
      'temporary-directory',
      `${PORTABLE_EXECUTABLE_DIR_ENV} names "${root}", which is inside this machine's temporary folder ` +
        `("${probe.tempDir}"). Temporary folders are not durable storage — Windows and cleanup tools empty ` +
        `them without warning — so a database kept there would eventually be deleted.`
    )
  }

  return root
}

/**
 * ADR-013 Decision 6, as an enforcement rather than a convention: in portable
 * mode `data-location.json` is not read and is **never written**.
 *
 * The pointer's fixed home is `app.getPath('userData')`, which in a portable
 * build still resolves to `%APPDATA%\Solo CRM` — shared with any installed
 * copy on the same machine. Writing it would silently repoint the *installed*
 * app's data root on its next launch: a portable run, which the operator
 * thinks touched nothing on the host, moving another app's data. Reading it
 * would let whichever machine the stick is plugged into decide where the
 * portable app's data lives, and point two copies of the app at one database.
 *
 * `resolveDataRoot()` implements the read half by returning before the
 * pointer file is looked at; this error is the write half, thrown by
 * `writeDataRootPointer()`. It is a programming error rather than a user
 * error — the entry points that could reach it (the first-run chooser
 * T-260828-18, the `Data ▸ Move Data Folder…` menu item T-260828-19) are to
 * be hidden in portable mode by a separate `ui` task, per ADR-013 Decision 6.
 * Until they are, this is what stands between a portable run and the host's
 * installed copy, and it fails loudly instead of quietly succeeding.
 */
export class PortableDataRootPointerError extends Error {
  constructor() {
    super(
      `Solo CRM will not record a data location while running as a portable copy. A portable copy always ` +
        `keeps its data in the folder its .exe is in, and the file that would record anything else lives in ` +
        `this machine's own application-data folder — shared with any Solo CRM installed here. Writing it ` +
        `would move the installed copy's data, not this one's.`
    )
    this.name = 'PortableDataRootPointerError'
  }
}
