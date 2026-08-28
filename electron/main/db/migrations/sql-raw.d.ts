/**
 * Vite's asset pipeline treats any import ending `?raw` as the file's text
 * content, bundled directly into the JS output — no filesystem read at
 * runtime. `vite/client`'s own ambient types declare this generically for
 * every extension, but tsconfig.node.json (main's tsconfig) does not include
 * `vite/client` — only tsconfig.web.json (the renderer's) does — so this
 * file restates the one pattern `migrations/index.ts` needs.
 */
declare module '*.sql?raw' {
  const content: string
  export default content
}
