---
id: T-YYMMDD-NN
title: <imperative, one line>
status: open
category: <data | ipc | ui | integration | build | docs>
plan_ref: <P1-01, or omit>
created: YYYY-MM-DD
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in the index. -->
<!-- Keep the whole file under about 300 words. This is a brief, not a spec. -->

## Why

What breaks or stays impossible without this. Two sentences.

## Story

As the operator, I <do what> so that <what is true afterwards>. Written from
the interview, in the user's words where possible.

## Constraints

Requirements the build must respect, and any gotcha from
[AGENTS.md](../../../AGENTS.md) or ADR this comes near. Not implementation
steps — the builder reads the code and decides those.

## Acceptance

- [ ] Observable statements. A command that exits non-zero, a number that must
      match, a view that must render.
- [ ] The last one is always end-to-end: "open the app, do X, see Y."

## Related

Files and modules research found relevant. A starting point for the builder,
not a list of what to edit.

---

## Outcome

*Appended at close.*

**Changed:** files that moved, one line.

**Departed from scope:** what the builder did differently and why. "Nothing"
is a fine answer.

**Not verified:** anything acceptance names that was not actually exercised.

**Elapsed:** minutes from start to close.
