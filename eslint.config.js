import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  {
    // .claude/, .dev/ and planning/ hold agent tooling and docs, not
    // application source — out of this task's scope.
    ignores: ['out/**', 'dist/**', 'node_modules/**', '.claude/**', '.dev/**', 'planning/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Main + preload: Node globals, no browser globals.
  {
    files: ['electron/main/**/*.ts', 'electron/preload/**/*.ts', 'electron.vite.config.ts'],
    languageOptions: {
      globals: globals.node
    }
  },
  // Renderer: browser globals, React rules, no Node globals.
  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh.configs.vite().plugins['react-refresh']
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite().rules
    }
  },
  {
    // Scoped to main/preload only — a renderer test file (electron/renderer
    // /**/*.test.tsx) must keep browser globals only, not gain Node globals
    // on top, or process/require/__dirname would lint clean across the same
    // boundary tsconfig.web.json exists to enforce at typecheck time.
    files: ['electron/main/**/*.test.ts', 'electron/preload/**/*.test.ts'],
    languageOptions: {
      globals: globals.node
    }
  }
)
