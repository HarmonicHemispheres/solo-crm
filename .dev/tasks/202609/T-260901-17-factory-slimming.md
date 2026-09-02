---
id: T-260901-17
title: Slim the software factory — interview-first scopes, sequential builds, a Stop-hook gate, screenshots for UI, capped lessons
status: done
category: docs
created: 2026-09-01
closed: 2026-09-01
---

## Why

Nine orchestrated runs in, the record showed tasks well documented but slower
to ship than direct sessions, and features arriving missing, broken or
different from what was asked. The run summaries name the causes: scopes
written from assumptions, builders forbidden to deviate, no stage that opened
the app, a ten-minute serial merge loop, and a rule added per incident until
the instructions reached eleven thousand words.

## Story

As the operator, I describe a change once, answer a few questions, approve a
short brief, and get back working software with screenshots to look at, so
that the record stays useful without the process being the slowest part.

## Constraints

- Keep task files, ADRs, CONVENTIONS, the AGENTS gotchas, `check:index`, and
  the never-weaken-a-check rule.
- A scope is a brief, not a contract; no instruction may tell a builder to
  build only what the scope says.
- Deterministic gates over prose. Lessons become checks or one capped line.
- Worktrees remain available for explicit parallel work, with same-day cleanup.
- Existing run summaries and task files stay as history; nothing is rewritten.

## Acceptance

- [ ] `run-tasks`, its preamble and workflow, the summary template and
      `report:run` are gone; `build-task`, `retro` and `cleanup-worktrees`
      exist.
- [ ] `scope-task` opens with an interview and writes the new template.
- [ ] A Stop hook runs typecheck, lint and `check:index` when source is dirty,
      and blocks on failure.
- [ ] `npm run snap` boots the built app and writes a screenshot per route per
      width, including company and person detail.
- [ ] `.dev/LESSONS.md` exists and `check:index` fails past twenty lines.
- [ ] `npm run cleanup:worktrees -- --apply` removes merged, clean worktrees
      without touching the shared `node_modules`.
- [ ] `npm run metrics` prints closed, follow-up and elapsed per release.
- [ ] Process instructions total under about 3,500 words.
- [ ] ADR-016 records the decision.

## Related

`.dev/README.md`, `.dev/templates/`, `.claude/skills/*`, `.claude/settings.json`,
`scripts/check-task-index.mjs`, `scripts/window-pass.mjs` (became `snap.mjs`),
`AGENTS.md`.

## Outcome

**Changed:** `.dev/README.md`, `.dev/templates/task.md`, `.dev/LESSONS.md`
(new, 14 lines), `ADR-016`; skills `scope-task`, `verify`, `changelog`
rewritten, `build-task`, `retro`, `cleanup-worktrees` added, `run-tasks` and
its preamble and workflow deleted; `.claude/settings.json` now a Stop hook
(`scripts/hooks/stop-gate.mjs`) replacing the per-command index hook;
`scripts/snap.mjs` (was `window-pass.mjs`, now every route plus detail pages,
`--routes`/`--widths`/`--out`), `scripts/cleanup-worktrees.mjs`,
`scripts/factory-metrics.mjs`; `check:index` caps LESSONS at twenty;
`report:run` and the summary template removed; AGENTS.md process section
shortened. Eighteen stale worktrees removed (770 MB) and twenty merged task
branches deleted. Node 22.22.0 placed under the nvm root for vitest.

**Departed from scope:** the word-count acceptance said about 3,500;
the process files total about 5,500, of which roughly 1,350 (AGENTS.md and
the UI rule) load every session and the rest load on demand. AGENTS.md's
gotchas and reference notes were kept whole on the operator's instruction.
Cutting further would have meant thinning the skills below what a fresh
session needs.

**Not verified:** the interview step and the adherence-review step have not
been exercised on a real task yet. The Stop hook was exercised once and
blocked correctly on a lint error in `snap.mjs`.

**Found on the way:** the first `npm run snap` pass showed person detail
failing in the built app for every seeded person, filed as T-260901-18.
`Tour.test.tsx` failed once in the full suite and passed alone; LESSONS 4.

**Elapsed:** about 55 min.
