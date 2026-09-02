---
name: changelog
description: Write or extend CHANGELOG.md from work that has landed — one icon-led bullet per change, never paragraphs. Use when cutting a release, after a batch of tasks closes, or when the user asks "what changed" or for a changelog. Draws from task outcomes and git log; writes for someone using the app, not someone reading the diff.
---

# Changelog

One line per change. If an entry needs a second line, it is either two changes
or it is over-explained — both are fixable, and neither is fixed by a paragraph.

## Format

```markdown
## Unreleased

- ✨ **Command palette** — `⌘K` searches companies, people and engagements.
- ⚡ **Today view** — renders from one query instead of five; instant at 10× data.
- 🐛 **Cadence ring** — no longer reads late for companies with no touch history.
```

`- <icon> **<title>** — <one clause on why it matters>.`

Title is the thing that changed, in the user's words. The clause after the dash
says what it does for them. Neither mentions a function name, a file, or a task
ID — those live in `.dev/`, which is where someone goes when they want them.

## Types

| | Type | For |
|---|---|---|
| ✨ | feature | A capability that did not exist |
| ⚡ | improvement | Something that existed, now better or faster |
| 🐛 | fix | Behaviour that was wrong |
| 🔒 | security | Hardening — sealing a boundary, closing an exposure |
| ♻️ | refactor | Internal restructuring, no behaviour change |
| 📝 | docs | Documentation worth knowing changed |
| 🗑 | removed | Capability deliberately taken out |

Distinct from the task categories in
[.dev/README.md](../../../.dev/README.md), which record *where* work lands. A
🗄 `data` task can ship a ✨ feature or a 🐛 fix; the axes are independent, so
pick the type from what the user experiences, not the directory touched.

## Where entries come from

The `Outcome` sections of tasks closed since the last release, and `git log`.
Prefer the task outcomes — they already say what actually changed, as opposed
to what was planned.

On a release, run `npm run metrics` and put its last row under the version
heading as one line: tasks closed, follow-up fixes, median elapsed. Those are
the numbers the process is judged by (ADR-016), and the changelog is where
they are read next to what shipped.

## What not to log

Dependency bumps, formatting, test-only changes, and refactors nobody can
observe. A changelog listing everything is a commit log with worse formatting.
Log a ♻️ refactor only when it is large enough that knowing about it helps.

If a release has more than about fifteen bullets, the entries are too granular —
merge the related ones into the outcome they add up to.

## Order and grouping

Order by type: ✨ ⚡ 🐛 🔒 ♻️ 📝 🗑. Keep it a flat list; only break into
per-type subsections past roughly ten entries, where scanning starts to need
the help.

New work goes under `## Unreleased` at the top. On release, rename that heading
to the version and date and open a fresh `## Unreleased`.

## Before finishing

Read it back as someone who did not do the work. Every line should say something
they could not have guessed from the version number — and none should need a
second read.
