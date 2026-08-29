---
id: T-260829-07
title: Upload an icon and a logo in Workspace Settings, and show them in the rail
status: open
category: ui
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

This is the feature the other three tasks exist for: the operator points at two
image files on their own disk and the top-left of the app becomes theirs. The
store (T-260829-04) and the channels (T-260829-05) have no user-visible effect
until something calls them; the settings card and the rail's consumption of the
same state must land together, because an upload that changes nothing on screen
is not a shippable half.

The two slots are independent. Replacing the icon leaves the logo alone and vice
versa, and either can be removed back to the built-in default on its own.

## Scope

**In:**

- A sixth `<Card>` in the settings grid, **Branding**, placed next to Identity
  in `electron/renderer/views/WorkspaceSettings.tsx`. Two rows — Icon and Logo —
  each built from the existing `.field` / `.k` / `.v` row (declared in
  `CompanyDetail.css:116-142`, reused deliberately per the comment at the top of
  `WorkspaceSettings.css`), each carrying:
  - a preview box at the size the rail actually renders it — 25 × 25 for the
    icon, 104px wide for the logo — showing the current image, custom or default;
  - a state line: `Solo CRM default`, or `Custom · PNG · 34 KB` from the slot
    state's `contentType` and `byteLength`. No filename — the channel does not
    return one and must not start;
  - a `<Button>` reading **Upload…** when default and **Replace…** when custom,
    calling `branding:choose` for that slot;
  - a ghost **Remove** button, rendered only when the slot is custom, calling
    `branding:clear`.

- A short caption under the two rows, in the honest register the backup row
  already uses (`WorkspaceSettings.tsx:401-404`): what formats are accepted, the
  size cap, and that SVG is not one of them. An operator who picks an SVG must
  read why, not just that it failed.

- Query wiring: a `queryKeys.branding.current()` key, `ipcQueryFn('branding:get')`,
  and mutations for `choose` and `clear` that invalidate it on success. Follow
  `useSettingsSnapshot` / `useSetSetting` (`WorkspaceSettings.tsx:57-78`) —
  except **do not write an optimistic cache entry for an upload**, because the
  result depends on a dialog the renderer cannot predict and on a refusal it
  cannot anticipate. Show the new image when the channel returns it.

- Rail consumption in `Rail.tsx`: the same `branding:get` query, deduped with the
  settings view by sharing the key. When `icon.kind === 'custom'` render
  `<img>` at the mark's box with `object-fit: contain`; otherwise the built-in
  inline SVG. Same for the wordmark. **The default renders while the query is in
  flight** — never a blank box, never a layout shift when the image arrives; the
  boxes are the fixed sizes `Rail.css:22-35` already sets.

- Accessibility: the custom images are decorative markup carrying no text, so
  `alt=""` with the accessible name on the brand container, derived from
  `settings['workspace.name']` when set and falling back to `Solo CRM`. The
  brand block must not keep announcing a product name that is no longer what is
  drawn.

- A refused upload — wrong format, over the cap — surfaces the channel's message
  in the card, next to the row that failed, and clears itself on the next
  successful action. A cancelled picker shows nothing at all; it is not an error.

- Renderer tests: default state renders the inline SVG in both the card and the
  rail; a custom state renders an `<img>` whose `src` starts `data:image/`;
  Remove is absent for a default slot and present for a custom one; a mutation
  error renders its message; the two slots are independent — a custom icon with a
  default logo renders one `<img>` and one inline SVG.

**Out:** the picker and the storage (T-260829-05, T-260829-04 — this task calls
them and assumes them). Drag-and-drop onto the card. Cropping, scaling or any
editing of the chosen image. Branding anywhere else in the app — window icon,
installer, print or export. Wiring the still-disabled backup folder button.

## Touches

- `electron/renderer/views/WorkspaceSettings.tsx`, `WorkspaceSettings.css`
- `electron/renderer/components/shell/Rail.tsx`, `Rail.css`
- `electron/renderer/lib/query-keys.ts` (or wherever `queryKeys` is declared)
- the corresponding renderer tests

## Acceptance

- [ ] `npm run verify` passes.
- [ ] In a real window: upload an icon, and the rail's mark becomes it **without
      a reload**. Upload a logo, and the wordmark becomes it. Remove each, and the
      built-in default returns. Screenshots of all three states in the outcome.
- [ ] Uploading only the icon leaves the wordmark at its default, and the reverse
      — verified in the app, not only in a test.
- [ ] Restarting the app keeps both custom images.
- [ ] Choosing an SVG shows a message in the card naming SVG as unsupported, and
      the rail does not change.
- [ ] Cancelling the picker produces no error state anywhere in the card.
- [ ] The rail does not shift, resize or flash between first paint and the
      branding query resolving, with a custom image set.
- [ ] `queryKeys.branding.current()` is used by both `Rail.tsx` and
      `WorkspaceSettings.tsx`, so opening settings issues no second fetch.

## Risks

- **Layout shift is the likely defect.** An operator's logo is not the aspect
  ratio of the built-in one; without a fixed box and `object-fit: contain`, the
  rail's nav shifts down on load and the app looks broken for one frame on every
  start.
- A tall or near-square image in the 104px wordmark slot will render tiny inside
  its box. That is correct behaviour rather than a bug, but the preview in the
  card must show it at the same size the rail will, or the operator finds out
  afterwards.
- Sharing the query key between the rail and the settings view is what stops a
  double fetch, and it is exactly the kind of thing a later refactor separates
  without noticing. The acceptance criterion pins it.
- `img-src 'self' data:` is the whole reason these images render. Anyone
  reaching for an object URL here will get a silent failure — see T-260829-05.
- The rail is on the render path for every route; an image decode on each nav
  would be felt. The `data:` URL is stable across renders as long as the query
  result is not rebuilt per render.

---

## Outcome

*Appended at close. Delete this heading if the task is dropped.*

**Changed:** files that actually moved, one line each.

**Review:** what `code-review` found and what was done about each finding.

**Deferred:** anything cut, and where it went (new task ID, or nowhere and why).
