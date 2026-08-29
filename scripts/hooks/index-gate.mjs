#!/usr/bin/env node
// A PostToolUse hook: after any git commit or merge, check the task indexes.
//
// Why a hook rather than another line of documentation. The rule "close the task
// and update the index at its merge" was already written in three places — the
// run-tasks skill, .dev/README.md, and agent memory — and was skipped three
// times across two runs anyway. Instructions read at the start of a long session
// decay: they get compacted, they sit behind thousands of lines of newer
// context, and they lose to whatever is urgent right now. Nothing failed when
// the step was skipped, so nothing corrected it until a human read the index and
// asked what was still running.
//
// A hook does not decay. It fires at the moment the mistake is made — the merge
// commit that closes a task is the exact point the record should have been
// updated — and it reports through the one channel that cannot be scrolled past.
//
// Exit 0: nothing to say. Exit 2: stderr goes back to the agent as feedback.
// Deliberately never exit 1: an unexpected crash in a hook should not look like
// a policy failure.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const CHECKER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'check-task-index.mjs')

/** Commands that land or close work. A read-only git command is not one. */
const CLOSING = /\bgit\s+(?:-[^\s]+\s+)*(?:commit|merge|cherry-pick|revert)\b/

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

const payload = await stdinJson()
if (!payload) process.exit(0)

const command = payload?.tool_input?.command
if (typeof command !== 'string' || !CLOSING.test(command)) process.exit(0)

// A failed git command changed nothing, so there is nothing to check.
const response = payload.tool_response
if (response && (response.is_error === true || response.interrupted === true)) process.exit(0)

const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd()
if (!existsSync(join(cwd, '.dev', 'tasks'))) process.exit(0)

try {
  execFileSync(process.execPath, [CHECKER], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  process.exit(0)
} catch (error) {
  if (error.code === 'ENOENT') process.exit(0) // checker is gone; not this hook's problem to report
  const detail = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
  console.error(
    'Task index drift, caught at the commit that caused it:\n\n' +
      detail +
      '\n\nThe task files are the source of truth. Close the task properly — Outcome\n' +
      'section, closed: date, status: done, and the row moved in the month INDEX.md —\n' +
      'before moving on. Do not batch this to the end of the run; that is the habit\n' +
      'this hook exists to break.'
  )
  process.exit(2)
}
