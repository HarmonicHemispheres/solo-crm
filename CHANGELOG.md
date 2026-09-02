# Changelog

What Solo CRM can do, release by release. Written for the person using it —
scopes, reviews and the record of how it got built live in [.dev/](.dev/).

✨ feature · ⚡ improvement · 🐛 fix · 🔒 security · ♻️ refactor · 📝 docs · 🗑 removed

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
