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

const problems = []

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
    tasks.set(id, { status, file: name })
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
