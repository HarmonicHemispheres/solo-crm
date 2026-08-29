#!/usr/bin/env node
// Produce the metadata block for a run summary from the agent transcripts the
// orchestration left behind — who ran, on what model, for how long, at what
// token cost, and where the wall clock went.
//
// Written because that block is exactly the part of a summary a human should
// never hand-type: it is a dozen numbers, every one of them checkable, and a
// summary that guesses at them is worse than one that omits them.
//
//   node scripts/run-report.mjs                  # every workflow in this session
//   node scripts/run-report.mjs wf_67a2b1a0-b10  # one run
//   node scripts/run-report.mjs --markdown       # paste-ready summary block
//
// The transcript root can be overridden with CLAUDE_TRANSCRIPT_DIR for a
// different session or machine.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

const args = process.argv.slice(2)
const markdown = args.includes('--markdown')
const wanted = args.filter((a) => !a.startsWith('--'))

function transcriptRoot() {
  if (process.env.CLAUDE_TRANSCRIPT_DIR) return process.env.CLAUDE_TRANSCRIPT_DIR
  const projects = join(homedir(), '.claude', 'projects')
  if (!existsSync(projects)) return null
  // The most recently touched session for this project directory.
  const slug = process.cwd().replace(/[:\\/]+/g, '-').replace(/^-+/, '')
  const candidates = readdirSync(projects)
    .filter((n) => n.toLowerCase().includes(basename(process.cwd()).toLowerCase()))
    .map((n) => join(projects, n))
  for (const dir of candidates) {
    const sessions = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(dir, e.name, 'subagents', 'workflows'))
      .filter(existsSync)
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (sessions.length) return sessions[0]
  }
  void slug
  return null
}

const ROOT = transcriptRoot()
if (!ROOT || !existsSync(ROOT)) {
  console.error('No workflow transcripts found. Set CLAUDE_TRANSCRIPT_DIR to the')
  console.error('session\'s subagents/workflows directory.')
  process.exit(1)
}

/** One command's shell classification — coarse on purpose; the point is where time goes. */
function classify(raw) {
  let c = raw.replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '')
    if (next === c) break
    c = next
  }
  if (/npm\s+(run\s+)?test\b(?!:)/.test(c)) return 'full suite'
  if (/npm\s+run\s+test:unit/.test(c)) return 'fast pool'
  // Order matters: a named file wins over a project filter, and an invocation
  // carrying neither is the one the preamble forbids. Distinguishing these is
  // the whole point — a scoped run reported as unscoped makes a compliant agent
  // look like a wasteful one, which it did on this script's first outing.
  if (/vitest[^|]*\.(test|spec)\.[jt]sx?/.test(c)) return 'targeted tests'
  if (/vitest[^|]*--project/.test(c)) return 'scoped tests (--project)'
  if (/vitest/.test(c)) return 'vitest (UNSCOPED — see preamble)'
  if (/typecheck|tsc\s+-p|tsc\s+--noEmit/.test(c)) return 'typecheck'
  if (/npm\s+run\s+lint|eslint/.test(c)) return 'lint'
  if (/^git\s/.test(c)) return 'git'
  if (/^(cat|sed|head|tail|grep|rg|ls|find|wc|stat)\b/.test(c)) return 'reading the repo'
  return 'other'
}

function readRun(dir) {
  const agents = []
  for (const file of readdirSync(dir)) {
    if (!file.startsWith('agent-') || !file.endsWith('.jsonl')) continue
    const events = readFileSync(join(dir, file), 'utf8').trim().split('\n')
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
    if (events.length < 2) continue

    const prompt = typeof events[0].message?.content === 'string' ? events[0].message.content : ''
    const stage = /^Run the verify/.test(prompt) ? 'verify'
      : /^Review the diff/.test(prompt) ? 'review'
      : /^Implement the task/.test(prompt) ? 'build'
      : 'other'
    const task = (prompt.match(/T-\d{6}-\d{2}/) || ['—'])[0]

    let model = ''
    let effort = ''
    let platform = ''
    const usage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }
    for (const e of events) {
      if (e.type !== 'assistant') continue
      model ||= e.message?.model || ''
      effort ||= e.effort || ''
      platform ||= e.version ? `claude-code ${e.version}` : ''
      const u = e.message?.usage
      if (!u) continue
      usage.input += u.input_tokens || 0
      usage.output += u.output_tokens || 0
      usage.cacheWrite += u.cache_creation_input_tokens || 0
      usage.cacheRead += u.cache_read_input_tokens || 0
    }

    const stamps = events.map((e) => e.timestamp).filter(Boolean).map((t) => new Date(t).getTime())
    const start = Math.min(...stamps)
    const end = Math.max(...stamps)

    const shell = {}
    let toolWait = 0
    for (let i = 0; i < events.length - 1; i++) {
      const content = events[i].message?.content
      if (!Array.isArray(content)) continue
      const call = content.find((b) => b.type === 'tool_use')
      if (!call) continue
      const gap = (new Date(events[i + 1].timestamp) - new Date(events[i].timestamp)) / 1000
      if (!(gap >= 0) || gap > 3600) continue
      toolWait += gap
      if (call.name !== 'Bash' && call.name !== 'PowerShell') continue
      const bucket = classify(String(call.input?.command || ''))
      shell[bucket] = (shell[bucket] || 0) + gap
    }

    agents.push({ task, stage, model, effort, platform, usage, start, end, secs: (end - start) / 1000, toolWait, shell })
  }
  return agents
}

const runs = readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((n) => !wanted.length || wanted.includes(n))

if (!runs.length) {
  console.error(`No runs matched. Available: ${readdirSync(ROOT).join(', ')}`)
  process.exit(1)
}

const all = []
for (const run of runs) all.push(...readRun(join(ROOT, run)).map((a) => ({ ...a, run })))
if (!all.length) {
  console.error('No agent transcripts in those runs.')
  process.exit(1)
}

const sum = (xs, f) => xs.reduce((a, x) => a + f(x), 0)
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n))
const mins = (s) => `${(s / 60).toFixed(0)}m`
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 16)

const started = Math.min(...all.map((a) => a.start))
const ended = Math.max(...all.map((a) => a.end))
const models = [...new Set(all.map((a) => a.model).filter(Boolean))]
const platforms = [...new Set(all.map((a) => a.platform).filter(Boolean))]
const efforts = [...new Set(all.map((a) => `${a.stage}:${a.effort || '?'}`))].sort()

const shell = {}
for (const a of all) for (const [b, s] of Object.entries(a.shell)) shell[b] = (shell[b] || 0) + s
const shellTotal = sum(Object.values(shell), (x) => x)

if (markdown) {
  console.log('## Run metadata\n')
  console.log('| | |')
  console.log('|---|---|')
  console.log(`| Started | ${iso(started)} UTC |`)
  console.log(`| Ended | ${iso(ended)} UTC |`)
  console.log(`| Wall clock | ${mins((ended - started) / 1000)} |`)
  console.log(`| Platform | ${platforms.join(', ') || 'unknown'} |`)
  console.log(`| Models | ${models.join(', ')} |`)
  console.log(`| Effort by stage | ${efforts.join(' · ')} |`)
  console.log(`| Subagents | ${all.length} (${all.filter((a) => a.stage === 'build').length} build · ${all.filter((a) => a.stage === 'verify').length} verify · ${all.filter((a) => a.stage === 'review').length} review) |`)
  console.log(`| Tokens in | ${k(sum(all, (a) => a.usage.input))} (cache read ${k(sum(all, (a) => a.usage.cacheRead))}, written ${k(sum(all, (a) => a.usage.cacheWrite))}) |`)
  console.log(`| Tokens out | ${k(sum(all, (a) => a.usage.output))} |`)
  console.log(`| Agent-minutes | ${mins(sum(all, (a) => a.secs))}, of which ${mins(sum(all, (a) => a.toolWait))} waiting on tools |`)
  console.log('\n**Where the shell time went**\n')
  console.log('| Command type | minutes | share |')
  console.log('|---|---|---|')
  for (const [b, s] of Object.entries(shell).sort((x, y) => y[1] - x[1])) {
    console.log(`| ${b} | ${(s / 60).toFixed(0)} | ${((s / shellTotal) * 100).toFixed(0)}% |`)
  }
  process.exit(0)
}

console.log(`\nRuns: ${runs.join(', ')}`)
console.log(`Window: ${iso(started)} → ${iso(ended)} UTC (${mins((ended - started) / 1000)} wall clock)`)
console.log(`Platform: ${platforms.join(', ') || 'unknown'}`)
console.log(`Models: ${models.join(', ')}`)
console.log(`Effort: ${efforts.join(' · ')}`)
console.log(`\nSubagents: ${all.length}   agent-minutes ${mins(sum(all, (a) => a.secs))}   waiting on tools ${mins(sum(all, (a) => a.toolWait))} (${((sum(all, (a) => a.toolWait) / sum(all, (a) => a.secs)) * 100).toFixed(0)}%)`)
console.log(`Tokens: in ${k(sum(all, (a) => a.usage.input))} · out ${k(sum(all, (a) => a.usage.output))} · cache read ${k(sum(all, (a) => a.usage.cacheRead))} · cache written ${k(sum(all, (a) => a.usage.cacheWrite))}`)

console.log('\nBY STAGE      n   agent-min   out-tokens')
console.log('-'.repeat(46))
for (const stage of ['build', 'verify', 'review', 'other']) {
  const rs = all.filter((a) => a.stage === stage)
  if (!rs.length) continue
  console.log('  ' + stage.padEnd(10) + String(rs.length).padStart(3) +
    mins(sum(rs, (a) => a.secs)).padStart(11) + k(sum(rs, (a) => a.usage.output)).padStart(13))
}

console.log('\nSHELL TIME')
console.log('-'.repeat(46))
for (const [b, s] of Object.entries(shell).sort((x, y) => y[1] - x[1])) {
  console.log('  ' + b.padEnd(20) + mins(s).padStart(7) + ((s / shellTotal) * 100).toFixed(0).padStart(7) + '%')
}

console.log('\nBY TASK')
console.log('-'.repeat(46))
const byTask = {}
for (const a of all) (byTask[a.task] ||= []).push(a)
for (const [task, rs] of Object.entries(byTask).sort((x, y) => sum(y[1], (a) => a.secs) - sum(x[1], (a) => a.secs))) {
  console.log('  ' + task.padEnd(14) + mins(sum(rs, (a) => a.secs)).padStart(7) + '   ' +
    rs.map((a) => a.stage).sort().join(' '))
}
