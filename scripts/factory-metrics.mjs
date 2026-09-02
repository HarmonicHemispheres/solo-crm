#!/usr/bin/env node
// The three numbers that judge the process (ADR-016): per release, tasks
// closed, how many were follow-up fixes to earlier work, and the median
// elapsed minutes from task outcomes. Plus tasks whose Why says the user
// reported it, since that is the cost the operator actually feels.
//
//   node scripts/factory-metrics.mjs
//
// Releases are the `Release x.y.z` commits on the current branch. "Follow-up"
// is a heuristic over the task's title and Why — it will miscount by one or
// two, which is fine for a trend and wrong for an audit.

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const TASKS = '.dev/tasks'
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

const releases = git(['log', '--format=%ad %s', '--date=short', '--reverse'])
  .split('\n')
  .map((l) => l.match(/^(\d{4}-\d{2}-\d{2}) Release (\S+)/))
  .filter(Boolean)
  .map((m) => ({ date: m[1], version: m[2] }))

const tasks = []
if (existsSync(TASKS)) {
  for (const month of readdirSync(TASKS)) {
    const dir = join(TASKS, month)
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('T-') || !name.endsWith('.md')) continue
      const src = readFileSync(join(dir, name), 'utf8')
      const field = (f) => src.match(new RegExp(`^${f}:\\s*(.*)$`, 'm'))?.[1].trim() ?? ''
      if (field('status') !== 'done') continue
      const head = src.split(/^## Outcome/m)[0]
      const why = head.match(/## Why([\s\S]*?)(?:\n## |$)/)?.[1] ?? ''
      const title = field('title')
      tasks.push({
        id: field('id'),
        closed: field('closed'),
        followUp: /follow-?up|regress|review fix|dead |broken|still |actually|hardening|stabilis/i.test(title + ' ' + why),
        reported: /\breported\b/i.test(why),
        elapsed: Number(src.match(/\*\*Elapsed:\*\*\s*(\d+)/)?.[1]) || null
      })
    }
  }
}

function median(xs) {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2)
}

const windows = []
let prev = '0000-00-00'
for (const r of releases) {
  windows.push({ label: r.version, from: prev, to: r.date })
  prev = r.date
}
windows.push({ label: 'since last release', from: prev, to: '9999-99-99' })

console.log('| Release | Closed | Follow-up fixes | User-reported | Median elapsed (min) |')
console.log('|---|---|---|---|---|')
for (const w of windows) {
  // A task closed on release day counts toward that release.
  const inWindow = tasks.filter((t) => t.closed > w.from && t.closed <= w.to)
  if (!inWindow.length && w.label !== 'since last release') continue
  const fu = inWindow.filter((t) => t.followUp).length
  const rep = inWindow.filter((t) => t.reported).length
  const med = median(inWindow.map((t) => t.elapsed).filter(Boolean))
  console.log(`| ${w.label} | ${inWindow.length} | ${fu} (${inWindow.length ? Math.round((100 * fu) / inWindow.length) : 0}%) | ${rep} | ${med ?? '—'} |`)
}
