---
id: ADR-013
title: A portable build keeps its data beside the launched executable, and learns where that is from the launcher — never from a user's environment
status: accepted
date: 2026-08-31
---

## Context

An operator wants Solo CRM on a USB stick: one file to copy, no installer, data
that travels with it. The installed build cannot do this — it resolves its data
root to `app.getPath('userData')`, which is a folder on whatever machine ran the
installer.

The artifact shape was chosen before this ADR, not by it. On 2026-08-31 the
operator was shown electron-builder's single-file `portable` target and the
`zip`/`dir` folder alternative, with the trade-offs recorded in Alternatives
below, and chose the single `.exe` deliberately. This ADR records that choice
and the constraints it imposes; it does not re-open it.

**What the single-file target actually does is the whole problem.**
[`portable.nsi`](../../node_modules/app-builder-lib/templates/nsis/portable.nsi)
— app-builder-lib 26.15.3, read on 2026-08-31 — is a stub that:

- sets `$INSTDIR` to `$PLUGINSDIR\app` (line 33), or to `$TEMP\${UNPACK_DIR_NAME}`
  when that define exists (line 35);
- runs `RMDir /r $INSTDIR` (line 38) and extracts the whole unpacked app there;
- sets `PORTABLE_EXECUTABLE_DIR` to `$EXEDIR` — the folder holding the `.exe` the
  user actually double-clicked — via `SetEnvironmentVariable` (line 77);
- runs the extracted app with `ExecWait` (line 86);
- and, **after the app exits**, runs `RMDir /r $INSTDIR` again (line 90).

Two consequences follow, and neither is optional to design around.

**First, the directory containing the running executable is deleted on close.**
`process.execPath` and `app.getPath('exe')` name a temporary copy, not the
artifact the operator is holding. A database created beside the running
executable is destroyed by line 90 with no error, at any point, ever. This is
the single most dangerous fact in this decision, and it is why the fallback
behaviour in Decision 4 is load-bearing rather than defensive. By default the
extraction directory is `%TEMP%\<ksuid>` and the ksuid is fixed at build time
(`NsisTarget.js:246-247` defines `UNPACK_DIR_NAME` unless `unpackDirName` is set
to a truthy non-string), so it is the *same path on every launch of a given
build* — which makes "it seemed to work when I tested it twice" a plausible way
to not notice.

**Second, `PORTABLE_EXECUTABLE_DIR` is the only thing that knows where the
artifact lives.** The process cannot observe it. There is no supported
alternative, and that runs straight into
[ADR-006](ADR-006-data-root-pointer-file.md), which decided the data root is
named by a pointer file and **explicitly refused an environment variable**,
calling `SOLOCRM_ALLOW_SYNC_FOLDER_DB` "precedent for how narrow that mechanism
is meant to stay". [ADR-004](ADR-004-credentials-in-safestorage.md) refused env
vars for credentials on a related ground — "a packaged Electron app launched
from a dock has no shell to inherit an environment from". Reading
`PORTABLE_EXECUTABLE_DIR` without settling that tension would leave ADR-006
quietly contradicted by whoever wrote the code first.

**There is no per-target build flag to switch on instead.** `npm run dist` runs
`electron-vite build` once and `electron-builder --win` once; both targets wrap
the same `release/win-unpacked` payload and the same asar. electron-builder's
per-target configuration surface is `TargetSpecificOptions`, which is
`artifactName` and `publish` and nothing else (`app-builder-lib/out/core.d.ts:39`);
`files`, `extraResources` and `appId` are app- or platform-level, and `afterPack`
runs once per arch against the directory both targets share. So a compile-time
define or a marker file cannot differ between the installer and the portable
`.exe` without splitting the build in two. The mechanism therefore has to be an
*observation the running process makes about itself*, not a flag someone set.

Finally, the plan disagrees with the app. X-09's second acceptance criterion
reads "The packaged app finds its database in `userData`, not next to the
binary" — correct for the installed build, and the exact opposite of what a
portable build is for. It is amended by this ADR to bind the installed build and
name the portable exception.

## Decision

### 1. The artifact is electron-builder's single-file `portable` target

Added to `build.win.target` beside `nsis`, with its own `artifactName` so the two
`.exe` files cannot collide (T-260831-04). Both artifacts ship from every
release; the installer remains the default recommendation and the portable build
is the USB-stick case. Its costs — a 410 MB extraction on every launch, and a
data root the operator cannot relocate — are recorded in Consequences and are
accepted, not overlooked.

### 2. The portable marker is where the process is running from, not a variable

Solo CRM is running portable when **both** hold:

- `app.isPackaged` is true, and
- the directory holding the running executable (`dirname(app.getPath('exe'))`)
  is inside the OS temporary directory (`os.tmpdir()`).

Under the single-file target that is exactly the extraction directory —
`$PLUGINSDIR\app` (itself created under `%TEMP%` by `InitPluginsDir`) or
`$TEMP\<UNPACK_DIR_NAME>`. An installed build runs from
`%LOCALAPPDATA%\Programs\…` and can never satisfy it.

The comparison is a **normalised, segment-boundary containment check** —
`realpath` where the path exists, case-insensitive on Windows, matched on whole
path segments — for the same reason
[`sync-folder-guard.ts`](../../electron/main/db/sync-folder-guard.ts) does it
that way. A raw `startsWith` on the unresolved strings would both miss an 8.3 or
symlinked `%TEMP%` and match a sibling directory whose name merely begins with
it.

**The environment variable is never the signal.** It supplies a value once the
process has already established, from its own image location, that it is a
portable launch. That ordering is what makes Decision 4 possible: a portable
launch with no usable variable is a state the app can detect and refuse, rather
than one it silently mistakes for an ordinary install.

### 3. The portable data root is `PORTABLE_EXECUTABLE_DIR`, exactly

`resolveDataRoot()` returns that directory unchanged — no subfolder — so
`resolveDatabasePath()` returns `<that directory>/solocrm.db` and the exe and
its database sit side by side, which is the operator's whole mental model of the
artifact. Everything still composes **inside** `resolveDataRoot()`, so
`resolveDatabasePath()` remains the single seam the sync-folder guard runs on
(ADR-006 item 3, and the AGENTS.md gotcha it enforces). A portable path that
reaches `new Database(...)` by any other route is a bypass of the guard, not a
shortcut.

**Why this is not the escape hatch ADR-006 refused.** ADR-006 rejected
`SOLOCRM_DATA_ROOT`: a *user-supplied preference*, persisting silently across
every launch, with no safe empty state and a UI that should own it instead.
`PORTABLE_EXECUTABLE_DIR` is a different kind of thing on every one of those
counts. It is written by this project's own build output — the NSIS stub at
`portable.nsi:77` — into the child process's environment milliseconds before the
app starts. It persists for exactly one launch. It carries a *fact the process
cannot otherwise observe* rather than a preference, and it cannot express a
preference: its only possible value is the folder the launched artifact is
sitting in. An operator who wants their data elsewhere moves the `.exe`.

That distinction is binding, and it is stated as a test so it constrains future
code rather than merely authorising this change. **An environment variable may
name a data location only if all four hold:**

1. it is written by this project's own build output, not by a user's shell,
   profile, registry or shortcut;
2. it reports an observable fact about the running process, not a preference;
3. it is read only in a process state corroborated by something the environment
   cannot set — here, the app running out of its own extraction directory
   (Decision 2); and
4. it cannot select any location the artifact's own placement does not already
   determine.

Anything failing any of the four is the mechanism ADR-006 refused and needs its
own ADR. `SOLOCRM_ALLOW_SYNC_FOLDER_DB` is unaffected: it remains a yes/no risk
acknowledgement, not a location, and this ADR widens nothing about it.

ADR-006 item 6 ("No environment-variable override") is **extended, not
overturned**: it refuses a user-supplied data-root override, and it did not
consider a launcher-supplied fact about where the artifact was launched from.
ADR-006 stays `accepted`.

### 4. A portable launch that cannot determine a trustworthy root refuses to start

ADR-006 item 4's house rule applies here unchanged — a root that cannot be
trusted fails startup loudly and **never falls back**. Once Decision 2 says this
is a portable launch, the root is refused when `PORTABLE_EXECUTABLE_DIR` is:

- absent, empty, or whitespace;
- not an absolute path;
- equal to, or inside, the extraction directory — the folder `portable.nsi:90`
  deletes after the app exits; or
- otherwise inside `os.tmpdir()`, which is not durable storage regardless of
  what NSIS deletes.

Each throws into the existing `dialog.showErrorBox` + `app.exit(1)` path in
[`electron/main/index.ts`](../../electron/main/index.ts), the way
`DataRootPointerError` and `SyncFolderGuardError` already do, with a message
naming the portable case and saying the data would be deleted when the app
closes.

The two tempting fallbacks are both refused, and for different reasons. Falling
back to `app.getPath('userData')` produces a "portable" build that is silently
an installed one — the operator's stick holds an app and no data, and they find
out on the second machine. Falling back to the executable's own directory writes
into the folder line 90 deletes: **total, silent data loss, with a working app
right up until it closes.**

### 5. The sync-folder guard applies to the portable root, unchanged

No exemption. In portable mode the data root *is* the folder the `.exe` sits in,
so a portable build dropped in `OneDrive\Apps` or a Dropbox folder makes the
live SQLite file a synced file — precisely the corruption case the AGENTS.md
gotcha exists to prevent, arriving by a route that is much easier to hit by
accident than any installed build's. `assertPathOutsideSyncFolder` therefore runs
against the portable root exactly as it runs against every other, and
`SOLOCRM_ALLOW_SYNC_FOLDER_DB=1` remains the only override.

The refusal message gains one portable-specific sentence: the installed build's
implicit advice ("choose another folder") is useless here, because there is no
chooser — the fix is to move the `.exe` out of the synced folder. Wording lands
in T-260831-03.

### 6. `data-location.json` is ignored in portable mode, and never written

In portable mode `resolveDataRoot()` returns the portable root **without reading
the pointer file at all**, `writeDataRootPointer()` is never called,
`moveDataRoot()` is not offered, and the data-root UI (T-260828-18, T-260828-19)
is hidden or disabled — that UI half is a `ui` change and gets scoped separately
rather than folded into T-260831-03.

The reason is cross-contamination, in both directions. The pointer's fixed home
is `app.getPath('userData')`, which in a portable build still resolves to
`%APPDATA%\Solo CRM` — **shared with any installed copy on the same machine.**
Reading it would let the machine the stick is plugged into decide where the
portable app's data lives, which is the opposite of portable and would point two
copies of the app at one database. Writing it would silently repoint the
*installed* app's data root on its next launch: a portable run, which the
operator thinks touched nothing on the host, moving another app's data.

**`app.setPath('userData', …)` is not an implementation of any of this and must
not be used.** It is the obvious one-liner and it silently does four other
things: it moves ADR-004's `safeStorage` credential file onto the stick, where
DPAPI cannot decrypt it on any other machine; it moves Electron's caches and
window state; it relocates the pointer file, quietly reinstating the
pointer-beside-the-exe behaviour this rule refuses; and it does all of it
outside `resolveDataRoot()`, where none of the guards above can see it.

## Consequences

**Easier — the installed build does not change at all.** Decision 2's marker is
false for every non-portable launch, so `resolveDataRoot()` returns
`app.getPath('userData')` and honours the pointer file byte-for-byte as it does
today. T-260831-03's first acceptance criterion is the existing `data-root.test.ts`
suite passing unmodified, which is the right shape of proof.

**Easier — the guard needed no new thinking.** Because the portable root is
resolved inside `resolveDataRoot()`, `resolveDatabasePath()` is still the one
guarded seam, and the sync-folder check protects the portable root for free —
the same property ADR-006 got from the same arrangement.

**Easier — T-260831-04 has no marker to build.** That task was scoped expecting
to produce one (a build-time define, a file in `resources/`, a distinct
`appId`). Decision 2 removes that work and the class of bug that came with it:
two halves of a marker drifting apart and the portable build silently falling
back to `userData`. What T-260831-04 still owns is the target, the artifact
name, and the README/AGENTS.md text.

**Cost — 410 MB extracted on every launch.** Measured 2026-08-31:
`release/win-unpacked` is 410 MB against a 116 MB installer. Every launch of the
portable `.exe` copies all of it into `%TEMP%` before the window appears, and
reads it from wherever the artifact sits — including a USB 2.0 stick. This is
the price of the single-file shape and it is the first thing to revisit if
launch time proves unacceptable; Alternatives records what the trade was against.

**Cost — the database sits loose beside the executable.** `solocrm.db`,
`solocrm.db-wal` and `solocrm.db-shm` land in the same folder as the `.exe`,
with no subfolder to tidy them into. Deliberate: the alternative names a folder
the operator did not choose and splits "the thing you copy" into two things.

**Cost — a portable operator cannot relocate their data root.** Decision 6 takes
away the pointer file, `moveDataRoot()` and the settings UI in portable mode.
The replacement mechanism is moving the `.exe`, which is honest but is not the
same capability.

**Cost — the marker is a heuristic, not a proof.** A user who copies an
installed build's whole program directory into `%TEMP%`, runs it from there and
sets `PORTABLE_EXECUTABLE_DIR` gets portable behaviour. That is not something a
shell one-liner does by accident; it is deliberately reconstructing a portable
launch. Accepted as adequate for a single-user local-first desktop app, and
recorded rather than glossed, because it is the residual the four-part test in
Decision 3 does not close.

**Cost — two concurrent launches of one portable build collide.** With the
default `unpackDirName`, both launches use the same `$TEMP\<ksuid>`, and the
second one's `RMDir /r $INSTDIR` (`portable.nsi:38`) deletes the first one's
running directory. Inherited from the target, not introduced here; noted so it
is not diagnosed from scratch later. The database itself is unaffected — it is
on the stick, not in the extraction directory — which is the strongest argument
for Decision 4's refusal of any root under `%TEMP%`.

**Not decided here — the Electron profile does not travel.** ADR-004's
credentials, window state and Chromium caches still live in `%APPDATA%\Solo CRM`
on whatever machine runs the artifact, so a portable operator re-authorises every
integration per machine. `safeStorage` is per-machine encryption, so those
credentials could not travel even if the folder did; ADR-004 already names this
as correct behaviour for the two-machine case. Whether any of the rest should
follow the stick is a separate decision, interacting with ADR-004 and with the
installed copy sharing that folder, and Decision 6's prohibition on
`app.setPath` is what keeps it a decision rather than a side effect.

**Forecloses a portable build storing data anywhere but beside its own
executable.** There is deliberately no configuration, no pointer and no UI that
can move it. Any future need to relocate a portable root reopens this ADR rather
than adding a second mechanism.

## Alternatives

**The `zip` (or `dir`) target — a folder the operator unzips and copies.** This
was the technically safer option and it lost to a delivery requirement, not to a
technical argument. It wins on every engineering axis: `process.execPath` sits in
the real folder, so the data root is `dirname(process.execPath)` with no
environment variable, no ADR-006 tension and no four-part test needed; there is
no extraction, so launch is instant and the 410 MB is paid once at copy time
rather than on every run; and nothing is ever deleted on exit, so the
catastrophic failure mode Decision 4 exists to prevent does not exist at all. It
lost because the operator asked for one file to copy, and a folder of 400-odd
files is a different product to hand someone — it invites launching the wrong
`.exe`, and it does not survive being emailed or dropped in a shared folder as a
single artifact. **If the per-launch extraction cost later proves unacceptable,
this is the option to revisit, and this paragraph is the record that it was
never technically outargued.**

**An installed build plus a documented "copy your `userData` folder" workflow.**
Lost because it is not portable in any sense the operator meant: it needs an
installer run on every machine, and it makes the data root a manual copy
operation whose failure mode is two divergent databases.

**Read `PORTABLE_EXECUTABLE_DIR` whenever it is set.** Lost because it is exactly
the escape hatch ADR-006 refused, wearing a different name. A user could set it
in a shell, a shortcut's environment or the registry and silently relocate an
*installed* build's data root — a persistent, invisible location override with no
UI, which is the thing ADR-006 argued out in full. Decision 2's corroboration is
what reduces it from a general-purpose override to a fact about one launch.

**A build-time define, a marker file in `resources/`, or a distinct `appId`.**
Lost on a fact rather than a preference: both artifacts are packed from one
`electron-vite build` and one `electron-builder --win` invocation, over the same
`win-unpacked` payload, and electron-builder's per-target options are
`artifactName` and `publish` only (`core.d.ts:39`). A define or marker would be
identical in both artifacts, so it would mark the installer portable too. This
option does not exist; it only looks like it does.

**Split `npm run dist` into two compilations so a define can differ.** Lost on
cost against benefit. It doubles build time, doubles the surface
`release-version.mjs check`/`record` has to reason about, and creates two
`out/` trees that can differ in ways nobody intended — all to synthesise a
signal that Decision 2 obtains for free by asking where the process is running
from.

**Fall back to `app.getPath('userData')` when the portable root cannot be
determined.** Lost on ADR-006's own reasoning, which applies here with more
force. A silent fallback ships a "portable" build that is an installed one: the
operator's stick carries the app and none of the data, and they discover it on
the second machine, having by then done real work in two places.

**Fall back to `dirname(process.execPath)`.** Lost because under this target that
is the extraction directory, which `portable.nsi:90` deletes after the app
exits. Everything works — the app opens, saves, searches, closes — and the
database is gone. It is the worst available outcome and it is also the most
natural line of code to write, which is why Decision 4 names it explicitly
rather than leaving it to be inferred.

**Put the portable data in a subfolder beside the exe (`.\Solo CRM Data\`).**
Lost narrowly. It tidies three files away, but it invents a name the operator
did not choose, adds a directory that must be created before the guard runs, and
contradicts T-260831-03's already-approved acceptance criterion that
`resolveDatabasePath()` returns `<portable dir>/solocrm.db`. Not worth two
mechanisms for one root; revisit only if the sidecar files prove to be a real
problem in the QA pass (T-260831-05).

**Honour a `data-location.json` sitting beside the portable exe.** Lost because
it reintroduces ADR-006's pointer-to-the-pointer problem in a new place and
gives one value two mechanisms. It could only ever name somewhere *other* than
the stick, which is what the installed build is for, and it would make the
self-contained artifact quietly not self-contained.

**Exempt portable builds from the sync-folder guard, because "the operator
chose where to put the exe".** Lost because they did not choose a *database*
location — they chose where to keep a file they think of as an application, and
`OneDrive\Apps` or a synced `Documents` folder is an entirely ordinary place to
keep one. The sync daemon corrupts SQLite whether or not the placement was
deliberate, and a build being portable changes nothing about that. The deliberate
case already has its answer: `SOLOCRM_ALLOW_SYNC_FOLDER_DB=1`, which stays the
one documented override for both builds.
