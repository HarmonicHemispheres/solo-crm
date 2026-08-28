import { app } from 'electron'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
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
 * `--force` bypasses `seedFixture`'s non-empty-database guard; it is parsed
 * here (not in `./index.ts`, which stays runnable from a test with plain
 * booleans) because argv is a CLI concern.
 */

const force = process.argv.includes('--force')

app
  .whenReady()
  .then(() => {
    openDatabase()
    seedFixture(getDatabase(), { force })
    closeDatabase()
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
