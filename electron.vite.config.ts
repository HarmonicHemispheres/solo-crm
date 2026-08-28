import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      // externalizeDepsPlugin() is deprecated in electron-vite 5 in favor of
      // this config option (node_modules/electron-vite/dist/index.d.ts).
      // Stated explicitly even though true is the default, so it reads as a
      // decision rather than an omission.
      externalizeDeps: true,
      lib: {
        // Two entries, one bundle target: `index` is the real app;
        // `seed` (T-260828-13) is `npm run seed`'s entry point
        // (electron/main/db/seed/cli.ts), built alongside it so its own
        // transitive `?raw` SQL import resolves at build time the same way
        // — see that file's header comment for why it needs a genuine
        // Electron process (and therefore a build step) rather than a
        // bundler-free script.
        entry: {
          index: resolve(__dirname, 'electron/main/index.ts'),
          seed: resolve(__dirname, 'electron/main/db/seed/cli.ts')
        }
      },
      rollupOptions: {
        // Not used yet (T-260828-05), but declared now so bundling it never
        // silently "works" until a packaged build proves it doesn't.
        external: ['better-sqlite3']
      }
    }
  },
  preload: {
    build: {
      externalizeDeps: true,
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      },
      rollupOptions: {
        // package.json is "type": "module", so electron-vite would otherwise
        // emit an ESM preload bundle (.mjs). Electron only loads an ESM
        // preload when sandbox:false — under the default sandboxed renderer,
        // and permanently once T-260828-04 turns the sandbox on, it throws
        // "Cannot use import statement outside a module" and
        // contextBridge.exposeInMainWorld never runs. Force CJS output with
        // an unambiguous .cjs extension so the file is treated as CommonJS
        // regardless of package.json's module type.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'electron/renderer'),
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'electron/renderer/index.html')
      }
    },
    plugins: [react()]
  }
})
