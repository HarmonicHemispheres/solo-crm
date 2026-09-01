---
id: T-260831-06
title: Stop offering a data location the portable build cannot honour
status: done
category: ui
plan_ref: X-09
created: 2026-08-31
closed: 2026-08-31
---

## Why

[ADR-013](../../decisions/ADR-013-portable-data-root.md) Decision 6 settles that
a portable build ignores `data-location.json`, never writes it, and does not
offer `moveDataRoot()` — and explicitly defers the UI half of that to a `ui`
task, which is this one. T-260831-03 built the enforcement; nothing yet stops
the app *asking* the question it can no longer answer.

Two surfaces still do, both found by T-260831-03's builder rather than by this
scope's author:

1. **The first-run location chooser runs on a portable launch.**
   `electron/main/index.ts` calls `runFirstRunDataLocationPrompt({ skip: false })`
   unconditionally, and it decides "is this an existing install" from the
   *host machine's* `%APPDATA%`. So the first launch of a portable copy on a
   fresh machine shows the chooser, naming a `%APPDATA%` path the data will not
   go to. Picking "use the default" is harmless — no pointer is written, boot
   proceeds, the portable root is used correctly — but picking "choose a
   folder" now raises `PortableDataRootPointerError` and the app refuses to
   start.
2. **`Data ▸ Move Data Folder…` is still in the menu.** It returns a `portable`
   refusal with an explanation instead of doing anything, which is safe, but
   an operator has to hit a wall to learn it.

Neither can corrupt data or contaminate the host — T-260831-03 made both fail
loudly and early. Both are still a bad first impression of the artifact, and
the first one is a dead end reachable in two clicks on a brand-new machine.

## Scope

**In:**

- Skip the first-run location chooser entirely on a portable launch. The
  portable root is not a choice, so there is no question to ask. Use the
  existing launch observation (`isPortableLaunch` /
  `observePortableLaunch` in `electron/main/db/portable.ts`) — do not add a
  second way of detecting portability.
- Hide or disable `Data ▸ Move Data Folder…` on a portable launch. If disabled
  rather than hidden, it must say why in a way that reads as deliberate.
- Wherever the app displays *where its data lives* (Workspace Data view,
  settings, about), show the portable root and make it legible that this copy
  keeps its data beside its `.exe`. Read the value through the same resolver,
  never by re-deriving it in the renderer.

**Out:** any change to `portable.ts`'s resolution or refusal logic — that is
T-260831-03's, merged and reviewed. Any new IPC channel if an existing one
already carries what the renderer needs. Building a portable-specific settings
screen.

## Touches

- `electron/main/index.ts` — the unconditional first-run prompt call
- the app menu module that registers `Data ▸ Move Data Folder…`
- whichever renderer surface names the data location
- possibly one existing IPC channel's payload, to carry "this is portable"

## Acceptance

- [ ] On a simulated portable launch, the first-run chooser does not appear and
      boot proceeds to the portable root — asserted in a test, not only by hand.
- [ ] On a non-portable launch the chooser behaves exactly as it does today;
      the existing first-run tests pass unmodified.
- [ ] `Data ▸ Move Data Folder…` is absent or visibly disabled on a portable
      launch, and unchanged otherwise.
- [ ] No second portability check exists anywhere — `grep` shows
      `isPortableLaunch` as the only predicate, per ADR-013 and the
      single-seam rule `resolveDatabasePath()` already follows.
- [ ] The renderer never derives a filesystem path itself (AGENTS.md: the
      renderer never touches the filesystem).
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run check:index`
      all exit 0.

## Risks

- **A second portability predicate.** The tempting shortcut is an
  `isPortable` boolean computed in the renderer or in `index.ts` from an env
  var. That is how the two halves drift, and it is exactly what ADR-013
  Decision 2 was designed to make unnecessary.
- Skipping the chooser on a *non*-portable launch would silently take away the
  choice T-260828-18 exists to offer; the second acceptance criterion is what
  catches that.
- **Sequencing:** this should land before [T-260831-05](T-260831-05-portable-qa.md),
  or the QA pass spends its time rediscovering the first-run dialog instead of
  testing what it was written to test.

---

## Outcome

**Changed:** 11 files.

- `electron/main/first-run/data-location-prompt.ts` — a new `{ kind: 'portable' }`
  outcome returned after the `skip` opt-out and **before**
  `app.getPath('userData')` is read.
- `electron/main/app-menu.ts` — `Data ▸ Move Data Folder…` is disabled on a
  portable launch and relabelled
  `Move Data Folder… — portable copies keep data beside Solo CRM.exe`. That
  branch has no `click` handler at all; the disabled flag is the enforcement.
- `electron/main/db/stats.ts`, `electron/shared/ipc-types.ts` — `db:stats`
  gained `portable: boolean`.
- `electron/renderer/views/WorkspaceData.tsx` — the note beside the path.
- Plus the five test files and the renderer stub.

**Review:** passed. The branch-placement argument is the substance and it is
right: on a portable launch `app.getPath('userData')` is the *host's* folder,
shared with any installed copy, so both the pointer file and the `solocrm.db`
that flow looks for there belong to a different copy — asking "have you been
set up before?" from another install's files is the wrong question asked of the
wrong machine. Putting the branch inside the prompt rather than at
`index.ts:78` also leaves the call site unconditional and `await`ed, so boot
ordering for a non-portable launch is byte-identical by construction rather
than by test luck.

Verified rather than accepted: the single-predicate grep (`isPortableLaunch`
defined once, `PORTABLE_EXECUTABLE_DIR` nowhere outside `portable.ts`, no other
`isPortable*` identifier, no `node:` import in the renderer); the claim that the
only `-` line in the first-run test diff is the extended import — it is, no
existing case was touched; and a mutation, disabling the portable branch with
`false &&`, which fails 2 tests. No blocking findings.

The builder's own finding is worth keeping: the Workspace Data view was already
showing the *correct* path on a portable launch, because `db:stats.path` comes
from `db.name` and so resolves through `portableDataRoot()` already. What was
false was the static sentence beside it — "The database lives in this app's own
user-data folder." So the third scope bullet was a truthfulness fix, not a
path-plumbing job, which is why one boolean was the entire payload change.

**Deferred:** `db:stats` is an IPC payload change and therefore a
`security-review` surface. Per `.dev/README.md` that review runs in its own
session over the accumulated boundary, not per diff inside a run, so it is
recorded in R-260831-01's follow-ups rather than run here. The change adds no
new exposure — one boolean qualifying a `path` that already crossed
deliberately — but it should be in the next batched pass.
