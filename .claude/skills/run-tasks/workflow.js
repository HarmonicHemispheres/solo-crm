// Default fan-out shape for `run-tasks`. Pass the approved task list as `args`:
//   Workflow({ scriptPath: "<this file>", args: ["T-260828-01", "T-260828-02"] })
//
// Adapt it per run. A pipeline is the default because it has no barrier between
// stages: task 01 reaches review while task 02 is still building. Only insert a
// `parallel()` barrier when a stage genuinely needs every prior result at once.
//
// This builds and reviews. It does NOT merge — merges are sequential, need
// judgement about review findings, and belong to the orchestrator in the main
// session, which reads what this returns and decides.

export const meta = {
  name: 'run-tasks',
  description: 'Build, verify and review approved .dev tasks in isolated worktrees',
  phases: [
    { title: 'Implement', detail: 'one subagent per task, each in its own worktree' },
    { title: 'Verify', detail: 'tests, typecheck, lint inside the worktree' },
    { title: 'Review', detail: 'code-review over the task branch diff' },
  ],
}

const RESULT = {
  type: 'object',
  required: ['taskId', 'branch', 'status', 'changed', 'notes'],
  properties: {
    taskId: { type: 'string' },
    branch: { type: 'string', description: 'branch the work was committed on, empty if nothing committed' },
    status: { enum: ['built', 'verify-failed', 'blocked'] },
    changed: { type: 'array', items: { type: 'string' }, description: 'repo-relative paths' },
    notes: { type: 'string', description: 'what the scope did not anticipate; empty if nothing' },
  },
}

const REVIEW = {
  type: 'object',
  required: ['taskId', 'blocking', 'findings'],
  properties: {
    taskId: { type: 'string' },
    blocking: { type: 'boolean', description: 'true if something must be fixed before merge' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'summary'],
        properties: {
          severity: { enum: ['blocking', 'should-fix', 'nit'] },
          file: { type: 'string' },
          summary: { type: 'string' },
        },
      },
    },
  },
}

const taskIds = Array.isArray(args) ? args : [args]
if (!taskIds.length || !taskIds[0]) throw new Error('run-tasks: pass task IDs as args')

const STANDING_RULES = `
Read .dev/README.md and AGENTS.md before you touch anything.
The task file is your scope. Build what it says and nothing adjacent.
If the scope is wrong or impossible, stop and report status "blocked" with why.
Never weaken, skip or delete a test to make verify pass — report the failure.
Commit your work on the branch named for the task ID. Do not merge, rebase onto
the working branch, or touch any other branch.
`

const results = await pipeline(
  taskIds,

  // Implement, isolated so concurrent tasks cannot collide on the same files.
  (taskId) => agent(
    `Implement the task scoped in .dev/tasks/*/${taskId}-*.md.
${STANDING_RULES}
Work on branch ${taskId}. Report what you changed.`,
    { label: `build:${taskId}`, phase: 'Implement', schema: RESULT, isolation: 'worktree', model: 'sonnet', effort: 'high' },
  ),

  // Verify in the same worktree. A build that failed verify still goes to review
  // — the findings explain the failure and save the next attempt.
  (built, taskId) => built.status === 'blocked'
    ? built
    : agent(
        `Run the verify skill against the working tree on branch ${built.branch}.
Report status "built" only if it passes clean, "verify-failed" otherwise, and put
the failing output in notes. Do not modify tests to make them pass.`,
        { label: `verify:${taskId}`, phase: 'Verify', schema: RESULT, isolation: 'worktree', model: 'sonnet', effort: 'low' },
      ),

  // Review the diff, not the worktree state — the branch is what gets merged.
  async (built, taskId) => {
    if (built.status === 'blocked') return { built, review: null }
    const review = await agent(
      `Run the code-review skill over the diff on branch ${built.branch} against
the working branch, judged against the acceptance criteria in the task file for
${taskId}. Flag anything violating a gotcha in AGENTS.md as blocking.`,
      { label: `review:${taskId}`, phase: 'Review', schema: REVIEW, model: 'opus', effort: 'xhigh' },
    )
    return { built, review }
  },
)

const done = results.filter(Boolean)
log(`${done.length}/${taskIds.length} tasks returned`)

// The orchestrator reads this and decides what merges. Nothing here merges.
return {
  mergeable: done.filter((r) => r.built?.status === 'built' && !r.review?.blocking),
  blocked: done.filter((r) => r.built?.status !== 'built' || r.review?.blocking),
  dropped: taskIds.filter((id) => !done.some((r) => r.built?.taskId === id)),
}
