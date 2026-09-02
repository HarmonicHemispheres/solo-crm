#!/usr/bin/env node
// Remove agent worktrees whose branch is merged and whose tree is clean.
//
//   node scripts/cleanup-worktrees.mjs            report only
//   node scripts/cleanup-worktrees.mjs --apply    remove what is safe
//
// Why not `git worktree remove`: on Windows each worktree's node_modules is a
// junction to the main checkout's install, and both `git worktree remove` and
// a recursive delete follow it — deleting node_modules for every checkout on
// the machine. The junction is removed first with a non-recursive rmdir,
// confirmed gone, and only then is the directory deleted. ADR-016.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const APPLY = process.argv.includes('--apply')
const git = (args, opts = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()

const root = resolve(git(['rev-parse', '--show-toplevel']))
const merged = new Set(
  git(['branch', '--merged', 'main', '--format=%(refname:short)'])
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
)

// --- enumerate worktrees --------------------------------------------------
const entries = []
let current = null
for (const line of git(['worktree', 'list', '--porcelain']).split('\n')) {
  if (line.startsWith('worktree ')) {
    current = { path: resolve(line.slice(9)), branch: null, prunable: false }
    entries.push(current)
  } else if (line.startsWith('branch ') && current) {
    current.branch = line.slice(7).replace(/^refs\/heads\//, '')
  } else if (line.startsWith('prunable') && current) {
    current.prunable = true
  }
}

function dirSize(dir) {
  let total = 0
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) continue // never follow a junction
      if (st.isDirectory()) walk(p)
      else total += st.size
    }
  }
  try {
    walk(dir)
  } catch {
    /* partial is fine for a report */
  }
  return total
}

function findLinks(dir, depth = 2) {
  const links = []
  const walk = (d, left) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      const st = lstatSync(p)
      if (st.isSymbolicLink()) links.push(p)
      else if (st.isDirectory() && left > 0) walk(p, left - 1)
    }
  }
  walk(dir, depth)
  return links
}

function unlinkJunction(p) {
  if (process.platform === 'win32') {
    const r = spawnSync('cmd', ['/c', 'rmdir', p], { encoding: 'utf8' })
    if (r.status !== 0) throw new Error(`rmdir ${p}: ${r.stderr || r.stdout}`)
  } else {
    rmSync(p) // a symlink; rmSync without recursive unlinks it
  }
  if (existsSync(p)) throw new Error(`${p} still exists after unlink`)
}

// --- decide ---------------------------------------------------------------
const report = []
let freed = 0
for (const wt of entries) {
  if (wt.path === root) continue
  const present = existsSync(wt.path)
  const dirty = present ? git(['status', '--porcelain'], { cwd: wt.path }) : ''
  const isMerged = wt.branch ? merged.has(wt.branch) : false
  const safe = !present || (isMerged && dirty === '')
  const size = present ? dirSize(wt.path) : 0
  report.push({ wt, present, isMerged, dirty: dirty !== '', safe, size })
}

for (const r of report) {
  const why = !r.present ? 'directory gone' : !r.isMerged ? 'NOT merged' : r.dirty ? 'DIRTY' : 'merged, clean'
  console.log(`${r.safe ? 'remove' : 'keep  '}  ${r.wt.branch ?? '(detached)'}  ${(r.size / 1e6).toFixed(0)} MB  ${why}  ${r.wt.path}`)
}

if (!APPLY) {
  console.log(`\n${report.filter((r) => r.safe).length} removable, ${report.filter((r) => !r.safe).length} kept. Re-run with --apply.`)
  process.exit(0)
}

// --- apply ----------------------------------------------------------------
for (const r of report.filter((r) => r.safe && r.present)) {
  const links = findLinks(r.wt.path)
  for (const link of links) unlinkJunction(link)
  const remaining = findLinks(r.wt.path, 4)
  if (remaining.length) throw new Error(`refusing to delete ${r.wt.path}: links remain ${remaining.join(', ')}`)
  rmSync(r.wt.path, { recursive: true, force: true })
  freed += r.size
  console.log(`removed ${r.wt.path}`)
}
git(['worktree', 'prune'])

const deleted = []
for (const branch of merged) {
  if (!/^T-\d{6}-\d{2}$/.test(branch)) continue
  const r = spawnSync('git', ['branch', '-d', branch], { encoding: 'utf8' })
  if (r.status === 0) deleted.push(branch)
}

const leftover = join(root, '.claude', 'worktrees')
if (existsSync(leftover) && readdirSync(leftover).length === 0) rmSync(leftover, { recursive: true })

console.log(`\nfreed ${(freed / 1e6).toFixed(0)} MB, deleted ${deleted.length} merged task branches${deleted.length ? ': ' + deleted.join(' ') : ''}`)
const kept = report.filter((r) => !r.safe)
if (kept.length) console.log(`kept ${kept.length}: ${kept.map((r) => r.wt.branch).join(' ')}`)
try {
  statSync(leftover)
} catch {
  /* gone */
}
