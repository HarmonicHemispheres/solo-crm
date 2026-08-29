import { app } from 'electron'
import { runFirstRunDataLocationPrompt } from '../../first-run/data-location-prompt'
import { closeDatabase, getDatabase, openDatabase, resolveDatabasePath } from '../connection'
import { SeedGuardError, seedFixture } from './index'

/**
 * `npm run seed`'s entry point. A second, separate `electron-vite` main
 * build target (`electron.vite.config.ts`'s `main.build.lib.entry.seed`) —
 * not the app's own `electron/main/index.ts` — because seeding must resolve
 * the *real* `app.getPath('userData')` (the same `solocrm.db` `npm run dev`
 * opens), and that only works inside a genuine, booted Electron process:
 * outside one, `require('electron')` resolves to a path string, not the
 * real `app` API (the same gap `connection.test.ts`'s default-path test
 * works around by spawning `electron` for real). Bundling this as its own
 * `out/main/seed.js` — rather than hand-rolling a bundler-free runner — is
 * also what makes `openDatabase()`'s transitive `?raw` SQL import
 * (`migrations/index.ts`) resolve at all: that is a Vite build-time
 * feature, not something plain Node or Electron understands unassisted.
 *
 * `app.setName('solo-crm')` matters and is not decorative: invoked this way
 * — `electron out/main/seed.js`, a loose file rather than a packaged app —
 * Electron does not reliably infer the name from package.json the way the
 * real app's own entry point does when launched through electron-vite's
 * dev/build flow, and falls back to the literal name "Electron". Since
 * `app.getPath('userData')` is derived from `app.getName()`, an unset name
 * means this seeds `%APPDATA%\Electron\solocrm.db` on Windows while
 * `npm run dev` opens `%APPDATA%\solo-crm\solocrm.db` — a silent split that
 * looks like a successful seed while the app the operator actually runs
 * stays empty. Set before `app.whenReady()`, and the resolved path is
 * printed below so this is never a silent assumption either.
 */

const force = process.argv.includes('--force')

app.setName('solo-crm')

app
  .whenReady()
  .then(async () => {
    console.log(`[seed] app name: ${app.getName()}`)
    console.log(`[seed] database path: ${resolveDatabasePath()}`)

    // T-260828-18: explicit opt-out, not an environment-variable default —
    // same discipline as OpenDatabaseOptions above. Seeding a fresh profile
    // must never block on a native dialog; skipping is stated here rather
    // than left implicit by this module simply never being called.
    await runFirstRunDataLocationPrompt({ skip: true })

    openDatabase()
    try {
      seedFixture(getDatabase(), { force })
    } finally {
      // Runs whether seedFixture succeeded or the guard refused it — a
      // refusal still leaves the connection open (openDatabase already
      // ran migrations against it), so skipping this on the refusal path
      // would leave -wal/-shm sidecars behind with no checkpoint, even
      // though nothing was actually written this run.
      closeDatabase()
    }
    console.log('[seed] database seeded.')
    app.exit(0)
  })
  .catch((error: unknown) => {
    if (error instanceof SeedGuardError) {
      console.error(`[seed] ${error.message}`)
    } else {
      console.error('[seed] failed:', error)
    }
    app.exit(1)
  })
