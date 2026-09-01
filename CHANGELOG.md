# Changelog

What Solo CRM can do, release by release. Written for the person using it —
scopes, reviews and the record of how it got built live in [.dev/](.dev/).

✨ feature · ⚡ improvement · 🐛 fix · 🔒 security · ♻️ refactor · 📝 docs · 🗑 removed

## Unreleased

- ✨ **A portable build** — `Solo CRM-Portable-<version>.exe` now ships beside
  the installer: one file to copy onto a USB stick, keeping its database in the
  folder the file sits in, so the workspace travels with it.

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
