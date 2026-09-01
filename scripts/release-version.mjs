#!/usr/bin/env node
// T-260829-02: stops two different commits from being built into the same
// installer file name.
//
// The version in package.json is hand-bumped and is the only place a release
// gets its number (README.md, "Cutting a release"). Nothing derives it, so
// nothing stops a build from being cut without bumping it — and until this
// script existed, that build silently overwrote `release/Solo CRM-Setup-
// <version>.exe` with a different program under the same name, the same
// DisplayVersion, and no signal but the file timestamp.
//
// So the bump gets a gate. `npm run dist` runs:
//
//   node scripts/release-version.mjs check    before electron-builder
//   node scripts/release-version.mjs record   after it succeeds
//
// `record` writes release/build-manifest.json — version, commit, timestamp,
// artifact — and `check` refuses to build when an artifact for the current
// version is already on disk and was built from a *different* commit. Building
// the same commit again is normal iteration and is allowed; it overwrites its
// own output.
//
// T-260831-02: "an artifact" means every artifact `build.win.target`
// configures, not only the NSIS one. A guard watching one of two artifacts
// still prints its confident `building 0.4.0 from abc1234` line while the
// other is overwritten by a different commit — the exact failure this script
// exists to prevent, wearing a green tick. Silent success is this script's
// whole failure mode, so the two places it could guess, it refuses instead:
//
//   - a target it has no extension for. Defaulting `zip` to `exe` leaves the
//     guard watching a file that is never written, and "that file is not
//     there" is indistinguishable from "nothing was built here" — it passes,
//     every time, protecting nothing.
//   - a `${...}` placeholder it cannot substitute, per target, for the same
//     reason.
//
// The manifest lives in `release/`, which is gitignored, so it describes the
// artifacts actually sitting beside it on this machine and nothing else. A
// clean checkout has neither, and the guard correctly has nothing to say. It
// also means real machines hold entries written before this task, in the
// singular `artifact` shape — read as they are, `commit` and all, because a
// manifest the guard cannot read is a manifest the guard cannot enforce.
//
// This is not a substitute for reading the version: it is what makes the
// version trustworthy once read.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The project root. Overridable so the guard can be exercised against a
 * fixture tree in `release-version.test.ts` — every path below is derived
 * from it, and nothing else about the script changes.
 */
const root = process.env.SOLOCRM_PROJECT_ROOT
  ? resolve(process.env.SOLOCRM_PROJECT_ROOT)
  : resolve(here, '..')

const MANIFEST_NAME = 'build-manifest.json'

/**
 * What each Windows target writes, as electron-builder writes it.
 *
 * Both fields are read out of the installed app-builder-lib rather than
 * guessed. `defaultArtifactName` is the pattern a target falls back to when
 * nothing configures one: NsisTarget's `installerFilenamePattern()` is
 * `"${productName} " + (portable ? "" : "Setup ") + "${version}" + archSuffix
 * + ".${ext}"`, and ArchiveTarget's Windows branch is `"${productName}-
 * ${version}" + (arch === defaultArch ? "" : "-${arch}") + "-${os}.${ext}"`.
 * Both drop the arch suffix on the default arch, which is the only arch
 * `npm run dist` builds.
 *
 * A target that is not in this table is refused, not defaulted — see the
 * header. Adding one means reading its target class in app-builder-lib, not
 * pattern-matching on the name.
 */
const WINDOWS_TARGETS = {
  nsis: { ext: 'exe', defaultArtifactName: '${productName} Setup ${version}.${ext}' },
  portable: { ext: 'exe', defaultArtifactName: '${productName} ${version}.${ext}' },
  zip: { ext: 'zip', defaultArtifactName: '${productName}-${version}-${os}.${ext}' }
}

/**
 * The targets `electron-builder --win` will build. `build.win.target` is a
 * string, or a list of strings or `{ target }` objects — all three are shapes
 * electron-builder accepts, so all three are shapes this has to read.
 */
function windowsTargets(build) {
  const configured = build?.win?.target
  // Absent is electron-builder's Windows default, which is nsis — and is what
  // this guard watched before it read the list at all.
  if (configured === undefined || configured === null) return ['nsis']

  const names = (Array.isArray(configured) ? configured : [configured]).map((entry) =>
    typeof entry === 'string' ? entry : entry?.target
  )

  // An empty or malformed list would leave the guard with nothing to watch and
  // exit 0 — a success indistinguishable from having done its job.
  if (names.length === 0 || names.some((name) => typeof name !== 'string' || name === '')) {
    throw new Error(
      `release-version: build.win.target does not name a target (${JSON.stringify(configured)}). ` +
        `The overwrite guard would watch nothing and pass.`
    )
  }

  return [...new Set(names)]
}

/** Reads package.json's version and the electron-builder config it needs. */
function readPackage(projectRoot) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
  return {
    version: pkg.version,
    productName: pkg.build?.productName ?? pkg.name,
    outputDir: pkg.build?.directories?.output ?? 'dist',
    targets: windowsTargets(pkg.build),
    build: pkg.build ?? {}
  }
}

/**
 * electron-builder's own precedence for one target's name template, from
 * `artifactPatternConfig` in app-builder-lib's platformPackager: the target's
 * own `artifactName`, then the platform's, then the top-level one, then the
 * target's default. Reading only the first of those would leave a project that
 * sets `build.win.artifactName` guarded on a name nothing writes.
 */
function artifactNameTemplate(build, target) {
  return (
    build?.[target]?.artifactName ??
    build?.win?.artifactName ??
    build?.artifactName ??
    WINDOWS_TARGETS[target].defaultArtifactName
  )
}

/**
 * Every file name electron-builder will write, resolved from the same
 * `artifactName` templates it uses — so changing a template in package.json
 * moves the guard with it rather than leaving it watching a stale path.
 *
 * Only the placeholders this guard can resolve are substituted; anything else
 * is left alone and reported, because guessing at an unsubstituted placeholder
 * would silently watch the wrong file. `${arch}` is deliberately not one of
 * them: electron-builder drops it on the default arch and expands it
 * otherwise, so any single substitution here would be wrong half the time.
 */
function artifactFileNames({ productName, version, targets, build }) {
  const names = targets.map((target) => {
    if (!Object.hasOwn(WINDOWS_TARGETS, target)) {
      throw new Error(
        `release-version: build.win.target lists "${target}", which this guard has no file name or ` +
          `extension for. Teach scripts/release-version.mjs about it — guessing one would leave the ` +
          `overwrite guard watching a file that is never written, which passes every time.`
      )
    }

    const substituted = artifactNameTemplate(build, target)
      .replaceAll('${productName}', productName)
      .replaceAll('${version}', version)
      .replaceAll('${ext}', WINDOWS_TARGETS[target].ext)
      // `npm run dist` is `electron-builder --win`, so `${os}` is always win.
      .replaceAll('${os}', 'win')

    const leftover = substituted.match(/\$\{[^}]*\}/)
    if (leftover) {
      throw new Error(
        `release-version: cannot resolve ${target}.artifactName — ${leftover[0]} is not a placeholder ` +
          `this guard knows how to substitute. Teach scripts/release-version.mjs about it, ` +
          `or the overwrite guard is watching a file name that is never written.`
      )
    }
    return substituted
  })

  return [...new Set(names)]
}

/** `{ commit, dirty }` for the tree being built. */
function gitState(projectRoot) {
  const git = (args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' }).trim()
  return {
    commit: git(['rev-parse', '--short', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0
  }
}

/**
 * Entries are returned exactly as they sit on disk. Two shapes exist — the
 * singular `artifact` written before T-260831-02, and `artifacts` — and the
 * decision below reads neither: it turns on `version` and `commit`, which both
 * shapes carry. So an old manifest keeps binding without migration, and
 * `record` copies other versions' entries through untouched rather than
 * rewriting the record of a build that already happened.
 */
function readManifest(releaseDir) {
  const path = join(releaseDir, MANIFEST_NAME)
  if (!existsSync(path)) return { builds: [] }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return { builds: Array.isArray(parsed.builds) ? parsed.builds : [] }
  } catch {
    // A corrupt manifest must not be read as "nothing was built here" — that
    // is the exact state the guard exists to refuse.
    throw new Error(`release-version: ${path} is not readable JSON. Delete it, or delete release/.`)
  }
}

/**
 * The whole decision, as a function of facts rather than of the filesystem.
 * Returns `{ ok: true }` or `{ ok: false, reason }`.
 *
 * `present` is every configured artifact actually on disk. One is enough to
 * refuse: overwriting the second artifact ships the same lie as overwriting
 * the first.
 */
function decide({ version, present, manifest, commit }) {
  if (present.length === 0) return { ok: true }

  const many = present.length > 1
  const listed = present.map((artifact) => `release/${artifact}`).join(', ')

  const previous = manifest.builds.find((b) => b.version === version)
  if (!previous) {
    return {
      ok: false,
      reason:
        `${listed} ${many ? 'already exist' : 'already exists'}, and no build-manifest.json entry ` +
        `says which commit produced ${many ? 'them' : 'it'}. Building now would overwrite ` +
        `${many ? 'installers' : 'an installer'} of unknown provenance under the same version. ` +
        `Bump "version" in package.json, or delete ${many ? 'those artifacts' : 'that artifact'} ` +
        `if you know ${many ? 'they are' : 'it is'} disposable.`
    }
  }

  if (previous.commit === commit) return { ok: true }

  return {
    ok: false,
    reason:
      `${listed} ${many ? 'were' : 'was'} built from commit ${previous.commit}` +
      `${previous.dirty ? ' (dirty tree)' : ''} and HEAD is ${commit}. Two different commits must ` +
      `not share one installer file name or one DisplayVersion. Bump "version" in package.json ` +
      `before building.`
  }
}

function ensureReleaseDir(releaseDir) {
  mkdirSync(releaseDir, { recursive: true })
}

/**
 * One manifest entry. A build that writes exactly one artifact still records
 * it as singular `artifact`: that is the shape already sitting in `release/`
 * on every machine with build history, and it keeps the `nsis`-only config in
 * package.json today writing a manifest identical to the one it wrote before
 * this task. More than one artifact gets `artifacts`, because that is then the
 * fact being recorded — and `readManifest` reads both.
 */
function buildEntry({ version, commit, dirty, artifacts }) {
  const entry = { version, commit, dirty, builtAt: new Date().toISOString() }
  if (artifacts.length === 1) entry.artifact = artifacts[0]
  else entry.artifacts = artifacts
  return entry
}

function check() {
  const pkg = readPackage(root)
  const releaseDir = join(root, pkg.outputDir)
  const artifacts = artifactFileNames(pkg)
  const { commit, dirty } = gitState(root)

  const verdict = decide({
    version: pkg.version,
    present: artifacts.filter((artifact) => existsSync(join(releaseDir, artifact))),
    manifest: readManifest(releaseDir),
    commit
  })

  if (!verdict.ok) {
    console.error(`\n  Refusing to build.\n\n  ${verdict.reason}\n`)
    process.exitCode = 1
    return
  }

  const note = dirty ? ' (working tree is dirty; this build is not reproducible from a commit)' : ''
  const built = artifacts.join(', ')
  console.log(`release-version: building ${pkg.version} from ${commit}${note} -> ${built}`)
}

function record() {
  const pkg = readPackage(root)
  const releaseDir = join(root, pkg.outputDir)
  const artifacts = artifactFileNames(pkg)
  const { commit, dirty } = gitState(root)

  ensureReleaseDir(releaseDir)
  const manifest = readManifest(releaseDir)
  const builds = [
    buildEntry({ version: pkg.version, commit, dirty, artifacts }),
    ...manifest.builds.filter((b) => b.version !== pkg.version)
  ]

  writeFileSync(join(releaseDir, MANIFEST_NAME), `${JSON.stringify({ builds }, null, 2)}\n`, 'utf-8')
  console.log(`release-version: recorded ${pkg.version} <- ${commit} (${artifacts.join(', ')})`)
}

const COMMANDS = { check, record }

// Both commands are exercised end-to-end by `release-version.test.ts`, which
// spawns this file against a fixture root rather than importing it — the
// guard's whole job is its exit code, and that is what the test reads.
const command = process.argv[2]
const run = COMMANDS[command]
if (!run) {
  console.error(`release-version: expected "check" or "record", got ${JSON.stringify(command)}`)
  process.exitCode = 2
} else {
  try {
    run()
  } catch (error) {
    console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
