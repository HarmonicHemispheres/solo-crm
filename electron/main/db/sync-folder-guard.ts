import { dirname } from 'node:path'
import { realpathSync } from 'node:fs'

/**
 * AGENTS.md: "the database file must never live in a Drive, Dropbox or
 * iCloud folder. File-sync daemons and SQLite corrupt each other." This
 * module is the enforcement — `connection.ts` calls `findSyncFolderMatch`
 * against the resolved database path immediately before constructing the
 * `Database` handle, so a match refuses the open before better-sqlite3 has a
 * chance to create the file.
 *
 * Deliberately a pure function of the path: no `Database`, no settings, no
 * app state. T-260828-05's Risks note the same discipline for the path
 * choice itself ("tests get an explicit temp-directory override, not a
 * relaxed default") — this module extends it to the guard that checks that
 * path. Keeping it pure is also what makes it testable without the real
 * Drive/Dropbox/iCloud/OneDrive daemons installed (this task's acceptance
 * criteria).
 */

/**
 * The sync-daemon roots this app refuses to put a live SQLite file under.
 * Matched as whole path segments, case-insensitively — see
 * `findSyncFolderMatch`. `iCloud Drive` is the name users see; `Mobile
 * Documents` is iCloud's actual on-disk folder name (both are listed because
 * a path can surface either, depending on how it was constructed).
 */
export const SYNC_FOLDER_MARKERS: readonly string[] = [
  'Google Drive',
  'My Drive',
  'Shared drives', // Google Drive for desktop's streamed mount: `G:\Shared drives\<name>` (T-260901-22)
  'Dropbox',
  'iCloud Drive',
  'iCloudDrive', // iCloud for Windows' actual on-disk folder — no space
  'Mobile Documents',
  'OneDrive'
]

/**
 * The real services decorate their folder names: business OneDrive is
 * `OneDrive - Contoso Ltd` (or `OneDrive-Personal` under macOS
 * CloudStorage), a Dropbox team account is `Dropbox (Personal)`. Matched as
 * anchored prefixes that REQUIRE the decoration separator, so
 * `OneDriveSync` and `dropbox-clone` still fall through to the
 * whole-segment rule and do not match.
 */
export const SYNC_FOLDER_MARKER_PATTERNS: readonly RegExp[] = [
  /^onedrive[ -]/i,
  /^dropbox \(/i
]

/**
 * The env var that lets a deliberate user override the refusal. Off by
 * default — it only takes effect when set to exactly `'1'`, so a stray
 * unrelated truthy-looking value (`SOLOCRM_ALLOW_SYNC_FOLDER_DB=false`, an
 * empty string from a shell export with nothing after `=`) can't
 * accidentally disable the guard. Named in the refusal dialog's text
 * (see connection.ts) so a user who deliberately wants this — a synced
 * folder used as a personal, single-machine backup, accepting the corruption
 * risk — has a documented way to say so, without this module ever reading
 * settings or any other app state to find out.
 */
export const SYNC_FOLDER_GUARD_OVERRIDE_ENV = 'SOLOCRM_ALLOW_SYNC_FOLDER_DB'

export function isSyncFolderGuardOverridden(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SYNC_FOLDER_GUARD_OVERRIDE_ENV] === '1'
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error
}

/**
 * Resolves symlinks in `targetPath`, the way `fs.realpathSync` does, but
 * without requiring the path to exist. `solocrm.db` itself never exists yet
 * when this runs (the guard's whole point is to check *before*
 * better-sqlite3 creates it), and on a fresh install `userData` itself may
 * not exist either. `realpathSync` throws `ENOENT` on any path segment that
 * is missing, so on that failure this walks up to the nearest ancestor that
 * does exist, resolves *that* (following any symlink — including a
 * symlinked `userData` pointing into a Dropbox folder, the case
 * T-260828-06's Risks section calls out as the one that gets missed), and
 * re-appends the missing tail segments unresolved, since a symlink cannot
 * live inside a path segment that doesn't exist yet.
 */
export function realpathWithFallback(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch (error) {
    if (!isErrnoException(error) || error.code !== 'ENOENT') {
      // Any other failure (an unreachable UNC share throws UNKNOWN on
      // Windows, EACCES elsewhere) degrades to the unresolved path — the
      // segment check still runs against it, which fails safe in both
      // directions: no hard startup refusal on an error that has nothing to
      // do with sync folders, and no skipped check either.
      return targetPath
    }
    const parent = dirname(targetPath)
    if (parent === targetPath) {
      // Walked all the way to the filesystem root without finding an
      // existing ancestor — nothing left to resolve.
      return targetPath
    }
    return `${realpathWithFallback(parent)}${targetPath.slice(parent.length)}`
  }
}

export interface SyncFolderMatch {
  /** Which marker from SYNC_FOLDER_MARKERS matched, in its canonical casing. */
  readonly marker: string
  /** The symlink-resolved path the match was found in. */
  readonly resolvedPath: string
}

/**
 * Splits `resolvedPath` on both `/` and `\` — a path can arrive with either
 * separator (a value built by hand, or resolved on one platform and checked
 * on another) and Windows accepts both — and drops empty segments so a
 * leading drive letter (`C:`), a leading slash, or a doubled separator
 * doesn't produce a spurious `''` segment to compare against.
 */
function pathSegments(resolvedPath: string): string[] {
  return resolvedPath.split(/[\\/]+/).filter((segment) => segment.length > 0)
}

/**
 * True whole-segment, case-insensitive equality — never a substring test.
 * `~/projects/dropbox-clone/` splits to a `dropbox-clone` segment, which is
 * not equal to `dropbox` under this comparison, so it does not match; only a
 * segment that is *exactly* one of the markers (ignoring case) does. This is
 * the property this task's Risks section calls the one worth protecting:
 * "a developer whose home directory happens to contain a matching word
 * cannot run the app at all" if segment matching were loosened to a
 * substring check.
 */
function segmentMatchesMarker(segment: string, marker: string): boolean {
  return segment.toLowerCase() === marker.toLowerCase()
}

/**
 * Checks `targetPath` — after resolving symlinks — against every known
 * sync-folder root. Returns the first matching marker and the resolved path
 * it was found in, or `null` if nothing matched. Pure function of the path:
 * no override check, no dialog, no exit — `connection.ts` is where those
 * side effects belong.
 */
export function findSyncFolderMatch(targetPath: string): SyncFolderMatch | null {
  const resolvedPath = realpathWithFallback(targetPath)
  const segments = pathSegments(resolvedPath)

  for (const segment of segments) {
    const marker = SYNC_FOLDER_MARKERS.find((candidate) => segmentMatchesMarker(segment, candidate))
    if (marker) {
      return { marker, resolvedPath }
    }
    if (SYNC_FOLDER_MARKER_PATTERNS.some((pattern) => pattern.test(segment))) {
      return { marker: segment, resolvedPath }
    }
  }

  return null
}

/**
 * The one thing this module lets a caller say about the *launch* rather than
 * the path. It changes a sentence of advice and nothing else — never whether
 * a path matches, never whether the override applies — so this module stays
 * the pure function of a path it was built as (T-260828-06), and there is
 * still exactly one refusal rule rather than a portable variant that can
 * drift from the installed one.
 */
export interface SyncFolderGuardContext {
  /**
   * ADR-013 Decision 5. The guard applies to a portable build's data root
   * with no exemption — the root *is* the folder the `.exe` sits in, so a
   * portable copy dropped in `OneDrive\Apps` makes the live SQLite file a
   * synced file, which is the corruption case arriving by a much easier
   * route than any installed build's. Only the advice differs, because it
   * has to: the installed message's implicit "choose another folder" is
   * useless to an operator who has no chooser, and the fix they do have is
   * to move the `.exe`. `connection.ts`'s `resolveDatabasePath` is the only
   * caller that sets it, from the same launch observation it resolves the
   * root with.
   */
  readonly portable?: boolean
}

/**
 * The error `connection.ts` throws on a match, before the `Database` handle
 * is constructed. Its message is written to be shown verbatim in the startup
 * failure dialog (`electron/main/index.ts`'s existing `dialog.showErrorBox` /
 * `app.exit(1)` path) — it names the refused path, the reason, and the
 * override, so a from-scratch dialog is not needed here.
 */
export class SyncFolderGuardError extends Error {
  readonly match: SyncFolderMatch

  constructor(match: SyncFolderMatch, context: SyncFolderGuardContext = {}) {
    super(
      `Solo CRM will not open its database at "${match.resolvedPath}" because that path runs through a ` +
        `"${match.marker}" folder. File-sync services (Google Drive, Dropbox, iCloud, OneDrive) and SQLite ` +
        `write to the same file at the same time and corrupt each other — this is not a database bug, it ` +
        `only shows up later as one. ` +
        (context.portable === true
          ? `This is the portable Solo CRM, so its data lives in the same folder as the .exe and no setting ` +
            `can move it: move Solo CRM's .exe out of the synced folder — onto a USB stick, or an ordinary ` +
            `folder on this machine — and run it again. `
          : `Move Solo CRM's data out of the synced folder and restart the app. `) +
        `If you understand the risk and want to proceed anyway, set the environment variable ` +
        `${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1 before starting Solo CRM.`
    )
    this.name = 'SyncFolderGuardError'
    this.match = match
  }
}

/**
 * The guard as a *decision*. `findSyncFolderMatch` above answers "does this
 * path run through a sync folder", which is a fact about the string alone;
 * this answers "may this app put a live database here", which additionally
 * honours the one documented escape hatch.
 *
 * Returns the match that blocks the path, or `null` when the path is
 * allowed — either because nothing matched, or because
 * `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` is set and the user has accepted the
 * stated risk. T-260828-57: this exists because "find the match, then check
 * the override" had been written out twice with different answers —
 * `connection.ts` honoured the override, the first-run chooser did not, so
 * a user who had deliberately set it could not pick the folder they had
 * just enabled, and the refusal did not mention the override at all. One
 * function, so there is one answer.
 *
 * The warning fires only when the override actually *suppressed* a match.
 * That is the breadcrumb that explains a corruption report weeks later;
 * logging on every allowed path would bury it in noise.
 */
export function findBlockingSyncFolderMatch(targetPath: string): SyncFolderMatch | null {
  const match = findSyncFolderMatch(targetPath)
  if (!match) return null

  if (isSyncFolderGuardOverridden()) {
    console.warn(
      `[db] ${SYNC_FOLDER_GUARD_OVERRIDE_ENV}=1 — sync-folder guard skipped for ${match.resolvedPath} ` +
        `(matched "${match.marker}")`
    )
    return null
  }

  return match
}

/**
 * `findBlockingSyncFolderMatch` as an assertion, for the caller that is
 * about to open the database rather than ask a question about a path.
 * Throws `SyncFolderGuardError`, whose message names the path, the reason
 * and the override, and is written to be shown verbatim by
 * `electron/main/index.ts`'s startup-failure dialog.
 *
 * Called from exactly one place — `resolveDatabasePath()` in
 * `connection.ts`. See that function for why the guard belongs in the path
 * resolver rather than beside each call that constructs a connection.
 */
export function assertPathOutsideSyncFolder(targetPath: string, context: SyncFolderGuardContext = {}): void {
  const match = findBlockingSyncFolderMatch(targetPath)
  if (match) {
    throw new SyncFolderGuardError(match, context)
  }
}
