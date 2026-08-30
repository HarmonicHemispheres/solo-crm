---
id: T-260829-14
title: Build the Today view — what is owed, what is going quiet, what just happened
status: done
category: ui
plan_ref: P2-04
created: 2026-08-29
closed: 2026-08-30
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

---

## Outcome

**Changed:**

- `electron/renderer/views/Today.tsx`, `Today.css`, `Today.test.tsx` (new) —
  the header (clock glyph on `--verdigris`, the mockup's own info-popover
  text, a "Log a touch" ghost button), four stats, and the Going quiet / Next
  up / Recent cards, plus the three-step first-run card.
- `electron/renderer/views/todo-urgency.ts` (new) — see the deviation below.
- `routes.tsx` — the index route renders `<Today />`.
- `Todos.tsx` — imports the moved helpers, exports `TodoRow`.
- `Activity.tsx` — exports `ActivityItem`.
- `query-keys.ts` — **unchanged.** The scope predicted a new key; the
  existing per-entity keys composed, and the settings query shares
  `queryKeys.settings.list()` with `Shell.tsx`/`Rail.tsx`, so Today adds no
  second `settings:getAll`.

**Deviation from Touches, accepted:** the scope said to export Todos'
comparator and date helpers *from* `Todos.tsx`. `react-refresh/only-export-components`
is error-level in `eslint.config.js` and forbids a file exporting both
components and non-components, so they moved verbatim to a sibling
`todo-urgency.ts` — the same shape `workspace-data-facts.ts` and `nav.ts`
already have, and the same rule that produced `layer-manager-context.ts` and
`tour-steps.ts` in T-260829-15. Bodies and comments unchanged; `Todos.test.tsx`
passes untouched. `TodoRow`/`ActivityItem` are component-only exports, so lint
is unaffected and importing them carries `Todos.css`/`Activity.css` with the
markup rather than depending on load order.

**The scope's own Going-quiet example was wrong, and the builder caught it.**
It asked for a test pairing a `channel` (cadence 30) 20 days quiet against a
`client` (cadence 7) 9 days quiet. 20/30 is 0.67 — band `warn` — so the
channel never enters the list at all, and the pair would have exercised the
filter while appearing to test the sort. The shipped test uses channel 35d/30
(1.17) against client 9d/7 (1.29), so the client sorts first on a quarter of
the day count, and keeps a 20d channel in the fixture asserted *absent*. That
is the per-relationship point stated more directly than the scope managed.

**Latency:** median render at 10× seed volume is **58ms of the 100ms budget**
(§8). The fixture cycles the mockup's own ten `[cadence, days-quiet]` pairs so
100 companies reproduce the seed's ~40% late proportion, asserted `toBe(40)`
so the measurement cannot go vacuous. A first attempt gave every company
cadence 7, produced 93 late rows and measured 121ms — a workspace shape the
seed does not have, not a regression.

**Review:** read against the acceptance criteria; no blocking findings. Seven
mutants across the builder's run and the orchestrator's:

| Mutant | Result |
|---|---|
| `byPctDescending` reversed | 2 tests red |
| the `late` filter dropped | 3 tests red |
| empty-state condition inverted | 14 of 15 red |
| hero count from `openTasks.length` instead of `tasks:countOpen` | 1 test red |
| `companies.length - quiet.length` → `companies.length` | **survived — fixed at merge** |
| `status === 'active'` → `status !== 'lost'` | **survived — fixed at merge** |
| name tiebreak dropped from `byPctDescending` | **survived — fixed at merge** |

The three survivors were this task's acceptance being too weak, not the
builder skipping it: the criteria asked that four stats *render*, and they
did. But two of the four stat values and the sort's tiebreak were consequently
unasserted — Cadence health could have read the total company count and
Active engagements could have counted everything but `lost`, both visibly
wrong numbers on the first screen of the app, with a green suite. Rather than
open a follow-up for three small tests, the orchestrator added them at merge:
`Cadence health counts the companies that are current`, `Active engagements
counts the active ones only`, and `breaks a tie in Going quiet by name`. Each
was confirmed to turn red under its own mutant and green with the code
restored. `typecheck` and `lint` clean afterwards.

**Deferred:** the scope's "Out" list stands in full — no money stats, no
twelve-month chart, no linked-systems strip, no inline next-step editing
(P2-05), no cadence rings on the Companies grid. Five per-view copies of
`.cmark`/`initials` and three of `KIND_LABEL` now exist; the builder followed
the codebase's established per-view pattern (`Companies.tsx`'s header states
that rationale) rather than extracting a shared module outside Touches, and
named the extraction as a worthwhile follow-up in `Today.tsx`'s own comment.
Not written up as a task: it is a tidy-up with no behavioural consequence,
and the note sits where the next person to touch these files will read it.
