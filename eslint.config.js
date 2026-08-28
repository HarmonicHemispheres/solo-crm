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
  }
  // No separate override for electron/{main,preload}/**/*.test.ts: the
  // main/preload block above already matches `**/*.ts` under those
  // directories, test files included, so a second block repeating the same
  // globals.node assignment was dead config (T-260828-03 review). The
  // boundary this used to describe — a renderer test file must keep browser
  // globals only, not gain Node globals on top — is still real; it's simply
  // already true by construction, since the renderer block only matches
  // electron/renderer/**/*.{ts,tsx} and this one never touches it.
)
