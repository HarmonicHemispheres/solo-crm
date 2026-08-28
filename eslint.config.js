import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'
import css from '@eslint/css'
import { noLiteralColourJs, noLiteralColourCss } from './eslint-rules/no-literal-colour.js'

const local = { rules: { 'no-literal-colour': noLiteralColourJs, 'no-literal-colour-css': noLiteralColourCss } }

// The JS/TS-oriented shareable configs below (js.configs.recommended,
// tseslint's recommended set) don't scope themselves to a `files` glob —
// they're meant to apply "to every file ESLint processes", which was true
// back when that meant JS/TS. Once the CSS language block below made
// ESLint process .css too, those configs' JS-only rules (built for a JS
// SourceCode API) started running against the CSS AST and crashing. Every
// non-CSS config here is explicitly scoped to JS_TS_FILES so the CSS block
// is the only thing that touches .css.
const JS_TS_FILES = ['**/*.{js,mjs,cjs,ts,mts,cts,tsx}']

export default tseslint.config(
  {
    // .claude/, .dev/ and planning/ hold agent tooling and docs, not
    // application source — out of this task's scope.
    ignores: ['out/**', 'dist/**', 'node_modules/**', '.claude/**', '.dev/**', 'planning/**']
  },
  { files: JS_TS_FILES, ...js.configs.recommended },
  ...tseslint.configs.recommended.map((config) => ({ files: JS_TS_FILES, ...config })),
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
      'react-refresh': reactRefresh.configs.vite().plugins['react-refresh'],
      local
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      ...reactRefresh.configs.vite().rules,
      // T-260828-11: colour lives in tokens.css, not in a component file —
      // see eslint-rules/no-literal-colour.js.
      'local/no-literal-colour': 'error'
    }
  },
  // Renderer stylesheets: same no-literal-colour rule, on the CSS grammar
  // instead of the JS one. tokens.css is the one file allowed to declare a
  // literal colour — it's the source of truth every other file points at.
  {
    files: ['electron/renderer/**/*.css'],
    ignores: ['electron/renderer/styles/tokens.css'],
    language: 'css/css',
    plugins: { css, local },
    rules: {
      'local/no-literal-colour-css': 'error'
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
