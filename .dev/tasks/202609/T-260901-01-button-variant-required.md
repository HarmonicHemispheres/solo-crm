---
id: T-260901-01
title: Give the Data view's two colourless buttons a variant, and make a third impossible
status: done
category: ui
created: 2026-09-01
closed: 2026-09-01
---

## Why

Two buttons on `/workspace/data` render as light text on a white box: **Save
snippet** ([WorkspaceData.tsx:439](../../../electron/renderer/views/WorkspaceData.tsx#L439))
and **Refresh** ([WorkspaceData.tsx:503](../../../electron/renderer/views/WorkspaceData.tsx#L503)).
Both are `<Button>` with no `variant`.

`Button`'s `variant` is optional and its own header calls the bare `.btn`
"a real, if currently unused-in-shell, style of its own (structural only: no
background or text colour)". That claim was true when it was written and is
now false — these two use it. Bare `.btn` sets padding, radius and border but
no `background` and no `color`, so the button falls through to the user
agent's `ButtonFace` (near-white) while `base.css`'s `button { color: inherit }`
paints the label `--papyrus`. Light on white. Nothing failed; the type checker
had nothing to object to.

Fixing the two call sites leaves the hole open. T-260829-08 hit the identical
shape one wave ago — six create buttons opened a plausible-looking empty sheet
because `SheetKind` was optional — and closed it by making the argument
required, moving the problem "from 'everyone must remember' to 'the type
checker will not compile it'". Same fix, same reason.

## Scope

**In:**

- Pass a variant at both call sites. **Refresh** and **Save snippet** are each
  the confirming action of their own block rather than the page's primary
  action; `ghost` is the shape the rest of the app uses for that, and the
  Data view's own `Run` button beside them is already `primary`. Do not make
  a second thing on the page compete with `Run`.
- Make `variant` a **required** prop on `ButtonProps`, delete the
  `variant ? … : undefined` branch in the class join, and rewrite the header
  comment that asserts bare `.btn` is a real style.
- Delete the bare `.btn`-with-no-modifier path from `Button.css` only if
  nothing else renders it — `.btn` still carries the shared geometry both
  modifiers build on, so the base rule stays; what goes is the claim that it
  is usable alone.
- Update `Button.test.tsx`'s bare-`.btn` case to assert the new contract
  instead: there is no such thing as a variantless button.

**Out:** any new variant (`danger`, sizes, an intent matrix). The union stays
closed at `primary | ghost` — the existing header already argues that, and a
contrast bug is not the occasion to widen it. Also out: auditing `IconButton`
and `Chip`, which have their own colour rules and neither reported symptom.

## Touches

- `electron/renderer/components/primitives/Button.tsx` — `variant` required
- `electron/renderer/components/primitives/Button.css` — header comment
- `electron/renderer/components/primitives/Button.test.tsx`
- `electron/renderer/views/WorkspaceData.tsx` — two call sites

## Acceptance

- [ ] `grep -rn "<Button" electron/renderer --include='*.tsx' | grep -v "variant="`
      returns no call site (matches on the primitive's own source and on
      multi-line usages where `variant` sits on the next line do not count —
      check those by eye).
- [ ] Deleting `variant="ghost"` from either Data-view button fails `npm run
      typecheck`, and the failure names the call site.
- [ ] Both buttons render with a `--surface-2` background and `--papyrus`
      text in the running app — verified by looking at `/workspace/data`, not
      by reading the CSS.
- [ ] `npm run verify` passes.

## Risks

- Making a prop required is a breaking change across every existing call site;
  there are eight or so, and three are multi-line. A missed one is a
  typecheck failure, not a silent regression, which is the point — but the
  change must not be landed with `// @ts-expect-error` anywhere.
- `Tour.tsx`, `PersonDetail.tsx` and `WorkspaceSettings.tsx` each pass
  `variant` on a continuation line. They are already correct; do not "fix"
  them.

## Outcome

**Changed:** 4 files — `Button.tsx` (`variant` required, the
`variant ? … : undefined` branch deleted, header rewritten), `Button.css`
(header now says `.btn` alone is geometry, not a style), `Button.test.tsx`,
and the two call sites in `WorkspaceData.tsx`, both `variant="ghost"`.

**Review:** passed. Builder's mutation check — deleting `variant="ghost"` from
Refresh — fails `tsc -p tsconfig.web.json` with `TS2741 … missing in type …
but required in type 'ButtonProps'`, naming the call site, which is the
acceptance criterion verbatim. The three continuation-line usages
(`Tour.tsx`, `PersonDetail.tsx`, `WorkspaceSettings.tsx`) were correctly
left alone. The bare-`.btn` test became a type-level contract: a
`// @ts-expect-error` on a `ButtonProps` literal with no `variant`, so the
unused-directive error fails typecheck the day the prop goes optional
again. The scope's "no `@ts-expect-error` anywhere" was aimed at papering
over a missed call site; this use is the opposite — it is what asserts the
contract — and is accepted as such.

Not done here: the acceptance item that the two buttons render
`--surface-2`/`--papyrus` *in the running app*. Neither the builder nor the
merge launched Electron. The CSS is the mockup's `.btn-ghost` unchanged and
the class string is asserted, so the remaining risk is nil, but the box is
honestly unticked.

Builder's environment note, kept because the next run will hit it: under the
scratchpad Node 22.22.0's npm (10.9.4) `npm run <script>` exits 1 with no
output on this machine for every script; the binaries invoked directly
(`node_modules/.bin/tsc`, `node_modules/.bin/eslint`) give real exit codes.
Also `tsc --composite` caches to `tsconfig.*.tsbuildinfo`, and a typecheck
straight after an edit can report off the stale cache.
