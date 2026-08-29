#!/usr/bin/env node
// Checks each month's INDEX.md against the task files beside it.
//
// .dev/README.md: "An index is a projection of the files beside it, so it can be
// rebuilt and is never the source of truth... When they disagree, the task files
// win." This script is that rule made mechanical.
//
// It CHECKS rather than regenerates on purpose. The indexes carry hand-written
// section groupings and prose ("Phase 1 — the spine", "the two blank pages")
// that make them readable, and a generator would flatten all of it to satisfy a
// consistency it can already verify without rewriting anything.
//
// Written because index drift has now slipped three times across two runs —
// twice caught by the user after the fact — despite the rule being stated in
// .dev/README.md, in the run-tasks skill, and in agent memory. Prose that has
// failed three times is not fixed by more prose.
//
// Exit 0 = index agrees with the task files. Exit 1 = drift, described.

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const TASKS_DIR = '.dev/tasks'

/** The status vocabulary from .dev/README.md. The icon never appears alone. */
const STATUS_ICONS = {
  open: '○',
  'in-progress': '◐',
  done: '●',
  blocked: '⛔',
  dropped: '✕'
}

function frontmatterField(source, field) {
  const match = source.match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))
  return match ? match[1].trim() : ''
}

/**
 * Task IDs whose work is already on this branch — the blind spot the file/index
 * comparison cannot see. When both the task file and the index say
 * `in-progress` they agree, so the check above passes while the work has in
 * fact shipped. Six wave-E tasks sat like that until the user asked.
 *
 * The signal is the merge commit's subject, which run-tasks writes as
 * `Merge T-260828-31: …`. Deliberately NOT `git branch --merged`: a branch
 * freshly cut from main's tip is an ancestor of HEAD and so counts as merged
 * while having contributed nothing, which flagged all five in-flight wave-F
 * tasks the first time this ran. A task that lands as a fast-forward with no
 * merge commit is invisible here — accepted, because this is a second net
 * under the file/index comparison, not the only one.
 */
function mergedTaskIds() {
  const ids = new Set()
  const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  try {
    for (const subject of git(['log', '--format=%s', '--merges']).split('\n')) {
      const match = subject.match(/^Merge (T-\d{6}-\d{2})\b/)
      if (match) ids.add(match[1])
    }
  } catch {
    // Not a git checkout, or git is unavailable. The file/index comparison
    // still runs; this check simply has nothing to say.
  }
  return ids
}

const problems = []
const merged = mergedTaskIds()

const months = existsSync(TASKS_DIR)
  ? readdirSync(TASKS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  : []

for (const month of months) {
  const dir = join(TASKS_DIR, month)
  const indexPath = join(dir, 'INDEX.md')
  if (!existsSync(indexPath)) {
    problems.push(`${dir}: no INDEX.md beside the task files`)
    continue
  }

  // What the task files say.
  const tasks = new Map()
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('T-') || !name.endsWith('.md')) continue
    const source = readFileSync(join(dir, name), 'utf8')
    const id = frontmatterField(source, 'id')
    const status = frontmatterField(source, 'status')
    if (!id) { problems.push(`${join(dir, name)}: no id in frontmatter`); continue }
    if (!(status in STATUS_ICONS)) {
      problems.push(`${id}: status "${status}" is not one of ${Object.keys(STATUS_ICONS).join(', ')} (.dev/README.md)`)
      continue
    }
    tasks.set(id, { status, file: name, source })
  }

  // A task file that is itself stale. The comparison below only catches the
  // index and the file disagreeing; these catch the file being wrong.
  for (const [id, task] of tasks) {
    if (merged.has(id) && task.status !== 'done' && task.status !== 'dropped') {
      problems.push(
        `${id}: merged into this branch, but ${task.file} still says "${task.status}" — ` +
          'close it with an Outcome, a closed date, and a done row'
      )
    }
    if (task.status !== 'done') continue
    if (!frontmatterField(task.source, 'closed')) {
      problems.push(`${id}: status done in ${task.file} with no "closed:" date`)
    }
    if (!/^##\s+Outcome\s*$/m.test(task.source)) {
      problems.push(`${id}: status done in ${task.file} with no "## Outcome" section — what shipped is unrecorded`)
    }
  }

  // What the index says. Rows look like: | ● done | [T-260828-20](file.md) | ...
  const rows = new Map()
  const indexSource = readFileSync(indexPath, 'utf8')
  for (const line of indexSource.split('\n')) {
    const match = line.match(/^\|\s*([○◐●⛔✕])\s+([a-z-]+)\s*\|\s*\[(T-\d{6}-\d{2})\]/)
    if (!match) continue
    const [, icon, word, id] = match
    if (rows.has(id)) {
      problems.push(`${id}: appears more than once in ${indexPath} — a duplicate row left behind by a status move`)
      continue
    }
    rows.set(id, { icon, word })
  }

  for (const [id, task] of tasks) {
    const row = rows.get(id)
    if (!row) {
      problems.push(`${id}: status "${task.status}" in ${task.file}, but no row in ${indexPath}`)
      continue
    }
    if (row.word !== task.status) {
      problems.push(`${id}: "${task.status}" in ${task.file}, but "${row.word}" in ${indexPath} — the task file wins`)
    }
    if (row.icon !== STATUS_ICONS[task.status]) {
      problems.push(`${id}: index icon "${row.icon}" does not match status "${task.status}" (expected "${STATUS_ICONS[task.status]}")`)
    }
  }

  for (const id of rows.keys()) {
    if (!tasks.has(id)) problems.push(`${id}: a row in ${indexPath} with no task file beside it`)
  }
}

if (problems.length) {
  console.error(`Task index drift — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nThe task files are the source of truth. Fix the index to match.')
  process.exit(1)
}

console.log(`Task indexes agree with their task files (${months.length} month${months.length === 1 ? '' : 's'}).`)
