import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { reactRefresh } from 'eslint-plugin-react-refresh'
import globals from 'globals'
import css from '@eslint/css'
import { noLiteralColourJs, noLiteralColourCss } from './eslint-rules/no-literal-colour.js'
import { noRendererNodeAccess } from './eslint-rules/no-renderer-node-access.js'

const local = {
  rules: {
    'no-literal-colour': noLiteralColourJs,
    'no-literal-colour-css': noLiteralColourCss,
    'no-renderer-node-access': noRendererNodeAccess
  }
}

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
    files: [
      'electron/main/**/*.ts',
      'electron/preload/**/*.ts',
      'electron.vite.config.ts',
      // scripts/brand-assets.mjs (T-260828-16) runs as an Electron main
      // process (Buffer, console — same runtime as electron/main/**), not
      // as browser/renderer code. scripts/**/*.ts (T-260828-45) covers its
      // Vitest test file, same Node runtime.
      'scripts/**/*.mjs',
      'scripts/**/*.ts'
    ],
    languageOptions: {
      globals: globals.node
    }
  },
  // Renderer: browser globals, React rules, no Node globals.
  {
    files: ['electron/renderer/**/*.{ts,tsx}'],
    // tokens.test.ts and base.test.ts read the checked-in CSS files off
    // disk to diff them against tokens.css/base.css (T-260828-11) — Node
    // test tooling that happens to live beside the styles it verifies, not
    // renderer application code. tsconfig.node.json/tsconfig.web.json and
    // vitest.config.ts already carve out this exact pair the same way (they
    // typecheck under tsconfig.node.json and run in vitest's 'node'
    // project, not jsdom); this mirrors it for no-renderer-node-access
    // below rather than letting the two conventions disagree.
    // components/sheets/fields.test.ts is the same species and joins them
    // (T-260828-53): it reads base.css and fields.css off disk to resolve
    // which `outline` rule actually wins on a focused field, which is the
    // only form of that check that would have caught `.inp { outline: none }`
    // suppressing the app's focus ring. It is carved out of
    // tsconfig.web.json and into tsconfig.node.json alongside the two above.
    // views/Companies.css.test.ts (T-260901-15) is the fourth of the same
    // species and joins them: it reads Companies.css and tokens.css off disk
    // to do the WCAG arithmetic on the banner wash's own gradient stops —
    // the only form of that check that can exist, since Vitest runs with
    // `css: false` and an imported stylesheet is an empty module in jsdom.
    ignores: [
      'electron/renderer/styles/tokens.test.ts',
      'electron/renderer/styles/base.test.ts',
      'electron/renderer/components/sheets/fields.test.ts',
      'electron/renderer/components/shell/Rail.test.ts',
      'electron/renderer/views/Companies.css.test.ts'
    ],
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
      'local/no-literal-colour': 'error',
      // T-260828-09: no fs/path/child_process/database symbol reachable
      // from renderer code — see eslint-rules/no-renderer-node-access.js.
      'local/no-renderer-node-access': 'error'
    }
  },
  // electron/shared/** is imported by renderer code (window.d.ts →
  // ipc-types), so the renderer's Node-access boundary applies to it too —
  // without this block a fs/database import smuggled through shared/
  // reaches the renderer with zero lint findings (T-260828-09 review).
  {
    files: ['electron/shared/**/*.ts'],
    plugins: { local },
    rules: {
      'local/no-renderer-node-access': 'error'
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
