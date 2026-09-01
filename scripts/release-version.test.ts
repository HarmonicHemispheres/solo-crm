import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * T-260829-02: `release/Solo CRM-Setup-<version>.exe` is named after
 * package.json's `version`, which is hand-bumped. A build cut without bumping
 * it overwrites the previous installer with a different program under the same
 * file name and the same Apps-and-features DisplayVersion — silently, exit 0.
 *
 * `scripts/release-version.mjs check` is the gate on that, and its whole
 * contract is an exit code, so this spawns it rather than importing it. The
 * fixture root it is pointed at (`SOLOCRM_PROJECT_ROOT`) is a throwaway
 * directory holding only a package.json and a `release/`; it lives inside the
 * repository so that the script's `git rev-parse HEAD` resolves the same
 * commit it would in a real build.
 *
 * T-260831-02 widened the guard from the NSIS artifact to every artifact
 * `build.win.target` configures. The failure that widening can reintroduce is
 * not a crash — it is the script printing `building 0.2.0 from abc1234` while
 * watching a file electron-builder never writes, which looks identical to a
 * clean first build. So the cases below assert *refusals*: a suite that only
 * exercised the passing path could not fail for the reason this script exists.
 */

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const script = join(root, 'scripts', 'release-version.mjs')

/** The real HEAD, which is what the script under test will read. */
function headCommit(): string {
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf-8' })
  return git.stdout.trim()
}

let fixture: string

function releaseDir(): string {
  return join(fixture, 'release')
}

/**
 * `build` overrides merge over the single-target config the guard shipped
 * with, so a test that adds a `win.target` list changes only that.
 */
function writePackage(version: string, build: Record<string, unknown> = {}): void {
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({
      name: 'solo-crm',
      version,
      build: {
        productName: 'Solo CRM',
        directories: { output: 'release' },
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' },
        ...build
      }
    }),
    'utf-8'
  )
}

/**
 * The two-target fixture. `zip` deliberately configures no `artifactName`, so
 * its name comes from electron-builder's own default for that target — which
 * is where the extension is decided, and where defaulting to `exe` would leave
 * the guard watching `Solo CRM-0.2.0-win.exe`, a file nothing ever writes.
 */
const NSIS_ARTIFACT = 'Solo CRM-Setup-0.2.0.exe'
const ZIP_ARTIFACT = 'Solo CRM-0.2.0-win.zip'

function writeTwoTargetPackage(version = '0.2.0'): void {
  writePackage(version, { win: { target: ['nsis', 'zip'] } })
}

function writeManifest(builds: Record<string, unknown>[]): void {
  writeFileSync(join(releaseDir(), 'build-manifest.json'), JSON.stringify({ builds }))
}

function run(command: string): { status: number; output: string } {
  const result = spawnSync(process.execPath, [script, command], {
    cwd: fixture,
    encoding: 'utf-8',
    env: { ...process.env, SOLOCRM_PROJECT_ROOT: fixture }
  })
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` }
}

beforeEach(() => {
  // Inside the repo (so git resolves), under gitignored `out/`.
  mkdirSync(join(root, 'out'), { recursive: true })
  fixture = mkdtempSync(join(root, 'out', 'release-guard-'))
  mkdirSync(releaseDir(), { recursive: true })
  writePackage('0.2.0')
})

afterEach(() => {
  rmSync(fixture, { recursive: true, force: true })
})

describe('release-version check', () => {
  it('allows a build when no artifact for this version exists', () => {
    const { status, output } = run('check')
    expect(output).toContain('Solo CRM-Setup-0.2.0.exe')
    expect(status).toBe(0)
  })

  // T-260831-02 must not move the line a passing build prints. Pinned as a
  // whole line rather than a substring, because "still mentions the exe" would
  // survive the guard silently dropping a second artifact from it.
  it('prints the same success line as before the guard covered every target', () => {
    const { status, output } = run('check')

    expect(status).toBe(0)
    expect(output.trim()).toMatch(
      new RegExp(`^release-version: building 0\\.2\\.0 from ${headCommit()}.* -> ${NSIS_ARTIFACT}$`)
    )
  })

  it('allows rebuilding the same commit over its own artifact', () => {
    writeFileSync(join(releaseDir(), 'Solo CRM-Setup-0.2.0.exe'), 'installer')
    expect(run('record').status).toBe(0)

    const { status } = run('check')
    expect(status).toBe(0)
  })

  // The case the guard exists for: two builds hours apart, three merged tasks
  // between them, one file name.
  it('refuses when the artifact on disk came from a different commit', () => {
    writeFileSync(join(releaseDir(), 'Solo CRM-Setup-0.2.0.exe'), 'installer')
    writeFileSync(
      join(releaseDir(), 'build-manifest.json'),
      JSON.stringify({
        builds: [{ version: '0.2.0', commit: 'deadbee', dirty: false, artifact: 'x' }]
      })
    )

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('deadbee')
    expect(output).toContain('Bump "version" in package.json')
  })

  // A bump is the fix the failure asks for, so it has to actually be one.
  it('passes again once the version is bumped past the recorded build', () => {
    writeFileSync(join(releaseDir(), 'Solo CRM-Setup-0.2.0.exe'), 'installer')
    writeFileSync(
      join(releaseDir(), 'build-manifest.json'),
      JSON.stringify({ builds: [{ version: '0.2.0', commit: 'deadbee', dirty: false }] })
    )
    expect(run('check').status).toBe(1)

    writePackage('0.3.0')
    const { status, output } = run('check')
    expect(status).toBe(0)
    expect(output).toContain('Solo CRM-Setup-0.3.0.exe')
  })

  // An artifact with no manifest entry is every installer built before this
  // guard existed, including the `0.1.0` files sitting in release/ today.
  it('refuses an existing artifact of unknown provenance', () => {
    writeFileSync(join(releaseDir(), 'Solo CRM-Setup-0.2.0.exe'), 'installer')

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('unknown provenance')
  })

  // Reading a corrupt manifest as "nothing built here" would wave through the
  // overwrite this exists to stop.
  it('fails loudly on an unreadable manifest rather than assuming an empty one', () => {
    writeFileSync(join(releaseDir(), 'Solo CRM-Setup-0.2.0.exe'), 'installer')
    writeFileSync(join(releaseDir(), 'build-manifest.json'), '{ not json')

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('not readable JSON')
  })

  // Substituting an unknown placeholder would leave the guard watching a path
  // electron-builder never writes — passing forever, protecting nothing.
  it('refuses an artifactName it cannot fully resolve', () => {
    writeFileSync(
      join(fixture, 'package.json'),
      JSON.stringify({
        name: 'solo-crm',
        version: '0.2.0',
        build: {
          productName: 'Solo CRM',
          directories: { output: 'release' },
          nsis: { artifactName: '${productName}-${version}-${arch}.${ext}' }
        }
      }),
      'utf-8'
    )

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('${arch}')
  })

  it('rejects an unknown command instead of exiting 0', () => {
    expect(run('build').status).toBe(2)
  })
})

/**
 * T-260831-02. Every case here fails by *passing* if the guard regresses, so
 * each one puts an artifact on disk that only a correctly-widened guard is
 * looking at.
 */
describe('release-version check, with more than one target configured', () => {
  it('watches every configured target, each under its own extension', () => {
    writeTwoTargetPackage()

    const { status, output } = run('check')
    expect(status).toBe(0)
    // `.zip`, not `.exe`: the zip target's extension comes from the target,
    // and a default of `exe` here is the silent failure this task is about.
    expect(output.trim()).toMatch(
      new RegExp(`-> ${NSIS_ARTIFACT}, Solo CRM-0\\.2\\.0-win\\.zip$`)
    )
  })

  // The headline regression: the first target is clean, the second is not, and
  // the pre-task guard exits 0 having looked only at the first.
  it('refuses when only the second target artifact came from a different commit', () => {
    writeTwoTargetPackage()
    writeFileSync(join(releaseDir(), ZIP_ARTIFACT), 'archive')
    writeManifest([{ version: '0.2.0', commit: 'deadbee', dirty: false, artifacts: ['x'] }])

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain(ZIP_ARTIFACT)
    expect(output).toContain('deadbee')
    // The NSIS installer is not on disk, so naming it would be a false report.
    expect(output).not.toContain(NSIS_ARTIFACT)
  })

  it('refuses the second target artifact even with no manifest entry at all', () => {
    writeTwoTargetPackage()
    writeFileSync(join(releaseDir(), ZIP_ARTIFACT), 'archive')

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain(ZIP_ARTIFACT)
    expect(output).toContain('unknown provenance')
  })

  // Rebuilding your own output is normal iteration and stays allowed, however
  // many artifacts that build writes.
  it('allows the same commit to rebuild over both of its own artifacts', () => {
    writeTwoTargetPackage()
    writeFileSync(join(releaseDir(), ZIP_ARTIFACT), 'archive')
    writeFileSync(join(releaseDir(), NSIS_ARTIFACT), 'installer')
    writeManifest([{ version: '0.2.0', commit: headCommit(), dirty: false, artifacts: ['x'] }])

    expect(run('check').status).toBe(0)
  })

  it('names both artifacts when both are on disk from a different commit', () => {
    writeTwoTargetPackage()
    writeFileSync(join(releaseDir(), NSIS_ARTIFACT), 'installer')
    writeFileSync(join(releaseDir(), ZIP_ARTIFACT), 'archive')
    writeManifest([{ version: '0.2.0', commit: 'deadbee', dirty: false, artifacts: ['x'] }])

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain(NSIS_ARTIFACT)
    expect(output).toContain(ZIP_ARTIFACT)
    expect(output).toContain('were built from commit deadbee')
  })

  // A well-formed first target must not mask a broken second one.
  it('refuses an unresolvable placeholder in the second target, naming it', () => {
    writePackage('0.2.0', {
      win: { target: ['nsis', 'portable'] },
      portable: { artifactName: '${productName}-${version}-${arch}.${ext}' }
    })

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('${arch}')
    expect(output).toContain('portable.artifactName')
  })

  // Guessing an extension for a target this script does not know leaves it
  // watching a name that is never written, which passes. Refusing is the
  // whole point.
  it('refuses a target it has no name or extension for rather than defaulting', () => {
    writePackage('0.2.0', { win: { target: ['nsis', 'msi'] } })

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('msi')
    expect(output).not.toContain('release-version: building')
  })

  // Nothing to watch and exit 0 is indistinguishable from having done the job.
  it('refuses a configured but empty target list', () => {
    writePackage('0.2.0', { win: { target: [] } })

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('does not name a target')
  })

  // electron-builder accepts `{ target, arch }` objects as well as strings.
  it('reads a target given in object form', () => {
    writePackage('0.2.0', { win: { target: [{ target: 'nsis', arch: ['x64'] }] } })

    const { status, output } = run('check')
    expect(status).toBe(0)
    expect(output).toContain(NSIS_ARTIFACT)
  })

  // electron-builder falls back target -> platform -> top level -> default, so
  // a project naming its artifacts once under `win` must not leave the guard
  // watching the target's default name instead.
  it('honours a platform-level artifactName for a target that sets none', () => {
    writePackage('0.2.0', {
      win: { target: ['zip'], artifactName: '${productName}-${version}.${ext}' }
    })

    const { status, output } = run('check')
    expect(status).toBe(0)
    expect(output).toContain('Solo CRM-0.2.0.zip')
  })
})

describe('release-version record', () => {
  it('stamps the version with the commit that built it', () => {
    expect(run('record').status).toBe(0)

    const manifest = JSON.parse(readFileSync(join(releaseDir(), 'build-manifest.json'), 'utf-8')) as {
      builds: { version: string; commit: string; artifact: string; builtAt: string }[]
    }
    expect(manifest.builds).toHaveLength(1)
    expect(manifest.builds[0].version).toBe('0.2.0')
    expect(manifest.builds[0].commit).toBe(headCommit())
    expect(manifest.builds[0].artifact).toBe('Solo CRM-Setup-0.2.0.exe')
    expect(Number.isNaN(Date.parse(manifest.builds[0].builtAt))).toBe(false)
  })

  // release/ is gitignored and routinely deleted wholesale; record must not
  // need it to already exist.
  it('creates the release directory if it is not there', () => {
    rmSync(releaseDir(), { recursive: true, force: true })

    expect(run('record').status).toBe(0)
    expect(existsSync(join(releaseDir(), 'build-manifest.json'))).toBe(true)
  })

  it('keeps one entry per version and preserves the others', () => {
    expect(run('record').status).toBe(0)
    writePackage('0.3.0')
    expect(run('record').status).toBe(0)
    expect(run('record').status).toBe(0)

    const manifest = JSON.parse(readFileSync(join(releaseDir(), 'build-manifest.json'), 'utf-8')) as {
      builds: { version: string }[]
    }
    expect(manifest.builds.map((b) => b.version)).toEqual(['0.3.0', '0.2.0'])
  })

  // T-260831-02: a build that writes two files has to record two, or the next
  // check reads a version stamped with half of what shipped.
  it('records every artifact a multi-target build writes', () => {
    writeTwoTargetPackage()
    const { status, output } = run('record')
    expect(status).toBe(0)
    expect(output).toContain(`(${NSIS_ARTIFACT}, ${ZIP_ARTIFACT})`)

    const manifest = JSON.parse(readFileSync(join(releaseDir(), 'build-manifest.json'), 'utf-8')) as {
      builds: { version: string; commit: string; artifacts?: string[]; artifact?: string }[]
    }
    expect(manifest.builds[0].artifacts).toEqual([NSIS_ARTIFACT, ZIP_ARTIFACT])
    expect(manifest.builds[0].artifact).toBeUndefined()
    expect(manifest.builds[0].commit).toBe(headCommit())
  })

  // Entries for other versions were written by builds that already happened;
  // rewriting them into a new shape would falsify the record.
  it('leaves a pre-migration entry for another version exactly as it found it', () => {
    const legacy = {
      version: '0.1.0',
      commit: 'deadbee',
      dirty: false,
      builtAt: '2026-08-31T23:58:11.066Z',
      artifact: 'Solo CRM-Setup-0.1.0.exe'
    }
    writeManifest([legacy])

    expect(run('record').status).toBe(0)

    const manifest = JSON.parse(readFileSync(join(releaseDir(), 'build-manifest.json'), 'utf-8')) as {
      builds: Record<string, unknown>[]
    }
    expect(manifest.builds[1]).toEqual(legacy)
  })
})

/**
 * T-260831-02. `release/` is gitignored, so the manifests this reads on real
 * machines were written before the shape widened — one such 0.4.0 entry exists
 * on the machine this task was built on. A reader that quietly fails to
 * understand them reports "nothing was built here", which is the one answer
 * the guard must never give wrongly.
 */
describe('release-version and a pre-migration manifest', () => {
  /** The exact shape `record` wrote before T-260831-02. */
  function legacyEntry(commit: string): Record<string, unknown> {
    return {
      version: '0.2.0',
      commit,
      dirty: true,
      builtAt: '2026-08-31T23:58:11.066Z',
      artifact: NSIS_ARTIFACT
    }
  }

  it('reads a singular-artifact entry and still honours its commit', () => {
    writeFileSync(join(releaseDir(), NSIS_ARTIFACT), 'installer')
    writeManifest([legacyEntry(headCommit())])

    const { status, output } = run('check')
    expect(status).toBe(0)
    expect(output).not.toContain('not readable JSON')
  })

  it('still refuses when that singular entry names a different commit', () => {
    writeFileSync(join(releaseDir(), NSIS_ARTIFACT), 'installer')
    writeManifest([legacyEntry('deadbee')])

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain('was built from commit deadbee (dirty tree)')
  })

  // The commit binds through the widened guard too, not just the single-target
  // path it was written for.
  it('honours a singular entry against a multi-target build', () => {
    writeTwoTargetPackage()
    writeFileSync(join(releaseDir(), ZIP_ARTIFACT), 'archive')
    writeManifest([legacyEntry('deadbee')])

    const { status, output } = run('check')
    expect(status).toBe(1)
    expect(output).toContain(ZIP_ARTIFACT)
    expect(output).toContain('deadbee')
  })
})

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
    version: string
    scripts: Record<string, string>
  }

  // The guard only guards if `dist` runs it. A `dist` that calls
  // electron-builder directly is the state this task started from.
  it('runs the guard before electron-builder and the stamp after it', () => {
    const dist = pkg.scripts.dist
    const check = dist.indexOf('release-version.mjs check')
    const builder = dist.indexOf('electron-builder')
    const record = dist.indexOf('release-version.mjs record')

    expect(check, 'dist does not check').toBeGreaterThan(-1)
    expect(record, 'dist does not record').toBeGreaterThan(-1)
    expect(check).toBeLessThan(builder)
    expect(builder).toBeLessThan(record)
  })

  // 0.1.0 is the scaffolded value that never moved and produced the collision.
  it('has been bumped off the scaffolded version', () => {
    expect(pkg.version).not.toBe('0.1.0')
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
