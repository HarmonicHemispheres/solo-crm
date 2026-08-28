/**
 * @fileoverview Local ESLint rule for T-260828-09: AGENTS.md — "the renderer
 * never touches SQLite or the filesystem" — enforced by a lint rule, not by
 * inspection. Flags any import (or `require()`/`import()`) whose specifier
 * names a Node builtin (`fs`, `path`, `child_process`, ...), a database
 * package (`better-sqlite3`, `drizzle-orm`, `drizzle-kit`), or a relative
 * path that reaches into `electron/main/**` — the one tree that owns the
 * database connection (`electron/main/db/connection.ts` is the single
 * `new Database(...)` call site — `db/connection.test.ts` asserts that
 * structurally) and every other main-only concern (`ipc/registry.ts`'s
 * handlers, `app`, `session`, ...). `window.crm.*` (T-260828-09) is the only
 * sanctioned path from renderer code to any of it.
 */

/** Node builtins this rule bans outright, with and without the `node:` prefix. */
const BANNED_BUILTIN_MODULES = new Set([
  'fs',
  'fs/promises',
  'node:fs',
  'node:fs/promises',
  'path',
  'node:path',
  'path/posix',
  'node:path/posix',
  'path/win32',
  'node:path/win32',
  'child_process',
  'node:child_process'
])

/** Packages that talk to the database directly — never a renderer concern. */
const BANNED_DATABASE_PACKAGES = new Set(['better-sqlite3', 'drizzle-orm', 'drizzle-kit'])

/** True for any bare `node:*` specifier, even one not individually listed above — an unlisted Node builtin is still a Node builtin. */
function isNodeColonSpecifier(specifier) {
  return specifier.startsWith('node:')
}

/** True for a relative specifier that reaches into electron/main — the process boundary this rule exists to hold (AGENTS.md, T-260828-04's contextIsolation/sandbox baseline). */
function reachesIntoMainProcess(specifier) {
  return /(^|\/)main(\/|$)/.test(specifier) && (specifier.startsWith('../') || specifier.startsWith('./'))
}

/**
 * @param {string} specifier
 * @returns {string | null} a human-readable reason, or null if the specifier is fine.
 */
function bannedReason(specifier) {
  if (BANNED_BUILTIN_MODULES.has(specifier) || isNodeColonSpecifier(specifier)) {
    return `"${specifier}" is a Node built-in`
  }
  if (BANNED_DATABASE_PACKAGES.has(specifier)) {
    return `"${specifier}" talks to the database directly`
  }
  if (reachesIntoMainProcess(specifier)) {
    return `"${specifier}" reaches into electron/main, the main process's own tree`
  }
  return null
}

const messages = {
  bannedImport:
    'Renderer code may not import {{specifier}} — {{reason}}. The renderer never touches SQLite or the filesystem ' +
    '(AGENTS.md); reach main through a named window.crm.* method instead (electron/main/ipc/registry.ts).'
}

/** @type {import('eslint').Rule.RuleModule} */
export const noRendererNodeAccess = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow importing fs/path/child_process, a database package, or anything under electron/main from renderer code.'
    },
    schema: [],
    messages
  },
  create(context) {
    /** @param {import('estree').Node} node @param {string | undefined} specifier */
    function check(node, specifier) {
      if (typeof specifier !== 'string') return
      const reason = bannedReason(specifier)
      if (!reason) return
      context.report({ node, messageId: 'bannedImport', data: { specifier, reason } })
    }

    return {
      ImportDeclaration(node) {
        check(node, node.source.value)
      },
      ImportExpression(node) {
        if (node.source.type === 'Literal') check(node, node.source.value)
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value)
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value)
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal'
        ) {
          check(node, node.arguments[0].value)
        }
      }
    }
  }
}
