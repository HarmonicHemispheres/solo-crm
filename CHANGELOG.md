# Changelog

What Solo CRM can do, release by release. Written for the person using it —
scopes, reviews and the record of how it got built live in [.dev/](.dev/).

✨ feature · ⚡ improvement · 🐛 fix · 🔒 security · ♻️ refactor · 📝 docs · 🗑 removed

## Unreleased

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
