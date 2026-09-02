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


// Two tasks scoped in parallel both pick "the next free ADR number", because
// each looked at a main where it was free. Their filenames differ, so git
// merges both without a conflict and nothing downstream complains — you end up
// with two ADR-009s, and every code comment citing ADR-009 becomes ambiguous
// rather than wrong, which is the harder kind to notice. T-260828-46 and
// T-260828-51 did exactly this in run R-260828-03.
//
// Checked here rather than in a new script because this one already runs at
// every turn that leaves the tree dirty (the Stop hook) and in `verify`.

// Every run id a closed task points at must have a summary to point at.
//
// A task's Run column is the only link from "this shipped" to "here is what the
// run decided, what went wrong, and what it cost". Nothing checked that the
// target existed, and it did not: thirty closed tasks cited R-260828-02 while
// `.dev/summaries/202608/` held only R-260828-01. The summary had been planned,
// the run had happened, and the step was simply never taken — invisibly,
// because every other gate was green.
//
// Checked here for the same reason as the ADR collision above: this script
// already runs from the Stop hook and in `verify`.
const SUMMARIES_DIR = '.dev/summaries'
for (const month of months) {
  const indexPath = join(TASKS_DIR, month, 'INDEX.md')
  if (!existsSync(indexPath)) continue

  const summaryDir = join(SUMMARIES_DIR, month)
  const summaries = existsSync(summaryDir)
    ? new Set(readdirSync(summaryDir).filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, '')))
    : new Set()

  const cited = new Set()
  for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
    for (const match of line.matchAll(/\bR-\d{6}-\d{2}\b/g)) cited.add(match[0])
  }

  for (const runId of [...cited].sort()) {
    if (!summaries.has(runId)) {
      problems.push(
        `${runId}: cited by ${month}'s task index but ${join(summaryDir, `${runId}.md`)} does not exist — the tasks say they shipped in a run that has no record of what it decided or what went wrong`
      )
    }
  }
}

const DECISIONS_DIR = '.dev/decisions'
if (existsSync(DECISIONS_DIR)) {
  const byNumber = new Map()
  for (const name of readdirSync(DECISIONS_DIR).filter((n) => n.endsWith('.md'))) {
    const path = join(DECISIONS_DIR, name)
    const declared = frontmatterField(readFileSync(path, 'utf8'), 'id')
    const fromName = name.match(/^(ADR-\d+)/)?.[1]

    // The filename is what a reader greps for and what a link resolves to, so
    // a file whose frontmatter disagrees with its own name is its own defect.
    if (declared && fromName && declared !== fromName) {
      problems.push(`${path}: frontmatter says "${declared}" but the filename says "${fromName}"`)
    }
    const id = fromName ?? declared
    if (!id) {
      problems.push(`${path}: no ADR number in the filename or the frontmatter`)
      continue
    }
    byNumber.set(id, [...(byNumber.get(id) ?? []), name])
  }

  for (const [id, names] of byNumber) {
    if (names.length > 1) {
      problems.push(
        `${id}: claimed by ${names.length} files (${names.join(', ')}) — two decisions with one number, so every citation of ${id} is ambiguous. Renumber the later one and update its references.`
      )
    }
  }
}

// LESSONS.md holds at most twenty lines (ADR-016). The cap is the mechanism:
// a lesson that cannot displace an old one was not worth keeping, and one that
// can be a check should have become one instead of a line here.
const LESSONS = '.dev/LESSONS.md'
const LESSONS_CAP = 20
if (existsSync(LESSONS)) {
  const count = readFileSync(LESSONS, 'utf8').split('\n').filter((l) => /^\d+\.\s/.test(l)).length
  if (count > LESSONS_CAP) {
    problems.push(`${LESSONS}: ${count} lessons, cap is ${LESSONS_CAP} — turn one into a check or displace the least useful`)
  }
}

if (problems.length) {
  console.error(`Task index drift — ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n`)
  for (const problem of problems) console.error(`  ${problem}`)
  console.error('\nThe task files are the source of truth. Fix the index to match.')
  process.exit(1)
}

console.log(`Task indexes agree with their task files (${months.length} month${months.length === 1 ? '' : 's'}).`)
