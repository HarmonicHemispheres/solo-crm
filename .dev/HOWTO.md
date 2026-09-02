# Using the software factory

This is the operator's guide: what to say, what comes back, and what to look
at. [README.md](README.md) is the contract the agents follow;
[ADR-016](decisions/ADR-016-factory-slimming.md) is why it looks like this.

## The shape of a change

```
you:     describe the change
claude:  asks 3–6 questions              (scope-task, interview)
you:     answer
claude:  reads the code, writes briefs   (scope-task, research)
you:     approve / cut / edit the briefs
claude:  builds one brief, in a fresh session, and closes it   (build-task)
you:     read the outcome and the screenshots
claude:  did anything go wrong a check could catch?           (retro)
```

Two places you decide: before any code exists, and after it runs. The middle
does not wait on you, but you can interrupt at any point.

## 1. Scoping

Start a session and say what you want, in your own words:

> I want to be able to archive a company without deleting it.

Claude will ask questions before reading anything. Answer the ones that
matter and say "your call" to the rest. Then it reads the code, runs the
relevant tools, and writes one file per task under
`.dev/tasks/YYYYMM/`, each about 300 words:

| Section | What it holds |
|---|---|
| Why | What breaks or stays impossible without this |
| Story | What you do and what is true afterwards, in your words |
| Constraints | Requirements and gotchas the build must respect |
| Acceptance | Observable checks; the last is always "open the app, do X, see Y" |
| Related | Files research found relevant, a starting point not an edit list |

It reports the list with a recommended order and says which it would cut.
Edit the files directly if a brief is wrong. Say which to build.

**A brief is a best-effort description.** The builder is expected to find
what it missed. You do not need to get it perfect.

## 2. Building

Start a **fresh session** per task and say:

> build T-260901-18

Claude reads the brief beside the code, implements, runs the covering tests,
runs `npm run snap` for UI work and reads the screenshots, has a fresh
subagent check the diff against the acceptance list, runs `code-review`,
writes the outcome, closes the task and commits. Two verify-fix cycles at
most; if it is still failing it stops and tells you where it is.

Anywhere the brief and the code disagree on something that is your choice,
it asks. Otherwise it decides and writes the departure into the outcome.

A Stop hook runs typecheck, lint and `check:index` whenever Claude tries to
end a turn with source files dirty, and refuses until they pass. You will see
it fire; that is it working.

## 3. Reading the result

The task file's **Outcome** has four lines that matter: what changed, where
it departed from the brief, what was not verified, and how long it took.
Read the second and third.

For UI work, open `shots/`. Every route at 1440, 900 and 700 pixels, and
`metrics.json` names anything overflowing the viewport. Look at the routes
the task touched. This is the check the old process never had.

Then run the app yourself if the change is one you would use:

```
npm run dev
```

## 4. Retro

At the end of a build, Claude asks itself whether anything went wrong that
the next session would repeat, and does one of three things: writes a
check, adds one line to [LESSONS.md](LESSONS.md), or nothing. LESSONS.md
holds twenty lines at most. If you notice something worth keeping, say
"retro: …" and it goes through the same triage.

Do not ask for a new rule in a skill or README because of one incident.
That is how the last process reached eleven thousand words.

## Commands

| Command | What it does |
|---|---|
| `npm run build && npm run snap` | Screenshot every route at three widths into `shots/` — `snap` refuses to run without a build, but does not make one |
| `npm run snap -- --routes company,person --widths 700` | Only those routes and widths |
| `npm run check:index` | Task files and month indexes agree; LESSONS under twenty |
| `npm run metrics` | Per release: tasks closed, follow-up fixes, user-reported, median elapsed |
| `npm run cleanup:worktrees` | Report merged, clean worktrees; add `-- --apply` to remove them |
| `npm run typecheck && npm run lint && npm test` | The full gate by hand |

Tests need Node 22.22 or later; the system 22.12 crashes better-sqlite3.
`nvm use 22.22.0` or prepend `%APPDATA%\nvm\v22.22.0` to `PATH`.

## Parallel work

Sequential is the default. If you have several tasks that touch disjoint
files and are mechanical enough not to need judgement, say so explicitly:

> build T-…-03 and T-…-04 in parallel worktrees

and run `npm run cleanup:worktrees -- --apply` the same day. Worktrees left
behind cost 750 MB last time.

## Releasing

When a batch is worth a version:

> write the changelog and cut 0.7.0

The `changelog` skill reads the closed outcomes since the last release,
writes one line per user-visible change, and puts the `metrics` row under
the version. `npm run dist` builds the installer and portable exe.

## Other skills

| Skill | When |
|---|---|
| `verify` | "is the tree green?" before a commit or hand-off |
| `architecture-review` | a diff touches `db/`, `ipc/`, `preload/`, `sync/` |
| `security-review` | once per batch, over the whole IPC surface, in its own session |
| `code-review` | any diff; build-task runs it, you can too |

## When something is off

- **Claude built something different from the brief.** Read the Outcome's
  "departed from scope" line first; it may be right. If not, say so and it
  reverts or fixes in the same session.
- **The Stop hook keeps blocking.** A check is failing. Ask what it says. It
  gives up after eight consecutive blocks so a broken check cannot trap a
  session.
- **A screenshot looks wrong.** Say which route and width. That is a more
  precise bug report than any test failure.
- **A task is too big for one session.** Split it; say "split T-… into two".
