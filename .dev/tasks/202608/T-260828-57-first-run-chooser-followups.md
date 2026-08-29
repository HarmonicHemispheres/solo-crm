---
id: T-260828-57
title: One database path, one sync-folder guard, and a folder proven writable
status: done
category: data
plan_ref: P0-03
created: 2026-08-28
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->
## Why

Deferred from T-260828-18's review. Four findings, of which the first two are
the kind AGENTS.md warns about — silently wrong rather than loudly broken.

**Two copies of the database path.** The existing-install check recomputes it,
with its own `DB_FILENAME = 'solocrm.db'` and its own `join(userDataDir, ...)`,
rather than asking `resolveDatabasePath({ userDataDir })`. The whole safety
property of this feature — *a database already exists, so never prompt* — now
depends on two independently maintained copies of one path staying equal. If
they drift, an existing user is asked again where their data goes.

**One guard, two behaviours.** The pick-time check calls `findSyncFolderMatch`
but ignores `isSyncFolderGuardOverridden()`, while `connection.ts`'s boot-time
guard honours it. A user who deliberately set the documented
`SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` escape hatch cannot pick that folder at all,
and the refusal tells them nothing about the override they already set.

**No writability probe.** A read-only or disconnected pick fails inside
`openDatabase()` *after* `writeDataRootPointer` has committed. Every later
launch then sees the pointer, reports `existing-install`, never re-prompts, and
shows a raw better-sqlite3 "unable to open database file". That is an
unbootable install with no path back through the interface.

**"Use the default" changes ADR-006's semantics.** It writes a pointer naming
the default root. ADR-006 states that with no pointer present the resolver
"returns userDataDir unchanged, byte-for-byte today's behaviour". From now on
every new install has an absolute path baked into its profile rather than one
resolved from `app.getPath` at boot — which breaks if the profile ever moves.

## Scope

**In:**

- Route the existing-install check through `resolveDatabasePath()`; delete the
  duplicate constant.
- Honour `isSyncFolderGuardOverridden()` at pick time, and say so in the refusal
  when the override is what would allow it.
- Probe the chosen folder for writability before writing the pointer, and return
  to the choice on failure.
- Decide "use the default": either write no pointer (restoring ADR-006's stated
  behaviour) or amend ADR-006 to say the default is now pinned. **One of the
  two** — the current state is code and ADR disagreeing.
- Give `showOpenDialog` a `title`, `defaultPath` and `buttonLabel`, so the
  picker does not open with a generic OS title immediately after a message box
  that carefully explained which folder is being asked for.

**Out:** Relocating an existing data root (T-260828-19). Any renderer UI.

## Touches

- `electron/main/first-run/data-location-prompt.ts` and its test
- `electron/main/db/connection.ts`
- `.dev/decisions/ADR-006-data-root-pointer-file.md` — only if the default is
  pinned deliberately

## Acceptance

- [ ] There is exactly one expression producing the database path in the main
      process — asserted by grep for `solocrm.db` returning one definition
- [ ] With `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` set, a sync folder can be picked and
      boots; without it, the same pick is refused
- [ ] A read-only chosen folder returns to the choice and leaves **no** pointer
      file on disk, asserted by checking the filesystem after the refusal
- [ ] The "use the default" behaviour matches ADR-006, whichever way it is
      settled, and the ADR and the code are checked against each other in a test
- [ ] An existing install is never prompted — the case that must not regress

## Risks

- **Probing writability by writing the database.** The probe must be cheap and
  must clean up after itself; leaving a stray file in a folder the user is only
  considering is worse than no probe.
- **Changing the default-pointer behaviour for profiles that already have one.**
  Whatever is decided applies to new installs; an existing pointer is a choice
  the user made and is not this task's to rewrite.


---

## Outcome

Merged. Built by a subagent under the build-only process; reviewed and verified
by the orchestrator at merge.

**Changed:** `electron/main/db/{connection,readonly-connection,sync-folder-guard}.ts`
and their tests, `electron/main/first-run/data-location-prompt.{ts,test.ts}`.

### The guard moved into the path, not next to each opener

Hours before this was dispatched, T-260828-39's review added a **second**
sync-folder guard call site — because `resolveDatabasePath()` only joined a
filename onto the data root, and the guard lived inside `openDatabase()`, so the
new read-only connection was opening unguarded. That fix was correct and was the
wrong shape: two call sites is one more than the number that can be kept in
step.

The guard now lives **inside `resolveDatabasePath()` itself.** A refused path can
no longer be *obtained*, so no future opener can forget to call anything. The
duplication added in T-260828-39's review is deleted — `readonly-connection.ts`
imports nothing from `sync-folder-guard` any more and inherits the guard from the
path it resolves.

That makes AGENTS.md's existing sentence — *"every path a pointer names still
resolves through `resolveDatabasePath()` and still runs through this same
sync-folder guard"* — **literally true rather than aspirational.** No AGENTS.md
edit was needed, which is the right outcome: the code moved to match the
documentation instead of the other way round.

Both structural tests the dispatch named still pass **unchanged**:
`connection.test.ts`'s two-declared-owners walk, and
`readonly-connection.test.ts`'s assertion that the module imports nothing from
`./connection` but the pure path function. The read-only guard test added in
T-260828-39's review also survives and still passes, now exercising the guard
through the resolver rather than through a local call.

### The consequence the scope did not anticipate

The scope said to "route the existing-install check through
`resolveDatabasePath()`". **That is no longer possible, and following it would
have been actively harmful:** the resolver now throws, so on a profile whose own
`userData` sits inside a sync folder it would kill the app *at the one screen
that exists to let the user pick a different folder* — reproducing exactly the
unbootable-with-no-way-back failure the scope's own third finding condemns.

So `connection.ts` exports `databasePathIn(dataRoot)`: the single expression
joining `solocrm.db` onto a folder. It reads no pointer, resolves nothing and
guards nothing — and `connection.test.ts` **pins its importers to exactly the
first-run chooser**, so it cannot quietly become a second way in. The duplicate
`DB_FILENAME` is gone; grep for the literal now finds one definition.

The letter of the scope was bent and its intent kept, and the builder flagged it
rather than quietly diverging. Accepted.

### "Use the default" writes no pointer

Settled by restoring ADR-006's Decision item 1 rather than amending it — and a
test reads the ADR's own text and fails if it is ever amended to pin the default
instead. That is a pleasing shape: the decision document is load-bearing, not
decorative.

Two pre-existing first-run tests were **rewritten, not weakened**, because the
behaviour they asserted was precisely what this task changed: *"Use the default"
writes data-location.json* now asserts no pointer is written, and *a second call,
after the pointer exists* now creates `solocrm.db` before asserting
existing-install.

**Verified at merge:** typecheck clean across all three passes, lint clean,
`node` + `runtime-boot-node` + `catch-all` 35 files / 725 tests green on the
merged tree.

## Two smaller changes worth knowing about

The override warning now fires **only when the override actually suppressed a
match**, rather than on every resolve with the env var set. Strictly more
informative, but it is a behaviour change nothing asserted either way.

The writability probe is proven with a path under an existing parent that does
not itself exist. A POSIX `chmod` would not reproduce a read-only folder, a
disconnected drive or an unavailable share on Windows, and the probe's failure
path is identical for all four — so the test exercises the path that is
reachable rather than pretending to the ones that are not.

## For T-260828-19

`data-location-prompt.ts` now imports from `../db/connection`, which pulls
better-sqlite3 into the first-run module's import graph. Already loaded in main
and no measurable cost, but it is a new edge, and T-260828-19 relocates a data
root through these same files.
