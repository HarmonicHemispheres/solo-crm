import { Linter } from 'eslint'
import tseslint from 'typescript-eslint'
import { describe, expect, it } from 'vitest'
import { noRendererNodeAccess } from './no-renderer-node-access.js'

/**
 * Proves eslint-rules/no-renderer-node-access.js actually fires (T-260828-09's
 * acceptance criterion: "enforced by a lint rule rather than by inspection")
 * rather than trusting the rule body by inspection. Uses ESLint's own
 * `Linter` directly instead of `RuleTester` — this codebase has no existing
 * RuleTester harness (no-literal-colour.js has no dedicated test file
 * either), and a plain `linter.verify()` call is enough to prove a rule
 * fires without introducing a new test-only dependency.
 *
 * `typescript-eslint`'s own parser (not espree, ESLint's default) so
 * TypeScript syntax the rule needs to see — `import type { X } from '...'`,
 * exercised below — parses at all; eslint.config.js gets this the same way,
 * via tseslint.config()'s own recommended set. Already a project
 * devDependency, so this reuses it rather than reaching for
 * @typescript-eslint/parser as a separate, undeclared transitive import.
 */
const linter = new Linter()
const config = {
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022 as const,
    sourceType: 'module' as const
  },
  plugins: { local: { rules: { 'no-renderer-node-access': noRendererNodeAccess } } },
  rules: { 'local/no-renderer-node-access': 'error' as const }
}

function lint(code: string): string[] {
  const messages = linter.verify(code, config)
  return messages.map((message) => message.message)
}

describe('no-renderer-node-access', () => {
  it('flags a Node builtin import, with or without the node: prefix', () => {
    expect(lint(`import fs from 'node:fs'`)).toHaveLength(1)
    expect(lint(`import { readFileSync } from 'fs'`)).toHaveLength(1)
    expect(lint(`import path from 'node:path'`)).toHaveLength(1)
    expect(lint(`import { spawn } from 'child_process'`)).toHaveLength(1)
  })

  it('flags any node: specifier, even one not individually listed', () => {
    expect(lint(`import dns from 'node:dns'`)).toHaveLength(1)
  })

  it('flags a database package import', () => {
    expect(lint(`import Database from 'better-sqlite3'`)).toHaveLength(1)
    expect(lint(`import { drizzle } from 'drizzle-orm'`)).toHaveLength(1)
  })

  it('flags a relative import that reaches into electron/main', () => {
    expect(lint(`import { getDatabase } from '../../main/db/connection'`)).toHaveLength(1)
    expect(lint(`import { registry } from '../main/ipc/registry'`)).toHaveLength(1)
  })

  it('flags require() and dynamic import() of a banned specifier, not just static import', () => {
    expect(lint(`const fs = require('node:fs')`)).toHaveLength(1)
    expect(lint(`const fs = await import('node:fs')`)).toHaveLength(1)
  })

  it('does not flag ordinary renderer imports', () => {
    expect(lint(`import { useState } from 'react'`)).toHaveLength(0)
    expect(lint(`import { z } from 'zod'`)).toHaveLength(0)
    expect(lint(`import type { CrmApi } from '../shared/ipc-types'`)).toHaveLength(0)
    expect(lint(`import { Card } from './components/primitives/Card'`)).toHaveLength(0)
  })

  it('does not flag a method call that happens to be named require', () => {
    // node.callee is a MemberExpression here, not the bare `require`
    // Identifier the rule matches — a real require('fs') would still be
    // flagged regardless of file-local shadowing, which is fine: nobody
    // legitimately shadows the global require.
    expect(lint(`someObject.require('fs')`)).toHaveLength(0)
  })
})
