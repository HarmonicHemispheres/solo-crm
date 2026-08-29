# The subagent preamble

Every subagent this skill dispatches gets this text. **Point at this file's
content rather than re-typing it** — it has been hand-written per wave five
times and drifted every time, most expensively when one wave said "confirm your
base is main" while the next said "reset unconditionally", and the confirm-form
produced a false `blocked`.

Substitute `<task-id>` and `<task-file>`. Add the task's own note and review
lens after it; those are per-task and belong in the dispatch, not here.

---

## Before anything else

**STEP ONE, UNCONDITIONALLY, BEFORE READING ANY FILE:**

```
git checkout -B <task-id> main
```

Do this even though it looks unnecessary. Your worktree is **not** created at
`main`. It is created at the commit that was HEAD when the session started,
which in a long session is dozens of commits behind — old enough that task
files, repositories, IPC channels and whole views do not exist in it. Measured,
not guessed: `.git/worktrees/<id>/CLAUDE_BASE` holds that commit.

An agent that skipped this found no task file, searched `git log --all` and
`git branch -a`, and reported *"blocked — the scope does not exist anywhere in
git history"*. It was wrong. **Never conclude a file is missing from a
pre-reset worktree.**

After the reset, report the commit you are on and the count from
`git ls-tree --name-only HEAD .dev/tasks/<month>/ | wc -l`.

## Scope

Read `<task-file>` in full first — it is the single source of truth. Build what
it says and nothing adjacent. If the scope is wrong or impossible, stop and
report status `blocked` with why.

Read `.dev/README.md` and `AGENTS.md` before touching anything.

## The rule that is never traded away

**Never** weaken, skip, delete, `.only`, `.skip`, loosen an assertion, raise a
timeout, or add an expected-failure marker to make a check pass. A failing check
is a result — report it with its real output.

A timeout may move **only** with a measured duration in a comment beside it.

## How to run the checks

**You are not the gate.** The orchestrator runs the full suite once, on the
merged tree, after every task in the wave has landed. Your job is to know that
*your own change* works — not to prove the whole repository is green, which you
cannot do anyway, because the other branches in this wave are not in your tree.

The suite is ~62% of all agent wall-clock in this project and it slows down for
every concurrent agent. Six agents each running the full suite is six times the
cost for less information than one run on the merged result.

**So run only what covers what you touched:**

```
node_modules/.bin/vitest run path/to/thing.test.ts     # the files you changed
node_modules/.bin/vitest run electron/main/db          # a directory
npm run test:unit                                       # the fast pool, if broad
```

**Before you report, run these three — they are cheap and they are yours:**

```
npm run typecheck
npm run lint
node_modules/.bin/vitest run <every test file your diff touches or affects>
```

Typecheck and lint are whole-tree and fast, and a type error in your branch is
unambiguously yours. Do **not** run `npm test` — that is the orchestrator's gate,
it takes ~100s, and running it here tells you about code you did not write.

**If you change something other components mount, run its whole project.**
A layer, a shell, a provider, a route table: `--project=renderer` or
`--project=node` is about a minute and is the only reliable way to find the
harnesses that mount your thing from somewhere you did not think to look.
T-260828-37 replaced the palette layer placeholder with a component that
navigates and queries, then ran `components/shell`, `lib` and `views` — and
never ran `hooks`, where a harness mounts that layer and had no router. Five
tests failed at the orchestrator gate, which costs a full-suite re-run and a
diagnosis, both more expensive than the minute.

If you genuinely cannot tell which tests cover your change, say so in your
report rather than falling back to the whole suite.

**Never run bare `npx vitest run`.** With no project filter it runs all five
projects including the serial Electron pools — 179 such calls cost 128 minutes
in one run. Prefer `node_modules/.bin/vitest` over `npx` generally; `npx` adds
resolution overhead on every call.

**Do not re-run a command whose inputs have not changed.** Identical re-runs
cost 64 minutes in one run, 25 of them full-suite.

**A timeout is not a failure until it reproduces alone.** If a test fails on a
timeout, re-run that file by itself before reporting. Three tasks in one wave
reported `verify-failed` for timeouts caused purely by concurrent agents; all
three passed on a quiet machine. Say explicitly whether a failure reproduces in
isolation.

**Reverting a mutation: never with `git checkout <file>`.** Proving a test goes
red by breaking the code is a good check, but `git checkout` restores the file to
its committed state — which also discards every *uncommitted* edit you made to
that same file earlier, including the one you are testing. It fails silently:
you get your green run back and your work is gone. Undo the mutation with a
targeted edit, or commit before you mutate. One builder lost a set of
doc-comments this way and only found them by grepping for a marker.

## Worktree hygiene

Do **not** run `npm install`. Link dependencies with exactly this form, as a
single quoted argument — the unquoted form fails *silently* under Git Bash:

```
cmd //c 'mklink /J node_modules C:\Users\heavy\magicpill\Core\solo-crm\node_modules'
```

Confirm with `node -e "require('better-sqlite3'); console.log('ok')"`.

Do not remove the junction — verify reuses this worktree. **Never run
`git worktree remove`**: on Windows it deletes *through* the junction into the
shared install and breaks every other agent.

## Committing

Commit on the branch named for your task ID. Do not merge, do not rebase onto
`main`, do not touch another branch.

Stage by explicit path — **never `git add -A` or `git add .`**.
`planning/md-as-a-live-report.png` is a user file that is not yours to commit.

## Windows

Never edit a source file through PowerShell 5.1 `Get-Content`/`-replace` — it
silently corrupts UTF-8. Use the Edit/Write tools.
