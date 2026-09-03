# Changelog

What Solo CRM can do, release by release. Written for the person using it —
scopes, reviews and the record of how it got built live in [.dev/](.dev/).

✨ feature · ⚡ improvement · 🐛 fix · 🔒 security · ♻️ refactor · 📝 docs · 🗑 removed

## Unreleased

- ⚡ **Engagements, grouped by client** — one card per company you invoice,
  with its logo on it, and Status and Model groupings a click away. Filter
  by status and by billing model; each chip says how many engagements
  choosing it leaves, and a combination that would show nothing is never
  offered.
- ⚡ **An engagement is a row, not a paragraph** — a status dot, the name and
  its pills, one line of facts each behind its own icon, and the price in a
  column of its own on the right where prices can be compared. Cards pack
  against each other instead of leaving a hole beside a tall neighbour.

## 0.6.8

- ✨ **Mark a line invoiced or paid** — the Revenue page lists the lines
  behind its chart, and each one moves between projected, invoiced and paid.
  Until now every month was drawn as a forecast, because nothing but a
  Stripe connection could say otherwise; a marked line also stops being
  regenerated, so it survives the next edit to the engagement.
- ✨ **Report on any period** — Revenue and Today share one control:
  monthly, annual or a custom range, with arrows to step to the window
  before or after. Annual draws one bar per year.
- ✨ **Total revenue** — the money recognised in whatever period you have
  selected, on both Today and Revenue.
- ✨ **A company's end clients are on its page** — every company you bill on
  behalf of, not just the ones that already have an engagement, so a
  sub-client you have just created is where you would look for it.
- ⚡ **Monthly Revenue is full width** — the chart was sharing a row with the
  rollup table, at roughly 35 pixels of column per month.
- ⚡ **The company page, tidied** — todos and touches are one feed, newest
  first, with one box that writes either. Since, cadence, last touch and who
  invoices moved up into the header. Notes have their own card, unset fields
  no longer take a row each to say nothing, and the image and delete
  controls moved behind a "…" so the header holds Log touch and Edit.
- 🐛 **A brand-new company is no longer overdue** — every company started
  with a full red cadence bar labelled "never", because nothing had been
  logged against it yet. The wait is measured from when you added it, so a
  company added today reads on track and one untouched for a year still
  reads late; hovering the bar says which.

## 0.6.7

- ✨ **The engagement timeline** — every engagement as a bar across the
  months under **Reports → Timeline**, grouped by who pays. A rolling
  engagement fades at the right edge instead of ending on a date nobody
  entered, work you have not signed is drawn dashed, and a fixed scope's
  milestones sit at the month each is expected — filled once completed.
  Filter to active only, and switch between this year, the next twelve
  months, and everything. Click a bar to open the engagement.
- 🐛 **End clients are in the company list again** — a company you bill
  through a partner used to disappear from Companies the moment you created
  it, findable only by search or by opening the partner. Every company is
  listed now, an end client marked with the partner it bills through, with a
  **Direct only** switch for the partners on their own.

## 0.6.6

- ⚡ **Revenue moved into a Reports group** — the sidebar's Revenue item is
  now a **Reports** heading you expand, with Revenue inside it and room for
  the reports still to come; it stays how you leave it between launches.

*1 task closed, 0 follow-up fixes, 95 min median.*

## 0.6.5

- 🐛 **Fixed-scope engagements show up on Revenue** — a fixed scope with no
  milestones entered yet recognises its contract value evenly across its
  term; the first milestone you add replaces that spread with your plan.
- ⚡ **The chart has a scale** — amount gridlines down the left, and each
  bar names its month's total on hover.
- ⚡ **Revenue lines are refreshed on launch** — so an upgrade or a new
  month is reflected without re-saving every engagement.

## 0.6.4

- ✨ **The Revenue page** — recurring revenue this month with the next twelve
  months beneath it, fixed backlog, T&M run rate, and how concentrated you
  are on your largest payer; a twelve-month chart stacked by how the money
  is earned, paid months solid and projected months dashed; and a rollup
  table you can flip between billing party, end client and billing model —
  same money, different attribution, totals never move.
- ✨ **Revenue is recognised from each engagement's terms the moment you save
  it** — retainers month by month (rolling ones twelve months out), fixed
  scopes at each milestone's month, T&M from the estimate at the agreed
  rate, capped at not-to-exceed. Only signed work counts: a proposal is
  never mistaken for recurring revenue.
- ⚡ **Today leads with money again** — recurring / month and fixed backlog
  are back in the hero row, with the chart beside Going quiet, the way the
  design always drew it.
- ⚡ **Year to date follows your fiscal year** — the fiscal-year-start
  setting now drives every YTD figure.
- ⚡ **Deleting an engagement no longer trips over its own forecast** — the
  projected lines an engagement generated go with it; only invoiced, paid
  or entered-by-hand lines still block a delete.

## 0.6.3

- 🐛 **Forms stop vanishing while you edit them** — selecting the text in a
  field and letting go outside the panel closed it and threw away everything
  typed. It affected every form in the app and was worst when editing, which
  is when you drag across a value to replace it.
- ✨ **Delete a company, person, engagement or offering** — none of them could
  be removed before. The confirmation lists exactly what goes with the record
  and, separately, what is kept and merely unlinked: another company that
  billed through this one stays a company, and an engagement sold from a
  deleted offering keeps the rate it was signed at.
- ✨ **Retainers have a price** — either a flat amount per month, or an
  allowance of hours at an hourly rate, which the form totals for you as you
  type. Until now a retainer could record its hours and nothing else.
- ⚡ **Engagement cards say what the work is worth** — the retainer's monthly
  figure, the fixed scope's contract value, the T&M estimate at its agreed
  rate capped by its not-to-exceed. They previously read "0 of 10 hrs this
  month" against a figure that was always zero, because nothing in this app
  books hours and nothing is going to.

## 0.6.2

- 🐛 **A company is the same number of days late everywhere** — the companies
  grid rounded where Today and the company's own page floored, so the same
  company read "50d" on one screen and "49d" on the other; and a company with
  no cadence of its own now inherits its kind's default in all three places
  instead of showing a full red bar on two of them and "current" on the
  third. Its ring can no longer be green while its bar is red.
- 🐛 **Filtering Activity to a day shows the rows that say that day** — an
  evening touch was filed under tomorrow, so From and To set to today
  excluded it. The filter now reads the same calendar the rows print.
- 🐛 **A setting that could not be saved goes back** — toggles on Todos,
  People, Workspace Settings and the tour flag kept showing a preference the
  app had refused to store, until the next restart. They snap back now.
- ⚡ **The window opens faster** — the app was building its entire data-
  validation layer inside the window's security bridge before every launch,
  to read a list of channel names. That bridge went from 205 KB to 3 KB.
- ♻️ **One definition of the things drawn in several places** — the identity
  mark's styling was written into four stylesheets at once and its colour and
  initials into five view files, so a change had to be made five times and
  only one copy of the CSS was ever taking effect. Each now has one home,
  with a check that keeps it there. No visual change: every page renders
  pixel for pixel as before.

## 0.6.1

- 🐛 **Person pages open on a seeded workspace** — every seeded person with a
  company failed to load; their affiliation now carries the start date the
  page expects.
- 🐛 **Logging a touch on a company page resets its cadence meter** — the
  meter, the grid and Today no longer keep the old "late" state until
  something else refreshes.
- 🐛 **Escape means never mind** — cancelling an edit on a person's page or a
  category rename no longer saves the discarded text; Enter saves once, not
  twice.
- 🐛 **"Today" is your day** — new people, engagements and moves default to
  the local calendar day instead of tomorrow's UTC date after 5 pm.
- 🐛 **Info popovers return focus to the right button** — opening a second
  one over the first, then pressing Escape, lands on the one you pressed;
  a popover you closed no longer reappears when another opens.
- 🔒 **A stalling website cannot wedge favicon lookups** — the fetch deadline
  now covers the body, so one bad host no longer stays "fetching" until
  restart; `localhost.` is refused like `localhost`.
- 🔒 **Google "Shared drives" is refused as a data location** — the same
  dialog as My Drive, Dropbox and OneDrive, before the database is created.
- 📝 **The status in AGENTS.md and README matches what is built** — offerings
  and selling from them are in; integrations are Phase 4.

## 0.6.0

- ✨ **Offerings** — a price list of what you sell, each with a rate and a
  billing model, versioned so a price change is a new entry rather than a
  rewrite of the old one; grouped by category, quick-added from one line.
- ✨ **Sell an engagement from an offering** — pick one when creating an
  engagement and its rate is copied in once; later price changes never
  touch a signed deal, and the engagement says what it was sold as.
- ✨ **Company logo and banner** — upload both from the company page; the
  banner washes the company's card in the grid and the logo replaces its
  initials, and neither leaves the machine.
- ✨ **Edit a company or engagement from its page** — an Edit button on the
  header opens the same form that created it, filled in; the Details card
  now only shows values instead of also editing them.
- ⚡ **Workspace Settings is a section rail** — one section's card at a time
  instead of a grid that reflowed with the window.
- ⚡ **Detail-page headings read as a banner** — the company and person
  headers no longer look empty above the fold.
- 🐛 **Data view buttons have a colour again** — the two that rendered
  unstyled now carry a variant, and a third such button is a type error.

## 0.5.0

- ✨ **A portable build** — `Solo CRM-Portable-<version>.exe` now ships beside
  the installer: one file to copy onto a USB stick, keeping its database in the
  folder the file sits in, so the workspace travels with it. It installs
  nothing and leaves nothing behind on the machine that runs it — an installed
  copy and a portable copy on one machine are two separate workspaces, and
  nothing merges them. It asks nothing on first launch, because where its data
  goes is not a choice: it goes beside the `.exe`. Moving the workspace means
  moving that file. The cost of the single-file shape is a slower start — the
  whole app unpacks itself on every launch, and more slowly still off an
  older USB stick.
- 🔒 **A portable copy refuses to start rather than lose your work** — if it
  cannot tell where it was launched from, or the only place it could put the
  database is a temporary folder Windows empties, it says so and stops. The
  alternative was an app that opens, saves all day and is empty tomorrow.
  Dropping the portable `.exe` into a OneDrive, Dropbox or iCloud folder is
  refused for the same reason it always has been: a sync daemon and a live
  SQLite file corrupt each other.

## 0.4.0

- ✨ **Today is a real screen** — the page the app opens on has been a heading
  and nothing else since the beginning. It now leads with what is owed: open
  todos, how many companies are current against their own cadence, active
  engagements, and the size of the book; then the companies going quiet, the
  five most urgent todos with a tick box and a quick-add, and what was logged
  most recently. Going quiet is ordered by how far past each company's *own*
  cadence it is, not by raw days — a client you check on weekly and a referral
  channel you check on monthly are both nine days quiet and only one of them
  is a problem. A company nobody has ever touched sorts to the top rather than
  disappearing.
- ✨ **A first-run walkthrough, skipped once and gone for good** — five cards
  on a fresh workspace explaining where to start and why contacts, companies
  and engagements are kept apart. Skip is as final as finishing it. It only
  appears on a workspace with no companies in it, so updating into this
  version never shows it, and *Take the tour* in Workspace Settings brings it
  back whenever you want it.
- ✨ **An empty workspace says what to do** — with no companies yet, Today
  shows three ordered steps that open the right form, instead of four zeroes
  and three empty cards.
- 🐛 **Every cadence bar was invisible** — the little bar next to a company
  showing how overdue a check-in is has been rendering at zero width
  everywhere it appears: the Companies grid, company detail, People, and now
  Today. It had the right colour and the right animation and painted nothing,
  because of one missing line of CSS carried over from the original design
  file. Four views' worth of "at a glance" was blank.
- 🐛 **Dates and names ran together in the activity timeline** — "9:32 AMRinvii"
  rather than "9:32 AM · Rinvii", on the Activity view and in Today's Recent
  card. Three stylesheets were fighting over the same names and the wrong one
  was winning.
- 🐛 **Loading the sample data broke the app** — `npm run seed` wrote one
  column in a format the app refuses, so Today and Todos showed an error
  instead of any content. Only affects development, but it made a freshly
  seeded workspace look broken.
- ⚡ **Revenue figures are absent rather than invented** — Today does not show
  a monthly-recurring or backlog figure yet. The numbers behind them are not
  being tracked until a later release, and a made-up number on the first
  screen is worse than no number. What is shown instead is counted from what
  is actually in the database.

## 0.3.1

- ♻️ **Nothing you can see** — the number moved because the 0.3.0 installer was
  cut before the last of that release's work merged, and two different programs
  must not share one installer name. What changed since: a create-sheet title
  nothing displayed was deleted along with the argument that fed it, and the
  test that stops the database schema drifting from its migrations was rewritten
  to rename identifiers structurally rather than by text substitution. If you
  are on 0.3.0, updating gains you nothing and costs nothing.

## 0.3.0

- ✨ **Your own icon and logo in the sidebar** — Workspace Settings has a
  Branding card. Point it at two images on your disk and the top-left of the app
  becomes yours; the sidebar changes without a reload and keeps them across
  restarts. The two are independent, either can be removed back to the built-in
  default on its own, and PNG, JPEG, WEBP, GIF, BMP and ICO are accepted up to
  512 KB each. SVG is not — the format is refused by what the file actually
  contains rather than by its name, so renaming one to `.png` will not sneak it
  through.
- 🐛 **The create buttons on Companies, People and Engagements work** — they
  opened a sheet with the right title, no fields and a dead Create button. All
  six now open the real form, including the ones on the empty-state screens that
  are the only way in on a fresh install. The New menu and ⌘K were always fine.
- ⚡ **The sidebar wears Solo CRM's own mark** — it carried another company's,
  which was the wrong thing to show as the default you replace with your own.
  The version underneath it is now read from the running app rather than being a
  number typed in by hand, which had already drifted.
- ⚡ **Catalogue is now Offerings** — in the sidebar, the breadcrumb and
  everywhere else it is named. The section itself is still to be built.

## 0.2.0

- ✨ **The installer asks before replacing an existing copy** — running the
  installer when Solo CRM is already installed now opens on a maintenance page
  offering to repair, update or remove it, rather than quietly installing over
  the top. Removing uninstalls the app and leaves your database where it is.
- ⚡ **Every build is a distinct release** — the version is bumped by hand
  before packaging, so two installers are never the same file name and Apps and
  features shows which one you have. `npm run dist` refuses to overwrite an
  installer that was built from a different commit.
- 📝 **Cutting a release is written down** — the README has the procedure,
  including the checks to run first.
- 📝 **Development process** — scoping, orchestration and review run through
  skills in `.claude/`, with the record kept in `.dev/`.
