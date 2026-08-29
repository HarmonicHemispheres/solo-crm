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

function writePackage(version: string): void {
  writeFileSync(
    join(fixture, 'package.json'),
    JSON.stringify({
      name: 'solo-crm',
      version,
      build: {
        productName: 'Solo CRM',
        directories: { output: 'release' },
        nsis: { artifactName: '${productName}-Setup-${version}.${ext}' }
      }
    }),
    'utf-8'
  )
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
