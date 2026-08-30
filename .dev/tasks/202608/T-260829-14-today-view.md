---
id: T-260829-14
title: Build the Today view — what is owed, what is going quiet, what just happened
status: in-progress
category: ui
plan_ref: P2-04
created: 2026-08-29
closed:
---

<!-- Words only in frontmatter — it is grepped. Icons go in prose and tables. -->
<!-- Vocabulary and the review gate each category triggers: .dev/README.md -->

## Why

`/` is the route the app opens on, and it renders `<ViewPlaceholder title="Today"
/>` — one `<h1>`, nothing else (`electron/renderer/routes.tsx:32`). Every other
Phase 1 view is real; the first screen anybody sees is a stub. A person who
installs Solo CRM, creates a company and restarts lands on a blank page and has
no reason to believe the app kept anything.

§6.1 makes this the view the whole product is pointed at: "Today view leads with
what is owed, not with what is stored" is the requirements' own stated defence
against the app "becoming a filing cabinet rather than a prompt" (§ risk table).
Everything it needs already exists — `companies:list`, `tasks:list`,
`tasks:countOpen`, `activity:list` and `engagements:list` are all live channels,
and `Stat`, `Card`, `Row`, `Ring`, `DecayMeter`, `QuickAdd` and `EmptyState` are
all shipped primitives with, in several cases, no consumer yet.

**Depends on T-260829-13** for the decay arithmetic. Do not inline that
computation here.

## Scope

**In:** replace the placeholder at `/` with a real view — a new
`electron/renderer/views/Today.tsx`, `Today.css` and `Today.test.tsx`, wired into
`routes.tsx`. No new IPC channel, no repository change, no migration. Every
number on the page comes from a channel that exists today.

**The header.** `ViewHeader` with the clock icon and `--verdigris` accent
(`VMETA.today` in the mockup, `['#5BA4A4', <clock path>]` — take the token, not
the hex), the title *Today*, the mockup's own info-popover text as
`description`, and a "Log a touch" ghost button in `actions` that opens the
existing quick-log layer.

**Four hero stats,** in a `.grid.stats` row. Two of the four are **not** §6.1's —
see the deviation note below, which is the main thing to approve or reject in
this scope:

| Stat | Value | Source |
|---|---|---|
| Open todos (**hero**, gold) | count | `tasks:countOpen`, with `n overdue · n waiting` as `meta` |
| Cadence health | companies not late | derived via `decayForCompany`, `of N current` as `meta`, plus a `Ring` |
| Active engagements | count | `engagements:list`, filtered to the active statuses |
| Companies | count | `companies:list` |

Exactly one `hero` tone on the page (`ui-design.md`: "gold marks exactly one
hero value per view"). No sparklines — the mockup's are hardcoded arrays.

**Going quiet.** A `Card` listing every company whose `band` is `late`, as
`Row`s, sorted by `pct` descending — *by ratio, not by raw days*, which is the
entire point of per-company cadence and P2-04's first acceptance criterion. A
never-touched company has `pct: Infinity` and therefore sorts to the top rather
than dropping out (ADR-001 rule 5). Each row: the company mark, its name, its
`is_next_step` todo title as the subtitle where one exists — otherwise "every
Nd" — the kind tag, and a `DecayMeter`. Clicking a row navigates to
`/company/:id`. With nothing late, an `EmptyState` reading "Everyone is
current." — P2-04: "With nothing overdue it says so rather than rendering an
empty card."

**Next up.** A `Card` of the five most urgent open todos, most overdue first,
each with inline completion, plus a `QuickAdd` beneath and an `IconButton` in
the header linking to `/todos`. Reuse `Todos.tsx`'s urgency ordering and its
`localToday()` date arithmetic — import it, do not restate it. `EmptyState`
"Nothing due." when the list is empty.

**Recent.** A `Card` with the five newest `activity:list` rows as a timeline,
matching `Activity.tsx`'s existing item rendering, and a plus `IconButton` that
opens quick-log.

**The fresh-workspace state.** When `companies:list` returns empty, the four
stats and the three cards are replaced by a single card that says what to do
first and does it: three ordered steps — *Add a company*, *Add a person*, *Open
an engagement* — each a working button that opens that create sheet through the
existing `NewMenu`/layer path. This is the state on every fresh install, and it
is the direct answer to "nothing on it by default". It must work with
T-260829-15 not built; the tour is an overlay on top, not the mechanism.

**Out:**

- **The twelve-month revenue chart and the two money stats** (recurring/month,
  fixed backlog). See the deviation note.
- **The linked-systems strip.** Notion/Drive/Stripe/Calendar with last-sync
  times needs adapters that do not exist until Phase 4. A strip of four rows
  that always read "never" is worse than no strip.
- Next-step *editing* — surfacing an existing `is_next_step` todo as a row
  subtitle is in; "a company with none prompts to name one, inline" is P2-05.
- Cadence rings on the Companies grid, and decay anywhere outside this view.
- Any change to `nav.ts`, `Rail.tsx` or the breadcrumb — `/` already resolves
  to `today` with the breadcrumb "Today" and needs nothing.

### The deviation from §6.1, stated so nobody quietly "fixes" it back

§6.1's hero row is "recurring monthly revenue, fixed backlog, open todos,
cadence health", and the mockup computes the first two live off engagement
columns (`engagements.reduce((n,e) => n + mrr(e), 0)`). AGENTS.md's gotcha list
forbids porting exactly that: *"Revenue reads from `revenue_lines`. The mockup
fakes it with hardcoded arrays and per-model branching computed live off
engagement columns. Porting that would undo the decision that every revenue
question is one `SUM … GROUP BY` (task plan G5, the highest-risk carry-over in
the project)."*

P2-04's own acceptance grants an allowance — provisional figures, visibly
marked, computed in one module, on ADR-003's terms. This task **declines that
allowance** and defers both money stats to Phase 3's revenue module (P3-05),
substituting two counts that are true today. The reasoning: `revenue_lines` is
empty, so the allowance buys a number that is not merely provisional but
*absent*, and paying for it means writing the per-model branching AGENTS.md
names as the highest-risk carry-over in the project — then deleting it. Two
honest counts cost nothing and are not a decision to unwind.

If the user prefers §6.1's row as specified, that is a different task and it
should say ADR-003 in its title. Do not split the difference by adding the money
stats "just for now".

## Touches

- `electron/renderer/views/Today.tsx`, `Today.css`, `Today.test.tsx` — new.
- `electron/renderer/routes.tsx` — the `index` route stops being a placeholder.
- `electron/renderer/lib/query-keys.ts` — likely a key for the view's fan-out,
  if the existing per-entity keys do not compose.
- `electron/renderer/views/Todos.tsx` — export the urgency comparator and the
  date helpers this view reuses, if they are currently module-private. Export
  only; no behaviour change to Todos.
- `electron/renderer/routes.test.tsx` — the route table assertion may name the
  placeholder.

## Acceptance

- [ ] `/` renders the header, four stats and three cards against a stubbed
      `window.crm`; `ViewPlaceholder` no longer appears anywhere in the Today
      path, and `routes.test.tsx` still passes.
- [ ] **Going quiet sorts by ratio, not days.** A test with a `channel` company
      (cadence 30) 20 days quiet and a `client` company (cadence 7) 9 days quiet
      puts the client first, even though it has the smaller day count.
- [ ] A company with `lastTouchAt: null` renders at the top of Going quiet, with
      a determinate meter and no `NaN` in the DOM.
- [ ] With `companies:list` empty, the view renders the three-step first-run
      card and **not** four zero stats; clicking *Add a company* opens the
      company create sheet. Asserted by role/name, not by class.
- [ ] With companies present but none late, Going quiet renders "Everyone is
      current." and no rows.
- [ ] Completing a todo in Next up removes it from the card and decrements the
      Open todos stat — the same invalidation contract `Todos.tsx` already uses,
      not a local optimistic edit that drifts from the count.
- [ ] Every Going quiet row navigates to `/company/:id` for that company —
      "every row links to the action, not to a number" (P2-04).
- [ ] A latency test in the shape of `CommandPalette.latency.test.tsx` renders
      the view against 10× the seed's volume in under 100ms (§8, P2-04).
- [ ] `npm run typecheck && npm run lint && npm test` all green.
- [ ] Mutation check, recorded in the outcome, on at least: the Going quiet sort
      comparator (reverse it), the `late` filter (drop it), and the empty-state
      condition (invert it). Each must turn `Today.test.tsx` red.

## Risks

- **Rebuilding Todos' logic instead of importing it.** Urgency ordering and the
  overdue/today boundary already exist and are already correct about local time
  (`Todos.tsx`'s `localToday()` header comment explains why). A second copy here
  is the "constant or map re-declared in a second place" defect, and it will
  drift at a timezone boundary where nobody is looking. Import.
- **The count and the list disagreeing.** Open todos comes from
  `tasks:countOpen` — the server's single definition of "open" (T-260828-23) —
  while Next up is a client-side slice of `tasks:list`. If the view derives the
  stat from the list length instead, the number silently means something else.
  Take the stat from the channel.
- **Five queries, five loading states.** Today fans out further than any
  existing view. Decide the loading and error story once, at the view level,
  rather than letting three cards each render their own spinner and shift the
  layout — and make sure a *failed* channel is visible, not rendered as a zero.
- **The empty state hiding a broken app.** "No companies" and "the query
  failed" must not look the same. A failed `companies:list` shows an error, not
  the welcome card.
- Near AGENTS.md's revenue gotcha by construction — the deviation note above is
  this task's answer, and the review gate should check the diff contains no
  `mrr`/`backlog`-shaped computation over `engagements`.
- Near the renderer boundary: no `window.crm` call outside the declared
  channels, nothing from Node. `no-renderer-node-access` will catch the latter.
