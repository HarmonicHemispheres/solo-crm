#!/usr/bin/env node
// A Stop hook: when a turn ends with source files dirty, run the cheap
// whole-tree checks and refuse to end the turn until they pass.
//
// The previous process told agents to run these in three documents and a
// 145-line preamble, and they were still skipped or misreported ("typecheck
// clean" on a branch that did not compile). A hook does not decay with
// context length and cannot be paraphrased. ADR-016.
//
// What runs, and why only these: typecheck (~6s) and lint (~11s) catch the
// most per second and are unambiguous; check:index (<1s) keeps the task record
// true. Tests are not here — which tests cover a change is a judgement, and
// the full suite is ~100s, which is too slow for every turn. `verify` owns
// tests.
//
// Exit 0: nothing to say. Exit 2: stderr goes back to the agent and the turn
// does not end. Never exit 1: a crash in a hook must not read as a failed
// check. Claude Code stops re-running a blocking Stop hook after eight
// consecutive blocks, so a check that cannot pass is bounded.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

async function stdinJson() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

const payload = (await stdinJson()) ?? {}
const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd()
if (!existsSync(join(cwd, 'package.json'))) process.exit(0)

let status = ''
try {
  status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  })
} catch {
  process.exit(0) // not a git checkout; nothing to gate
}

const paths = status
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).trim().replace(/^"|"$/g, ''))
  .map((p) => (p.includes(' -> ') ? p.split(' -> ')[1] : p))

const isSource = (p) =>
  /^(electron|src|scripts)\//.test(p) || /^(package\.json|tsconfig[^/]*\.json|eslint\.config\.[cm]?js|vitest\.config\.[cm]?ts)$/.test(p)
const isRecord = (p) => p.startsWith('.dev/')

const sourceDirty = paths.some(isSource)
const recordDirty = paths.some(isRecord)
if (!sourceDirty && !recordDirty) process.exit(0)

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const failures = []

function run(label, args) {
  const result = spawnSync(npm, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.status !== 0) {
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    // Keep the tail: the first lines of a tsc or eslint run are the command
    // echo, the last are the errors.
    const tail = out.split('\n').slice(-40).join('\n')
    failures.push(`--- ${label} (exit ${result.status ?? 'signal'}) ---\n${tail}`)
  }
}

if (sourceDirty) {
  run('npm run typecheck', ['run', 'typecheck'])
  run('npm run lint', ['run', 'lint'])
}
run('npm run check:index', ['run', 'check:index'])

if (!failures.length) process.exit(0)

console.error(
  'The tree is dirty and a check fails. Fix it before ending the turn, or say\n' +
    'plainly that it is failing and why. Do not weaken the check.\n\n' +
    failures.join('\n\n')
)
process.exit(2)
