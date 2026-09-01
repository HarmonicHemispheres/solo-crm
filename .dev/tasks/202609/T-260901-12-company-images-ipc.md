---
id: T-260901-12
title: Expose a company's images over IPC, on the picker that never returns a path
status: done
category: ipc
created: 2026-09-01
closed: 2026-09-01
---

## Why

[T-260901-08](T-260901-08-company-images-store.md) gives per-company images a
home in the database. The renderer cannot put anything in it: it never touches
the filesystem, and it must never learn one. Choosing an image means a native
dialog, and a native dialog lives in main.

That flow already exists, once, for the workspace's own icon and logo.
`electron/main/branding/picker.ts` is the app's only renderer-triggerable
native dialog, and its header states the property the whole design rests on:
"The renderer asks for a picker by slot and receives an image. It never
receives the chosen file's path, its directory, or its basename — not in the
success branch, not in a refusal message, not in an error thrown out of here."
It stats before it reads so an oversized file is refused without allocating,
it single-flights per window so two calls cannot stack two modals, and it
refuses outright when no window has focus rather than leaving a modal nobody
can dismiss.

This task adds a second caller. The failure mode is not that it does not work
— it is that it works while quietly holding one property fewer.

## Scope

**In:**

- `companyImages:choose` (company id + slot), `companyImages:clear`,
  `companyImages:get` (one company), and the list read
  [T-260901-04](T-260901-04-company-images-decision.md) specified for the
  companies grid.
- **Reuse `picker.ts`, do not copy it.** The single-flight `WeakSet`, the
  focused-window refusal, the stat-then-read bound, the hand-written
  path-free refusal messages and the `data:` URL construction are all
  existing, tested code. Generalise it to take a target and a cap rather than
  writing a second picker beside it — a copy is how one of them ends up with
  the guard and the other without.
- `data:` URLs, not `blob:` and not a custom protocol. The renderer's CSP is
  `img-src 'self' data:` (`main/security.ts`); the other two mean widening
  the policy that keeps the renderer from addressing local files. T-260829-05
  has an acceptance criterion that greps `electron/` for those API names and
  requires no hits — that grep must still come back empty.
- Cancelling is a **success that changed nothing**, as `brandingChoiceSchema`
  models it, not an error envelope.
- The renderer plumbing: query keys and an invalidate helper, preload
  surface, `window.d.ts`, and a stub per channel in `stub-crm.ts`.

**Out:**

- Any view ([T-260901-14](T-260901-14-company-header-images-edit.md),
  [T-260901-15](T-260901-15-company-card-banner.md)).
- Changing the `branding` channels or their two slots.
- A drag-and-drop or paste path. That is a second way for bytes to enter and
  it would need its own analysis; the picker is what was asked for.
- Fetching a logo from a company's website. AGENTS.md: never call a
  third-party favicon service — and the existing `favicons` table already
  covers the derived case, separately.

## Touches

- `electron/main/branding/picker.ts` — generalised (and probably renamed out
  of `branding/`, since it stops being about branding)
- `electron/main/branding/picker.test.ts` and
  `electron/main/branding/test-support/path-leak.ts` — the path-leak walker
  runs over the new channels' responses too
- `electron/shared/company-images.ts` — the request/response schemas
- `electron/shared/ipc-types.ts`, `main/ipc/registry.ts`, `main/ipc/index.ts`
- `electron/preload/index.ts`, `electron/renderer/window.d.ts`
- `electron/renderer/lib/query-keys.ts`
- `electron/renderer/lib/test-support/stub-crm.ts`

## Acceptance

- [ ] `test-support/path-leak.ts` walks every new channel's success response
      **and** every refusal message, and finds no path separator, no drive
      letter and no basename — the same assertion the branding channels
      already pass, extended, not re-implemented.
- [ ] A file over the cap is refused **before** the read: the injected
      `readFile` is asserted never to have been called, which is what
      T-260829-05's own test asserts and the reason `stat` and `readFile` are
      separate dependencies.
- [ ] A second `choose` while a picker is open resolves as `cancelled` rather
      than opening a second dialog.
- [ ] `choose` with no focused window is refused, with a path-free message.
- [ ] A request naming a company id that does not exist is refused and no row
      is written.
- [ ] Cancelling returns a success whose outcome is `cancelled`, and the
      stored image is unchanged.
- [ ] `grep -rn "createObjectURL\|registerFileProtocol\|blob:" electron/`
      returns nothing.
- [ ] `npm run verify` passes.
- [ ] `security-review` has run over this surface — together with
      [T-260901-07](T-260901-07-offerings-ipc.md)'s channels if both land in
      the same wave — and its findings are recorded.

## Risks

- **This is the highest-risk task in the batch.** It widens the one channel
  in the app that touches the filesystem on the renderer's behalf, and every
  guard in `picker.ts` is load-bearing. `.dev/README.md`'s rule applies:
  `security-review` runs over the accumulated surface, in its own session,
  not per diff.
- Generalising `picker.ts` means editing tested code that currently holds a
  property no test can fully express. Prefer changes that keep the existing
  tests passing verbatim; a test that had to be rewritten to accommodate the
  refactor is a signal, not an inconvenience.
- A company id is now part of a picker request. It is a UUID the renderer
  already holds, so it leaks nothing — but the refusal path for an unknown id
  must not echo anything back beyond "no such company".
- The list read returns many images at once. Whatever ADR-015 chose, the
  channel must not become the one place the decision is quietly widened
  because it was convenient to return everything.

## Outcome

Merged into `main` from branch `T-260901-12` (builder `bf3dee2`, one test
added at merge in `63d7710`). Eleven files.

- **The picker was generalised by extraction, not moved.** The guards —
  focused-window refusal, the single-flight `WeakSet` (one set, shared by
  both callers, so a branding picker and a company picker over the same
  window cannot stack), stat-then-read bounded by the target's cap, the
  hand-written path-free refusals and `imageDataUrl` — now live once in
  `electron/main/images/picker.ts` as `pickImage(target: PickTarget, deps)`,
  resolving to `{ outcome: 'cancelled' } | { outcome: 'picked'; bytes }` and
  never a path. `electron/main/branding/picker.ts` is a thin adapter keeping
  every export it had, so `branding/index.ts` and `branding/picker.test.ts`
  are byte-for-byte unchanged and still pass. What differs per caller is the
  `PickTarget` — title, offered extensions, `maxBytes`, `limitLabel` — and
  the guards are not on that interface, so a caller cannot opt out of one.
- `electron/shared/company-images.ts` gained the wire: per-slot
  `companyImageSlotStateSchema` (`present` with `dataUrl`, `byteLength`
  refined against the slot's own cap, `width`/`height`, `updatedAt`; or
  `absent`), `companyImagesSnapshotSchema` (both slots, total by
  construction), the two `.strict()` request schemas, `companyImageChoiceSchema`
  (cancel is a success branch, as `brandingChoiceSchema`) and
  `companyImageThumbnailsSchema` — the id-keyed map ADR-015 §4 specifies,
  derivatives only, no `byteLength`.
- Four channels in `registry.ts`: `companyImages:thumbnails` (request
  `z.undefined()`; folds the repository's flat list into the map),
  `companyImages:get`, `companyImages:choose` and `companyImages:clear`.
  Unknown company on `choose`/`clear` surfaces the repository's own
  `NotFoundError` with no row written; `get` on an unknown id answers
  absent/absent — a plain read with nothing to leak. `preload/index.ts` and
  `window.d.ts` needed no edit: both are generic over `CHANNEL_CONTRACTS`.
- `queryKeys.companyImages.{all,thumbnails,detail}` and
  `invalidate.companyImages`; one stub per channel in `stub-crm.ts`.
- The company picker offers `png/jpg/jpeg` only — the dialog must not offer
  what the store refuses.

Acceptance: every box ticked except `npm run verify` (ran as the underlying
tools on the scratchpad Node 22.22.0 — run summary) and **`security-review`,
which is pending** — it runs in its own session, over these four channels
together with T-260901-07's ten. The acceptance grep finds three hits, all
pre-existing prose in `branding.ts`, `favicons.ts` and
`favicon-boundary.test.ts` naming the APIs in order to forbid them; none is
code and none is this task's.

**Review.** Seven mutants. Six died as written: single-flight removed,
cap ignored, stat-failure message carrying the path (caught by the
`path-leak.ts` walker), thumbnails collapsing both slots onto `logo`, the
logo picker given the banner's cap, and `clear` doing nothing (registry
test). One survived — `canceled: true` with a path still in `filePaths`
was read anyway — because every cancel fixture answered an empty
`filePaths`. Electron does answer empty on cancel, so the mutant is close to
equivalent in production, but the flag is the contract and the guard is the
kind that goes missing in a copy; a test now asserts the flag decides and
`stat` is never called (`63d7710`).

**Not eyeballed:** no view reads these channels yet (T-260901-14, 15). The
native dialog has not been opened in the running app.
