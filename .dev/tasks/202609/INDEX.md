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

T-260901-19 to -28 came out of a whole-repository review on 2026-09-01 (main,
renderer, tooling and docs, each by a fresh reader). The three defects among
them closed on 2026-09-02.

T-260902-02 to -06 were the Revenue slice of Phase 3 (P3-04/05/06/10/11),
scoped on 2026-09-02 after the user found the Revenue page empty, and built
the same day — -03 to -06 in one session after it was found empty a second
time. **The one thing left open is T-260901-31**, a design decision rather
than a defect: the company header's `Edit / LOGO Upload… / BANNER Upload…`
cluster fits at 700px (no overflow in `shots/metrics.json`) but is dense,
and whether it stays a row of buttons, collapses to one control, or moves
into the Edit sheet is product direction, not a fix. It was deliberately
left for the user rather than decided inside a scan-and-fix pass.

Follow-ups named in the revenue tasks' Outcomes but not scoped: the
milestone editor (P3-09), the batched `security-review` over the
`milestones:*`, `*:deleteImpact` and `revenue:summary` surface, and three
promotions (a shared identity mark, a `layout.css`, one billing-model label
map).

| | ID | Title | Cat | Plan |
|---|---|---|---|---|
| ○ open | [T-260901-31](T-260901-31-header-image-controls-narrow.md) | Decide where the logo and banner controls live when the header is narrow | 🎨 ui | |

## Closed this month

| | ID | Title | Cat | Plan | Run |
|---|---|---|---|---|---|
| ● done | [T-260902-06](T-260902-06-stacked-monthly-chart.md) | The stacked monthly revenue chart, on Revenue and Today, from revenue_lines | 🎨 ui | P3-11 | — |
| ● done | [T-260902-05](T-260902-05-revenue-view.md) | Build the Revenue view — rollup toggle, four metrics, the by-month table | 🎨 ui | P3-10 | — |
| ● done | [T-260902-04](T-260902-04-revenue-rollups-ipc.md) | Revenue rollup queries and their IPC channel — three attributions, four metrics, one SUM | 🗄 data | P3-06 | — |
| ● done | [T-260902-03](T-260902-03-revenue-line-generator.md) | Build the revenue line generator — the one place that turns an engagement's terms into revenue_lines rows | 🗄 data | P3-05 | — |
| ● done | [T-260902-11](T-260902-11-sheet-drag-close.md) | A press that starts inside a sheet and ends on the scrim must not close it | 🎨 ui | | — |
| ● done | [T-260902-10](T-260902-10-engagement-terms.md) | An engagement card states what it is worth, instead of hours nobody can book | 🎨 ui | | — |
| ● done | [T-260902-09](T-260902-09-deletes.md) | Delete a company, person, engagement or offering, after being shown what goes with it | 🗄 data | | — |
| ● done | [T-260902-08](T-260902-08-retainer-basis.md) | A retainer says what it is worth per month — a flat amount, or hours at a rate | 🗄 data | | — |
| ● done | [T-260902-07](T-260902-07-preload-carries-the-schema-layer.md) | Stop the sandboxed preload bundling zod and every entity schema to read a list of channel names | 📦 build | | — |
| ● done | [T-260901-30](T-260901-30-shared-detail-header-styles.md) | Give the detail-page header one stylesheet instead of two copies that must be edited in step | 🎨 ui | | — |
| ● done | [T-260901-27](T-260901-27-one-cadence-computation.md) | Compute a company's cadence state in one place, so the grid, the detail page and Today agree | 🎨 ui | | — |
| ● done | [T-260901-28](T-260901-28-optimistic-settings-rollback.md) | Roll back the optimistic settings writes that have no onError | 🎨 ui | | — |
| ● done | [T-260901-26](T-260901-26-activity-filter-local-day.md) | Make the Activity view's date-range filter use the same calendar day the rows display | 🎨 ui | | — |
| ● done | [T-260902-02](T-260902-02-milestones-repository.md) | Build the milestones repository — the fixed-scope half of revenue has nowhere to come from without it | 🗄 data | P3-04 | — |
| ● done | [T-260902-01](T-260902-01-revenue-page-says-what-it-is.md) | Give the Revenue route a real header and an honest empty body instead of a bare heading | 🎨 ui | | — |
| ● done | [T-260901-29](T-260901-29-detail-header-band-contains-content.md) | Make the detail-page header band contain its content instead of a fixed strip the content straddles | 🎨 ui | | — |
| ● done | [T-260901-25](T-260901-25-inline-editor-escape-saves.md) | Escape in the person-detail fields and the category rename must not save through the unmount blur | 🎨 ui | | — |
| ● done | [T-260901-24](T-260901-24-local-today-defaults.md) | Default "today" to the local calendar day in the four forms that used the UTC one | 🎨 ui | | — |
| ● done | [T-260901-23](T-260901-23-company-quick-log-stale-cadence.md) | Logging a touch from the company page moves the company's cadence meter, not only its activity list | 🎨 ui | | — |
| ● done | [T-260901-22](T-260901-22-shared-drives-and-pragma-leak.md) | Refuse Google "Shared drives" as a database location, and close the connection a throwing pragma leaves open | 🗄 data | | — |
| ● done | [T-260901-21](T-260901-21-favicon-body-deadline.md) | Bound the favicon body read by the same deadline as the headers, and close the trailing-dot host bypass | 🔗 integration | | — |
| ● done | [T-260901-20](T-260901-20-status-prose-drift.md) | Bring the status prose in AGENTS.md, README and HOWTO back in line with what is built | 📄 docs | | — |
| ● done | [T-260901-19](T-260901-19-node-version-check-and-hook-gaps.md) | Turn the Node-version lesson into a check, and close the Stop hook's and tsconfig's coverage gaps | 📦 build | | — |
| ● done | [T-260901-16](T-260901-16-popover-layer-retarget.md) | Retarget the popover layer when a second InfoPopover opens over the first | 🎨 ui | | — |
| ● done | [T-260901-18](T-260901-18-seeded-affiliation-started-null.md) | Person detail fails for every seeded person with a company — affiliation `started` is NULL but the wire schema requires a date | 🗄 data | | — |
| ● done | [T-260901-17](T-260901-17-factory-slimming.md) | Slim the software factory — interview-first scopes, sequential builds, a Stop-hook gate, screenshots for UI, capped lessons | 📄 docs | | — |
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
| ● done | [T-260901-14](T-260901-14-company-header-images-edit.md) | Give company detail its logo, its banner and a visible way in to editing | 🎨 ui | | R-260901-01 |
| ● done | [T-260901-15](T-260901-15-company-card-banner.md) | Carry a company's banner onto its card, behind a gradient | 🎨 ui | | R-260901-01 |

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

## The 2026-09-02 scan

A full pass over the app — every route screenshotted at three widths, the
main process and the build read, the whole suite run — on the user's ask to
"fix anything off, broken, missing or could be improved" and cut a release.

The four defects it closed (T-260901-26, -27, -28 and the -30 refactor) were
already scoped from the 2026-09-01 review; the scan's own contribution was
T-260902-07, which nothing had reported and no check measured, and the two
discoveries recorded inside T-260901-30's outcome: `.cmark` declared in four
unscoped stylesheets at once, and the identity helpers duplicated across five
views. Each of the five now leaves a check behind.

**Deliberately not built**, and named here so they are not mistaken for
oversights:

- **Milestones have a repository and an IPC namespace (T-260902-02) but no
  UI.** Every fixed-scope engagement reads "0 of 0 milestones" for good, and
  T-260902-03's generator has nothing to read. That is a task, not a fix.
- **Offerings are not searchable.** `SEARCH_KINDS` indexes five source
  tables and offerings is not one of them (`nav.ts` records the absence).
  ADR-008's codes are append-only, so adding one is legal — but it is a
  migration plus triggers plus a palette result kind, which is a task.
- **T-260901-31**, above.

## The 2026-09-02 report

Four issues reported against the 0.6.2 build, all four closed the same day:
the edit form vanishing (T-260902-11), no way to delete anything
(T-260902-09), an engagement card claiming hours nobody can book
(T-260902-10), and a retainer that could record an allowance but not a price
(T-260902-08).

Two of them turned out to be bigger than reported. The vanishing form was
`Sheet` itself, not the engagement sheet — every form in the app lost unsaved
edits to a text-selection drag. And "we can't delete" was not a missing
button: three delete channels had existed since August with nothing calling
them, and they refused against blockers the app gave no way to clear. That
one needed a decision, ADR-017.

**The forecast is deliberately not finished here.** T-260902-10 puts each
engagement's own price on its card, which ADR-003 explicitly permits. An
annualised figure or a total across engagements is an aggregation, which
belongs to `revenue_lines` and the generator that writes it — T-260902-03,
still open below, followed by -04 to -06. Building it there is also what
fills the Revenue page, which is the same feature seen from the other end.
