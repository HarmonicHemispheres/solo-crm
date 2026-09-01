---
id: T-260901-04
title: Decide where a company's logo and banner live, and how a grid of them is read
status: open
category: docs
created: 2026-09-01
closed:
---

## Why

The request is that a company gets an uploadable icon/logo and a banner
image, shown on company detail and on every card in the companies list.

Nothing in the project has this. §6.2 gives a company an "identity colour"
and initials — `hue(name)` and `initials(name)`, derived, stored nowhere. The
requirements do not mention a company image, and neither does the mockup. So
this is a scope addition, and it is the kind that has to be decided before it
is built rather than discovered afterwards, for one specific reason:

[ADR-012](../../decisions/ADR-012-operator-branding-storage.md) already
settled how operator-supplied images are stored — blobs in the database,
512 KB per slot — and bounded itself explicitly to **"two rows at most,
ever"**. Its size cap is argued entirely from read timing: "both slots are
read on every app start… roughly 1.4 MB of string arriving before the first
view renders — noticeable, bounded, and recoverable."

Per-company images break that argument's premise. A workspace with 60
companies, each with a logo and a banner, is 120 blobs, and the companies
grid wants all of them at once. At ADR-012's cap that is 60 MB of base64
crossing IPC to paint one list. "Bounded and recoverable" stops being true,
and it stops being true silently — on the developer's seeded database with
nine companies and no images, everything is fast.

## Scope

**In:** one ADR, `.dev/decisions/ADR-015-company-images.md` (confirm 015 is
free; two parallel scopes picking the next number has happened here before).
It must settle:

1. **Where the bytes live.** ADR-012's three tests apply unchanged and are
   the reason it chose the database: survives restart, moves with the data
   root behind ADR-006's pointer file, and is inside the nightly backup.
   Files in the data root fail the third quietly. Reach the same conclusion
   or overturn it explicitly.
2. **The table shape.** A `company_images` table keyed by
   `(company_id, slot)` with `slot IN ('logo','banner')` is the shape ADR-012
   already validated, one dimension wider. Note that AGENTS.md's UUID rule
   has a stated exemption for "tables keyed by natural identity" — decide
   whether a composite natural key qualifies, or whether this table takes a
   UUID primary key with a unique index on the pair. `branding` took the
   natural key; `taggings` was explicitly *not* exempted and took a UUID plus
   a unique index on its natural triple. That precedent points at a UUID here.
3. **The read path for a list — the decision this ADR exists for.** Options,
   with their costs: a separate per-company request the card issues lazily; a
   list channel that returns images only for the rows asked for; a stored
   downscaled derivative alongside the full image, so a card reads a few KB
   and only the detail page reads the original; or a cap low enough that the
   naive read is fine. Pick one and state the number a 60-company workspace
   actually transfers under it.
4. **Two caps, or one.** A 512 KB banner is a different thing from a 512 KB
   logo. If the answer to (3) is a derivative, say what dimensions it is
   generated at and with what — Electron ships `nativeImage.resize`, which
   avoids a new dependency and runs in main where the bytes already are.
5. **What is refused.** SVG stays refused, on `electron/shared/branding.ts`'s
   argument, which is *stronger* here: a banner renders across the whole
   companies grid. Restate the conclusion; do not re-derive it.
6. **Deletion.** A company is deletable. Its images must go with it — say
   whether that is a foreign key with `ON DELETE CASCADE` or the polymorphic
   cleanup [ADR-011](../../decisions/ADR-011-polymorphic-attachment-cascade.md)
   describes, and why. This is not a polymorphic attachment; it belongs to one
   table.

**Out:** the migration, the repository, the channels and the views — those are
[T-260901-08](T-260901-08-company-images-store.md),
[T-260901-12](T-260901-12-company-images-ipc.md),
[T-260901-14](T-260901-14-company-header-images-edit.md) and
[T-260901-15](T-260901-15-company-card-banner.md), none of which can start
until this lands. Out too: reopening ADR-012 for the rail's own two slots.

## Touches

- `.dev/decisions/ADR-015-company-images.md` (new)
- `planning/solo-crm-requirements.md` — §6.2 gains the image, since the
  requirements are currently silent and would otherwise contradict what ships
- `AGENTS.md` — only if the gotchas list gains one

## Acceptance

- [ ] The ADR answers all six questions above with reasons.
- [ ] It states the concrete byte volume a 60-company grid transfers under
      the chosen read path, as a number.
- [ ] It states the caps in bytes and, if a derivative is chosen, its pixel
      dimensions and the API that produces it.
- [ ] It says explicitly whether it extends or supersedes ADR-012, and
      ADR-012 gains a pointer either way — its "two rows at most, ever" is
      now a claim about the `branding` table specifically, and that has to
      read that way to someone who finds it first.
- [ ] §6.2 of the requirements describes company images, so the shipped app
      and the requirements do not disagree.
- [ ] `npm run check:index` passes (this is what catches an ADR number
      collision).

## Risks

- **Deciding the cheap thing.** Storing full-size banners and reading them
  all on the companies grid works perfectly on the seeded nine-company
  database and degrades on a real one. Whatever is chosen, it has to be
  chosen against a number, not against how it feels in dev.
- Widening the accepted image set "because a banner is decorative" would
  reverse ADR-012's SVG refusal at the point where it matters most. It stays
  refused.
- The database grows by the size of these images and the nightly JSON export
  copies tables — a 60 MB backup that used to be 2 MB is a consequence of
  choice (1) that has to be acknowledged, not discovered by X-04.
- This is a requirements change, not a bug fix. The ADR should say so plainly
  rather than presenting the feature as though it had always been in scope.
