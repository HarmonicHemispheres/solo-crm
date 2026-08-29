---
id: R-YYMMDD-NN
date: YYYY-MM-DD
tasks: [T-YYMMDD-01, T-YYMMDD-02]
branch: <branch merged into>
---

## Run metadata

Generated, never hand-typed — a dozen checkable numbers is exactly the wrong
thing to write from memory:

```
npm run report:run -- <runId> --markdown
```

Paste its output here. It records when the run started and ended, the platform
and model versions, the effort each stage ran at, how many subagents there were,
tokens in and out with the cache split, and where the shell wall-clock went.
That last table is the one worth reading twice: it is how the test suite was
found to be 62% of all agent time.

If a run spanned several workflows, pass them all — the script sums them.

## What changed

Two or three sentences on the run as a whole — what the codebase can do now that
it could not before. Not a list of the tasks; the table below is that.

| Task | Title | Result |
|---|---|---|
| [T-YYMMDD-01](../../tasks/YYYYMM/T-YYMMDD-01-slug.md) | … | merged · reverted · deferred |

## Decisions

Choices made mid-run that outlive it. Anything structural gets an ADR in
`.dev/decisions/` and is linked here rather than explained here.

## Follow-ups

New task IDs this run created. If a review finding was accepted but not fixed,
it is a follow-up task — not a line in this file that nobody will read again.

## What went wrong

Failed verifies, bad merges, scopes that turned out wrong. This section is the
reason the summary is worth writing; skipping it makes the record useless for
improving the process.
