---
id: T-260829-05
title: Open the image picker in main and expose branding over three channels
status: done
category: ipc
created: 2026-08-29
closed: 2026-08-29
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

The renderer cannot read a file, and it must not start. Every other picker in
this app is driven from main — the first-run data location prompt and the
Move Data Folder menu item both build a structural dialog interface and call
`showOpenDialog` there — but neither is reachable from the renderer, and there
is no `dialog:*` channel in `CHANNEL_CONTRACTS`. That gap is already visible in
the app: the backup folder row in Workspace Settings ships a disabled "Choose
folder" button whose title says the main-process dialog channel does not exist.
Branding needs the same thing, and needs it in the shape that keeps the
filesystem on the main side of the boundary: the renderer asks for a picker by
slot and gets back an image, never a path.

## Scope

**In:**

- `electron/main/branding/picker.ts` — a `BrandingDialog` structural interface
  in the idiom of `FirstRunDialog` (`electron/main/first-run/data-location-prompt.ts:47-73`)
  and `MoveDataFolderDialog` (`electron/main/app-menu.ts:34-51`): declared
  locally, injectable for tests, never importing Electron's `dialog` as a value
  in the unit-tested path. It widens the established shape by exactly what this
  needs — `properties: ['openFile']` and a `filters` entry naming the accepted
  raster extensions. Extensions in the filter are a convenience for the operator;
  the decision that admits or refuses the bytes is still the sniff in
  T-260829-04, never the extension.

- Reading the chosen file **bounded** — refuse before allocating if the file's
  size on disk exceeds the declared cap, so a 2 GB file selected by accident is
  a refusal and not a read. Follow `readBounded` in
  `electron/main/favicons/fetch.ts:139-176` for the shape of a bounded read.

- Three channels in `electron/shared/ipc-types.ts` + handlers in
  `electron/main/ipc/registry.ts`:

  | Channel | Request | Response |
  |---|---|---|
  | `branding:get` | `undefined` | `{ icon: BrandingSlotState, logo: BrandingSlotState }` |
  | `branding:choose` | `{ slot }` | `MutationResult<BrandingChoice>` |
  | `branding:clear` | `{ slot }` | `MutationResult<BrandingSlotState>` |

  `BrandingSlotState` is `{ kind: 'default' } | { kind: 'custom', dataUrl,
  contentType, byteLength, updatedAt }`. The `dataUrl` is
  `data:<type>;base64,…`, built exactly as `electron/main/favicons/service.ts:73-82`
  builds one — the renderer's CSP is `img-src 'self' data:`, so a `data:` URL
  needs no CSP change while a `blob:`, an `http(s):` URL or a custom scheme
  would each mean editing `buildContentSecurityPolicy`. Do not edit it.

  `BrandingChoice` is `{ outcome: 'chosen', state } | { outcome: 'cancelled' }`.
  **A cancelled dialog is a success, not an error** — the operator closing a
  picker must not surface as a failed mutation.

- `branding:get` is a synchronous read of the database, like `favicons:get`. It
  never opens a dialog and never touches the filesystem.

- **Single-flight per window.** A second `branding:choose` while a picker is
  already open resolves as `{ outcome: 'cancelled' }` rather than stacking two
  native dialogs. `branding:choose` with no focused `BrowserWindow` is refused.

- Tests: a fake dialog returning a path to a fixture PNG stores the slot and
  returns `outcome: 'chosen'` with a `data:image/png;base64,` prefix; a fake
  returning `canceled: true` returns `outcome: 'cancelled'` and leaves the slot
  as it was; a fixture SVG chosen through the dialog is refused as a mutation
  error and stores nothing; a file over the cap is refused **without being read
  into memory**; two overlapping `choose` calls open one dialog; `branding:clear`
  on a default slot returns `{ kind: 'default' }` rather than erroring.

**Out:** every renderer change (T-260829-06, T-260829-07). A general
`dialog:pickFile` channel — this exposes one purpose-built channel, and a
generic file picker over IPC is a materially larger boundary that deserves its
own scope. Wiring the backup folder's disabled "Choose folder" button; it needs
a directory picker, not an image one, and folding it in here widens a
security-reviewed diff for an unrelated feature. File it as a follow-up instead.

## Touches

- `electron/main/branding/picker.ts` (new) + its test
- `electron/shared/ipc-types.ts` — schemas and three `CHANNEL_CONTRACTS` entries
- `electron/main/ipc/registry.ts` — three handlers
- `electron/preload/index.ts` — expected to need **no change**; `buildCrmApi`
  iterates `CHANNEL_NAMES`. If it does change, say why in the outcome.

## Acceptance

- [ ] `npm run verify` passes.
- [ ] `window.crm['branding:get']`, `['branding:choose']` and `['branding:clear']`
      exist in a running renderer, and no preload edit was needed to get them there.
- [ ] No response from any of the three channels contains a filesystem path —
      asserted in a test over the returned object, not by inspection.
- [ ] A cancelled picker returns `{ outcome: 'cancelled' }` with `ok: true`; the
      slot's state before and after is identical.
- [ ] Choosing a file larger than the cap refuses with a message naming the cap,
      and the test asserts the file was never fully read.
- [ ] `grep -n "img-src" electron/main/security.ts` shows `img-src 'self' data:`
      unchanged, and `grep -rn "protocol.handle\|registerFileProtocol" electron/`
      still returns nothing.
- [ ] `security-review` runs on this diff and its findings are recorded in the
      outcome. Category `ipc` makes this the gate, not an option.

## Risks

- **This is the first renderer-reachable native dialog in the app.** It is a new
  capability across a boundary whose whole design is that the renderer cannot
  reach the filesystem. The property that keeps it honest is that the path never
  crosses back; a helpful-looking addition like returning the chosen filename to
  show in the UI would quietly undo it.
- A modal picker opened from an unfocused or destroyed window can hang the main
  process. The focused-window check and single-flight guard are the mitigation,
  and both need tests, not comments.
- `data:` URLs are the only image transport the CSP admits. A builder who
  reaches for `URL.createObjectURL` will see a silent refusal in the renderer
  with nothing in the main-process logs — the failure will look like "the image
  didn't load", not like a CSP decision.
- The `filters` array will make an operator think an `.svg` can be chosen if it
  is listed. It must not be listed.

---

## Outcome

**Changed:**

- `electron/main/branding/picker.ts` (new) — `BrandingDialog` / `BrandingWindowSource` structural interfaces, `chooseBrandingImage`, the stat-then-read bounded read, the `data:` URL builder, and `IMAGE_FILTER_EXTENSIONS` with no `svg` in it.
- `electron/main/branding/index.ts` (new) — one entry point for the IPC layer, mirroring `favicons/index.ts`.
- `electron/main/branding/picker.test.ts` (new) — 20 tests, and `test-support/path-leak.ts`, the walker both test files use.
- `electron/shared/branding.ts` — the wire schemas, per ADR-007 (the entity's own module owns them; `ipc-types.ts` imports).
- `electron/shared/ipc-types.ts`, `electron/main/ipc/registry.ts` — three contracts, three handlers.
- `electron/main/ipc/registry.test.ts`, `bridge.test.ts` — 8 end-to-end channel tests, and the real sandboxed-Electron harness now asserts all three channels exist on `window.crm`.
- `electron/renderer/lib/test-support/stub-crm.ts` — three defaults; `CrmApi` is total, so typecheck failed without them.

**`runMutationAsync` was added, and the reason is worth keeping.** `branding:choose`
is the first handler that awaits, and the existing synchronous `runMutation`
would have returned `{ ok: true, data: Promise }` — turning every refusal into an
unhandled rejection instead of an error envelope. The catch half was extracted to
`mutationFailure` and is shared, so the sync and async wrappers cannot translate a
refusal differently.

**Review:** no blocking findings.

**`security-review` ran, as category `ipc` requires.** The skill's own invocation
diffed against `origin/main` — 212 commits back — and swept the whole project, so
it was re-run scoped to `main..T-260829-05` (ten files, 61 KB). **Result: no
findings that meet the bar**, with file:line evidence for each property:

- *No path crosses back.* Success returns four fields built at `picker.ts:158-167`; the chosen `path` is a local const never stored, returned or logged. Both `fs` call sites use a bare `catch {` that discards Node's path-bearing `.message` before it can reach `mutationFailure`'s verbatim relay. Anything that is not a `RepositoryError` is rethrown and `ipc/index.ts` substitutes a fixed sentence. Both `brandingSlotStateSchema` branches are `.strict()`, so a later `fileName` field would fail response validation rather than ship.
- *Cap before allocation.* `picker.ts:191-212` is stat → compare → throw → read, with the reader resolved but not invoked before the check. The stat/read TOCTOU gap is closed for correctness by `writeBrandingSlot`'s post-read re-check.
- *CSP and protocol handlers untouched.* `security.ts` is not in the changed set; `img-src 'self' data:` unchanged; no protocol, object-URL or `webSecurity` hit in the added lines.
- *Injectable deps unreachable.* The handler forwards only `slot`, and the request schema is `.strict()`, so a `{ slot, deps }` payload is rejected before the handler runs.
- *Content type is a sniffed literal* from a closed set, re-checked by a `z.enum` on the response, so the `data:` URL is not injectable.
- *`slot` is validated three times* — wire enum, `requireKnownSlot`, and bound as `?` in every statement.
- *Both guards hold.* No focused window is a throw, not a fallback; `IN_FLIGHT.has/add` runs with no intervening `await`, so two same-tick calls cannot both pass.

The reviewer also confirmed the property is *proven, not asserted*: the path-leak
walker exempts only a strictly-anchored `data:image/…;base64,…` and exact
membership of `BRANDING_CONTENT_TYPES`, and there is a guard-the-guard test showing
it would catch a path smuggled behind a `data:` prefix; `registry.test.ts`'s sweep
asserts `refusals).toHaveLength(2)` so it cannot pass vacuously over successes.

**Preload needed no change, and that is proved rather than argued:** `bridge.test.ts`
boots real sandboxed Electron with the real bundled preload and finds all three
channels are functions on `window.crm`, calling `branding:get` against a real
migrated database. `branding:choose` is deliberately not called there — it would
open a native picker no harness could dismiss.

`typecheck`, `lint`, the whole `--project=node` (34 files, 754 tests), the whole
`--project=renderer` (51 files, 421 tests) and the real-Electron bridge test all
passed on the branch; picker and registry (52 tests) passed again on the merged tree.

**Deferred:**

- **`BrandingSlotState` is `{ state: 'present' | 'absent', slot, … }`, not the `{ kind: 'default' | 'custom' }` sketch in this scope's table.** The shipped T-260829-04 shape won, correctly — the merged schema is the source of truth, not a scope written before it existed. [T-260829-07](T-260829-07-branding-card-rail-override.md) consumes this and its scope quotes the old sketch; it must read `electron/shared/branding.ts` rather than its own table.
- Three files outside the scope's Touches were changed, each for a stated reason: `shared/branding.ts` is ADR-007's required home for wire schemas; `stub-crm.ts` is forced by `CrmApi` being total rather than partial; `bridge.test.ts` is what makes the "exists in a running renderer" criterion mechanical instead of argued.
- The backup folder's still-disabled "Choose folder" button was left alone, as the scope directs — it needs a directory picker, not an image one. Not yet filed as its own task.
