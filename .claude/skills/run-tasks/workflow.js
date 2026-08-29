// Default fan-out for `run-tasks`. Pass the approved task IDs as `args`:
//
//   Workflow({ scriptPath: "<this file>", args: ["T-260828-41", "T-260828-46"] })
//
// or with per-task notes, when a task needs context its file cannot carry
// (what else is in flight, which file it owns this wave, a precedent to follow):
//
//   Workflow({ scriptPath: "<this file>", args: {
//     month: "202608",
//     tasks: [
//       { id: "T-260828-41", note: "T-260828-43 landed first; build on the\nextracted machinery rather than the old per-repository copies." },
//       { id: "T-260828-46" }
//     ]
//   }})
//
// This BUILDS ONLY. It does not verify, review or merge.
//
//   - Builders check their own diff (typecheck, lint, the covering tests) and
//     stop there. They are not the gate; the orchestrator runs the full suite
//     once on the merged tree, which is both cheaper and a stronger statement
//     than six agents each proving a tree none of them will ship.
//   - Review is the orchestrator's, in the main session, reading these diffs.
//   - Merges are sequential and need judgement about findings.
//
// How many at once: fill the harness cap, which is min(16, cores - 2) — six on
// an eight-core machine. Agents past that queue rather than run, so a list of
// fifteen is not fifteen builders, it is six builders and nine waits.
//
// An earlier version of this comment said "about four", from a measurement that
// no longer describes this system: six builders drove the median test run from
// ~20s to 44s and failed three healthy branches at their gate. Both inputs to
// that number have since changed. Builders no longer run the full suite at all
// (the orchestrator gates once on the merged tree), and T-260828-54 caps vitest
// to two workers inside a worktree, so six agents now peak at 12 workers on 8
// cores instead of 28. The cap that bound then does not bind now.
//
// What binds instead is file ownership. Two builders editing one file produce a
// conflict the orchestrator resolves by hand, and the loser's tests were written
// against a tree that no longer exists. Group a wave by disjoint files, not by
// how many agents fit — a wave of six touching six file sets beats a wave of six
// where two collide.

export const meta = {
  name: 'run-tasks',
  description: 'Build approved .dev tasks in isolated worktrees; review and merge stay with the orchestrator',
  phases: [{ title: 'Implement', detail: 'one subagent per task, each in its own worktree' }],
}

const RESULT = {
  type: 'object',
  required: ['taskId', 'branch', 'worktreePath', 'status', 'changed', 'checks', 'notes'],
  properties: {
    taskId: { type: 'string' },
    branch: { type: 'string', description: 'branch the work was committed on, empty if nothing committed' },
    worktreePath: { type: 'string', description: 'absolute path, so the orchestrator can reach the tree' },
    baseCommit: { type: 'string', description: 'the commit this branched from after the mandatory reset' },
    status: { enum: ['built', 'checks-failed', 'blocked'] },
    changed: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths' },
    checks: { type: 'string', description: 'what typecheck, lint and the covering tests actually said' },
    notes: { type: 'string', description: 'what the scope did not anticipate; empty if nothing' },
  },
}

const raw = Array.isArray(args) ? { tasks: args } : (args || {})
const month = raw.month || '202608'
const tasks = (raw.tasks || []).map((t) => (typeof t === 'string' ? { id: t } : t))

if (!tasks.length) {
  log('No task IDs passed. Give this workflow `args` — see the header.')
  return { built: [], blocked: [], error: 'no tasks' }
}
if (tasks.length > 6) {
  log(`NOTE: ${tasks.length} tasks dispatched; the harness runs min(16, cores - 2) at a time and queues the rest. Check they own disjoint files before assuming this is throughput.`)
}

// The standing rules live in one file so they cannot drift between waves. Read
// them rather than restating them — a wave whose preamble said "confirm your
// base is main" where the previous said "reset unconditionally" produced an
// agent that reported a task file absent from git history while it was tracked
// on main the whole time.
const PREAMBLE = [
  'STANDING RULES — read .claude/skills/run-tasks/subagent-preamble.md IN FULL',
  'before anything else, and follow it exactly. It is the single copy of the rules',
  'every subagent in this project works under: the unconditional base reset, how to',
  'run checks, worktree hygiene, and the rule that a failing check is never made to',
  'pass by weakening it. If it is not in your worktree yet, read it from main:',
  '  git show main:.claude/skills/run-tasks/subagent-preamble.md',
  '',
  'YOU BUILD; YOU DO NOT GATE. Run typecheck, lint, and the tests covering your own',
  'diff. Do NOT run `npm test` — the orchestrator runs the full suite once on the',
  'merged tree. Do not review your own work beyond making it correct; the',
  'orchestrator reviews every diff before it merges.',
].join('\n')

const results = await parallel(
  tasks.map((task) => () =>
    agent(
      'Implement the task scoped in .dev/tasks/' + month + '/' + task.id + '-*.md\n' +
      '(glob it — the slug is in the filename). Read that file in full first: it is\n' +
      'the single source of truth for this scope. Build what it says and nothing\n' +
      'adjacent.\n\n' +
      PREAMBLE +
      (task.note ? '\n\nFOR THIS TASK SPECIFICALLY:\n' + task.note : '') +
      '\n\nWork on branch ' + task.id + '. Report what you changed, the absolute\n' +
      'worktreePath, the commit you branched from, and what your checks actually said.',
      {
        label: 'build:' + task.id,
        phase: 'Implement',
        schema: RESULT,
        isolation: 'worktree',
        model: 'opus',
        effort: 'medium',
      }
    )
  )
)

const returned = results.filter(Boolean)
const built = returned.filter((r) => r.status === 'built')
const blocked = returned.filter((r) => r.status !== 'built')
const missing = tasks.length - returned.length

log(`${built.length} built · ${blocked.length} blocked or failing · ${missing} returned nothing`)

// The orchestrator reads this, reviews each diff, then merges in dependency
// order. Branches survive independently of this workflow, so a task that
// returned nothing may still have committed work worth checking.
return {
  built: built.map((r) => ({ taskId: r.taskId, branch: r.branch, worktreePath: r.worktreePath, changed: r.changed, checks: r.checks, notes: r.notes })),
  blocked: blocked.map((r) => ({ taskId: r.taskId, status: r.status, notes: r.notes })),
  returnedNothing: missing,
}
