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
// artifact — and `check` refuses to build when the artifact for the current
// version is already on disk and was built from a *different* commit. Building
// the same commit again is normal iteration and is allowed; it overwrites its
// own output.
//
// The manifest lives in `release/`, which is gitignored, so it describes the
// artifacts actually sitting beside it on this machine and nothing else. A
// clean checkout has neither, and the guard correctly has nothing to say.
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

/** Reads package.json's version and the electron-builder config it needs. */
function readPackage(projectRoot) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
  return {
    version: pkg.version,
    productName: pkg.build?.productName ?? pkg.name,
    outputDir: pkg.build?.directories?.output ?? 'dist',
    artifactName: pkg.build?.nsis?.artifactName ?? '${productName}-Setup-${version}.${ext}'
  }
}

/**
 * The file name electron-builder will write, resolved from the same
 * `artifactName` template it uses — so changing that template in package.json
 * moves the guard with it rather than leaving it watching a stale path.
 * Only the three placeholders this project's template uses are substituted;
 * anything else is left alone and reported, because guessing at an
 * unsubstituted placeholder would silently watch the wrong file.
 */
function artifactFileName({ productName, version, artifactName }, ext = 'exe') {
  const substituted = artifactName
    .replaceAll('${productName}', productName)
    .replaceAll('${version}', version)
    .replaceAll('${ext}', ext)
  const leftover = substituted.match(/\$\{[^}]*\}/)
  if (leftover) {
    throw new Error(
      `release-version: cannot resolve nsis.artifactName — ${leftover[0]} is not a placeholder ` +
        `this guard knows how to substitute. Teach scripts/release-version.mjs about it, ` +
        `or the overwrite guard is watching a file name that is never written.`
    )
  }
  return substituted
}

/** `{ commit, dirty }` for the tree being built. */
function gitState(projectRoot) {
  const git = (args) => execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' }).trim()
  return {
    commit: git(['rev-parse', '--short', 'HEAD']),
    dirty: git(['status', '--porcelain']).length > 0
  }
}

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
 */
function decide({ version, artifact, artifactExists, manifest, commit }) {
  if (!artifactExists) return { ok: true }

  const previous = manifest.builds.find((b) => b.version === version)
  if (!previous) {
    return {
      ok: false,
      reason:
        `release/${artifact} already exists, and no build-manifest.json entry says which commit ` +
        `produced it. Building now would overwrite an installer of unknown provenance under the ` +
        `same version. Bump "version" in package.json, or delete that artifact if you know it is ` +
        `disposable.`
    }
  }

  if (previous.commit === commit) return { ok: true }

  return {
    ok: false,
    reason:
      `release/${artifact} was built from commit ${previous.commit}${previous.dirty ? ' (dirty tree)' : ''}` +
      ` and HEAD is ${commit}. Two different commits must not share one installer file name or one ` +
      `DisplayVersion. Bump "version" in package.json before building.`
  }
}

function ensureReleaseDir(releaseDir) {
  mkdirSync(releaseDir, { recursive: true })
}

function check() {
  const pkg = readPackage(root)
  const releaseDir = join(root, pkg.outputDir)
  const artifact = artifactFileName(pkg)
  const { commit, dirty } = gitState(root)

  const verdict = decide({
    version: pkg.version,
    artifact,
    artifactExists: existsSync(join(releaseDir, artifact)),
    manifest: readManifest(releaseDir),
    commit
  })

  if (!verdict.ok) {
    console.error(`\n  Refusing to build.\n\n  ${verdict.reason}\n`)
    process.exitCode = 1
    return
  }

  const note = dirty ? ' (working tree is dirty; this build is not reproducible from a commit)' : ''
  console.log(`release-version: building ${pkg.version} from ${commit}${note} -> ${artifact}`)
}

function record() {
  const pkg = readPackage(root)
  const releaseDir = join(root, pkg.outputDir)
  const artifact = artifactFileName(pkg)
  const { commit, dirty } = gitState(root)

  ensureReleaseDir(releaseDir)
  const manifest = readManifest(releaseDir)
  const entry = { version: pkg.version, commit, dirty, builtAt: new Date().toISOString(), artifact }
  const builds = [entry, ...manifest.builds.filter((b) => b.version !== pkg.version)]

  writeFileSync(join(releaseDir, MANIFEST_NAME), `${JSON.stringify({ builds }, null, 2)}\n`, 'utf-8')
  console.log(`release-version: recorded ${pkg.version} <- ${commit} (${artifact})`)
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
