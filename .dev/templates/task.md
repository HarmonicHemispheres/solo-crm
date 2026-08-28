---
id: T-YYMMDD-NN
title: <imperative, one line>
status: open
category: <data | ipc | ui | integration | build | docs>
plan_ref: <P1-01, or omit>
created: YYYY-MM-DD
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

What breaks or stays impossible without this. One short paragraph.

## Scope

**In:** the change itself, concretely enough that someone with no memory of the
conversation could build it.

**Out:** the adjacent things a reasonable person would otherwise fold in.

## Touches

Files and modules expected to change. A prediction, not a contract — the outcome
records what actually moved.

## Acceptance

- [ ] Checkable statements, not aspirations. "`SUM` over `revenue_lines` matches
      the engagement rollup to the cent", not "revenue works".

## Risks

Where this could quietly go wrong, and any gotcha from
[AGENTS.md](../../../AGENTS.md) it comes near.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
