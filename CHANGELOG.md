# Changelog

What Solo CRM can do, release by release. Written for the person using it —
scopes, reviews and the record of how it got built live in [.dev/](.dev/).

✨ feature · ⚡ improvement · 🐛 fix · 🔒 security · ♻️ refactor · 📝 docs · 🗑 removed

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
