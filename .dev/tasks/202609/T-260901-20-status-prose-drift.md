---
id: T-260901-20
title: Bring the status prose in AGENTS.md, README and HOWTO back in line with what is built
status: done
category: docs
created: 2026-09-01
closed: 2026-09-01
---

## Why

AGENTS.md said "Phase 2 onward is not started" and README said the
integrations were "P3/P4", while 0.6.0 shipped the offerings slice of Phase
3 (P3-01/03/07) and the task plan still had those unticked. A fresh session
scoping work reads AGENTS.md first and would assume offerings do not exist.
HOWTO said `npm run snap` builds; it refuses to run without a build.

## Story

As the operator starting a scoping session, I read AGENTS.md and README and
get the same picture the code and the changelog give.

## Constraints

- Prose only; no code changes. The README stack table describes the shipped
  build, and the requirements document keeps its original targets.

## Acceptance

- [x] AGENTS.md's status paragraph names what of Phase 2 and 3 is in.
- [x] README's status says integrations are P4 and names offerings as built.
- [x] README's stack table says Windows is the shipped target.
- [x] README's release step describes what `verify` actually runs.
- [x] HOWTO's command table pairs `snap` with `build`.
- [x] `planning/solo-crm-taskplan.md` ticks P3-01, P3-03, P3-07.

## Related

`AGENTS.md`, `README.md`, `.dev/HOWTO.md`, `planning/solo-crm-taskplan.md`,
`CHANGELOG.md` (0.6.0), `.dev/tasks/202609/INDEX.md`.

---

## Outcome

**Changed:** the six lines the acceptance names, nothing else.

**Departed from scope:** Nothing.

**Not verified:** Nothing to run.

**Elapsed:** ~10 minutes.
