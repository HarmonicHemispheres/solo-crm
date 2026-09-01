---
id: T-260831-01
title: Decide how a portable build names its data root, and record it
status: open
category: docs
plan_ref: X-09
created: 2026-08-31
closed:
---

## Why

A portable build has to keep its data beside the executable rather than in
`app.getPath('userData')`. Every mechanism for telling it so runs into
[ADR-006](../../decisions/ADR-006-data-root-pointer-file.md), which decided the
data root is named by a pointer file and **explicitly rejected an environment
variable**, arguing that `SOLOCRM_ALLOW_SYNC_FOLDER_DB` is "precedent for how
narrow that mechanism is meant to stay". The only supported way to learn where a
portable exe actually lives is `process.env.PORTABLE_EXECUTABLE_DIR`, an
environment variable.

That tension is real and it is not the implementing task's to resolve mid-build.
Either the distinction between a *build-supplied* variable and a *user-supplied*
one is stated and binding, or ADR-006 is being quietly contradicted by whoever
happens to write the code. This task settles it before T-260831-03 starts.

It also settles a contradiction in the plan itself: X-09's acceptance criterion
reads "The packaged app finds its database in `userData`, **not next to the
binary**" ([taskplan](../../../planning/solo-crm-taskplan.md), line 774). That
is the opposite of what a portable build is for. The criterion is not wrong — it
is right for the installed build — but it is now unqualified where it needs to
be conditional, and leaving it unamended means the plan and the app disagree.

## Scope

**In:**

1. **Record the artifact shape, which is already chosen: electron-builder's
   single-file `portable` target.** The operator asked for one `.exe`, was shown
   the `zip`-folder alternative and its trade-offs on 2026-08-31, and chose the
   single file deliberately. The ADR's job here is to *record* that choice and
   its consequences, not to re-open it — but it must record it honestly,
   including the costs, because an ADR that lists only benefits is advocacy
   (template, Consequences).

   Those costs are not incidental. `portable.nsi`
   (`node_modules/app-builder-lib/templates/nsis/portable.nsi`) extracts the
   whole app into `$PLUGINSDIR\app` or `$TEMP\<UNPACK_DIR_NAME>`, runs it from
   there, and then executes `RMDir /r $INSTDIR` **after the app exits**. So:
   - the directory containing the running executable is deleted on close, which
     is what makes item 3 below load-bearing rather than defensive;
   - every launch pays a full extraction of the unpacked app, measured at
     **410 MB** on 2026-08-31 (`release/win-unpacked`), including from whatever
     USB stick the operator is running it off.

   Alternatives must still record the `zip`/`dir` target and why it lost — it
   was the technically safer option (`process.execPath` sits in the real folder,
   no extraction, no deletion-on-exit) and lost to the single-file delivery
   requirement, not to a technical argument. Say that plainly so the trade is
   legible if the launch cost later proves unacceptable.
2. **Decide the root mechanism** and state it as a rule: how the app knows it is
   running portable at all, and where the root comes from. If
   `PORTABLE_EXECUTABLE_DIR` is used, state explicitly why a build-supplied
   variable is not the escape hatch ADR-006 refused, and what stops it becoming
   one (it is read only when the build is marked portable; it is never a way for
   a user to relocate an installed build's data).
3. **Decide what happens when the app is marked portable and the variable is
   absent or names the extraction directory.** Falling back to `userData` makes
   a "portable" build silently non-portable; falling back to the executable's
   own directory under the single-file target writes into a folder NSIS deletes
   on exit — total, silent data loss. ADR-006's item 4 already establishes the
   house rule (a root that cannot be trusted fails startup loudly, never falls
   back); say whether that applies here.
4. **Decide the sync-folder guard's behaviour in portable mode.** A portable exe
   on a USB stick is the point; a portable exe in a OneDrive or Dropbox folder is
   a likely accident, and in portable mode the data root *is* that folder, so the
   guard refuses startup. Decide deliberately: refuse with a message naming the
   portable case, or something looser. Do not silently exempt portable builds —
   the AGENTS.md gotcha the guard enforces does not stop applying because the
   build is portable.
5. **Decide `data-location.json`'s meaning in portable mode** — honoured
   (absolute? relative to the portable root?), ignored, or refused — and
   likewise whether `moveDataRoot()` and the data-root UI (T-260828-19,
   T-260828-18) are offered at all. Note the cross-contamination case: the
   pointer file's fixed home is `app.getPath('userData')`, which in a portable
   build still resolves to `%APPDATA%\Solo CRM` — shared with an installed copy
   on the same machine. A portable run that writes a pointer there would
   redirect the *installed* app's data root on its next launch.
6. **Write `ADR-013`** from `.dev/templates/adr.md`, and add a cross-reference
   to it in ADR-006 (ADR-006 stays `accepted`; it is extended in a case it did
   not consider, not superseded).
7. **Amend X-09's criterion** in the task plan so it binds the installed build
   and names the portable exception.

**Out:** every line of code, every packaging config change, and the README /
AGENTS.md / CHANGELOG updates — those land with the tasks that make them true
(T-260831-03, T-260831-04).

## Touches

- `.dev/decisions/ADR-013-portable-data-root.md` (new)
- `.dev/decisions/ADR-006-data-root-pointer-file.md` — cross-reference only
- `planning/solo-crm-taskplan.md` — X-09's second criterion

## Acceptance

- [ ] `ADR-013` exists with all four template sections filled, `status: accepted`.
- [ ] Its Decision states, as followable rules, all five choices above: artifact
      shape, root mechanism, absent-variable behaviour, sync-guard behaviour,
      pointer-file semantics.
- [ ] It records the single-file `portable` target as chosen, and the
      `zip`/`dir` target as the safer option that lost to a delivery
      requirement rather than to a technical argument.
- [ ] Its Consequences names the 410 MB per-launch extraction cost.
- [ ] Its Context names the `RMDir /r $INSTDIR`-after-exit behaviour of
      `portable.nsi` explicitly, with the file path, so the trap is on the
      record rather than in one person's head.
- [ ] Its Alternatives says why the artifact shapes not chosen lost, in enough
      detail that the question does not get re-opened next quarter.
- [ ] Its Consequences names at least one real cost, per the template.
- [ ] ADR-006 links to ADR-013 and still reads `status: accepted`.
- [ ] X-09's "not next to the binary" criterion no longer contradicts a shipped
      portable build.
- [ ] `npm run check:index` exits 0.

## Risks

- **Rubber-stamping.** The cheap outcome is an ADR that says "use
  `PORTABLE_EXECUTABLE_DIR`" without engaging with why ADR-006 refused env vars.
  That produces a document that authorises the code without constraining it,
  which is worse than no ADR — it launders the contradiction. The
  build-supplied/user-supplied distinction has to survive being stated plainly.
- **Deciding the sync-guard question by omission.** Not mentioning it in the ADR
  is itself a decision, and it will be read as "portable is exempt" by whoever
  implements it.
- Comes near the AGENTS.md gotchas on the sync-folder guard and on
  `resolveDatabasePath()` being the only path to the database.
