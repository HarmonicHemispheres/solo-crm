# Tasks — September 2026

Status: ○ open · ◐ in-progress · ● done · ⛔ blocked · ✕ dropped
Category: 🗄 data · 🔌 ipc · 🎨 ui · 🔗 integration · 📦 build · 📄 docs

## Open

Eight issues reported against the 0.5.0 build, scoped on 2026-09-01. Three of
them turned out not to be defects: `/offerings` is a placeholder because the
offerings feature is unbuilt Phase 3 work, company images are a requirements
addition, and the Workspace Settings rearrangement departs from the mockup.
Each of those three needed a decision written down before code, which is what
the two 📄 docs tasks and the settings ADR are for.

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ◐ in-progress | [T-260901-14](T-260901-14-company-header-images-edit.md) | Give company detail its logo, its banner and a visible way in to editing | 🎨 ui | |
| ◐ in-progress | [T-260901-15](T-260901-15-company-card-banner.md) | Carry a company's banner onto its card, behind a gradient | 🎨 ui | |
| ○ open | [T-260901-16](T-260901-16-popover-layer-retarget.md) | Retarget the popover layer when a second InfoPopover opens over the first | 🎨 ui | |

## Closed this month

| | ID | Title | Cat | Plan | Run |
|---|---|---|---|---|---|
| ● done | [T-260901-01](T-260901-01-button-variant-required.md) | Give the Data view's two colourless buttons a variant, and make a third impossible | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-02](T-260901-02-detail-heading-type.md) | Style the detail-page heading so the banner reads as a banner | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-03](T-260901-03-settings-layout-decision.md) | Decide how Workspace Settings is organised, now that the mockup's card grid has stopped scaling | 📄 docs | | R-260901-01 |
| ● done | [T-260901-04](T-260901-04-company-images-decision.md) | Decide where a company's logo and banner live, and how a grid of them is read | 📄 docs | | R-260901-01 |
| ● done | [T-260901-05](T-260901-05-offerings-repository.md) | Build the offerings repositories — categories, offerings, versions | 🗄 data | P3-01 | R-260901-01 |
| ● done | [T-260901-06](T-260901-06-info-popover-primitive.md) | Extract ViewHeader's info popover into a primitive anything can use | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-10](T-260901-10-sheet-edit-target.md) | Open a sheet on a record that already exists, and give an engagement its edit affordance | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-07](T-260901-07-offerings-ipc.md) | Expose the offerings repositories over IPC | 🔌 ipc | | R-260901-01 |
| ● done | [T-260901-08](T-260901-08-company-images-store.md) | Store a company's logo and banner as bytes, per company | 🗄 data | | R-260901-01 |
| ● done | [T-260901-09](T-260901-09-settings-rebuild.md) | Rebuild Workspace Settings as a section rail over one vertical page | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-12](T-260901-12-company-images-ipc.md) | Expose a company's images over IPC, on the picker that never returns a path | 🔌 ipc | | R-260901-01 |
| ● done | [T-260901-11](T-260901-11-offerings-view.md) | Build the Offerings view | 🎨 ui | P3-07 | R-260901-01 |
| ● done | [T-260901-13](T-260901-13-engagement-offering.md) | Sell an engagement from an offering, snapshotting the rate once | 🎨 ui | P3-03 | R-260901-01 |

## Order

Four groups, and only the dependencies inside each one are real.

**Independent — nothing waits on them.** T-260901-01 (button variant),
T-260901-02 (detail heading), T-260901-06 (info popover primitive),
T-260901-10 (sheet edit target). The first two are the smallest fixes in the
batch and each closes a class of bug rather than one instance.

**Offerings** — T-260901-05 → T-260901-07 → T-260901-11, with T-260901-13
after both T-260901-07 and T-260901-10. This is a whole unbuilt slice of
Phase 3 and it is the largest single chunk here.

**Settings** — T-260901-03 (ADR) → T-260901-09, which also needs T-260901-06.
The rebuild cannot start until the ADR names the sections and says which
prose moves behind a popover and which stays visible.

**Company images** — T-260901-04 (ADR) → T-260901-08 → T-260901-12 →
T-260901-14 and T-260901-15. T-260901-14 also needs T-260901-02 (which fixes
the same header) and T-260901-10 (for the edit affordance). T-260901-12 is
the riskiest task in the batch: it widens the one channel in the app that
touches the filesystem for the renderer, and it carries a `security-review`
gate alongside T-260901-07's.
