---
id: T-260829-05
title: Open the image picker in main and expose branding over three channels
status: in-progress
category: ipc
created: 2026-08-29
closed:
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

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
