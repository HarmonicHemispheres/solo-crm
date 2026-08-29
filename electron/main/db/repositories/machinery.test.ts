import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { RefusalError, ValidationError } from './errors'
import { boolToSql, formatIssues, parseInput, stripUndefinedValues } from './input'
import {
  type ConstraintHandler,
  isSqliteConstraintError,
  NOT_NULL_HANDLER,
  PRIMARY_KEY_HANDLER,
  translateWriteError,
  UNIQUE_HANDLER
} from './sqlite-errors'

/**
 * The extracted repository machinery (T-260828-43). Until this file existed
 * the behaviour below was tested only incidentally, through whichever
 * repository happened to exercise it — which is how six byte-identical
 * copies of it survived review in the first place. Nothing here opens a
 * database: this is the table-agnostic half, and it is tested as such.
 *
 * The last describe block is the one that keeps the extraction extracted.
 */

// ---------------------------------------------------------------------------
// stripUndefinedValues — the absent-vs-explicitly-undefined rule
// ---------------------------------------------------------------------------

describe('stripUndefinedValues', () => {
  it('removes a key whose value is the literal undefined', () => {
    const result = stripUndefinedValues({ name: 'Acme', notes: undefined })
    expect('notes' in result).toBe(false)
    expect(result).toEqual({ name: 'Acme' })
  })

  it('keeps an explicit null — "set this column to NULL" is not "leave it alone"', () => {
    const result = stripUndefinedValues({ notes: null })
    expect('notes' in result).toBe(true)
    expect(result.notes).toBeNull()
  })

  it('keeps every other falsy value', () => {
    const result = stripUndefinedValues({ zero: 0, empty: '', no: false })
    expect(result).toEqual({ zero: 0, empty: '', no: false })
  })

  it('does not mutate its argument', () => {
    const input: { notes?: string } = { notes: undefined }
    stripUndefinedValues(input)
    expect('notes' in input).toBe(true)
  })

  it('passes non-objects and null through unchanged', () => {
    expect(stripUndefinedValues(null)).toBeNull()
    expect(stripUndefinedValues(undefined)).toBeUndefined()
    expect(stripUndefinedValues('text')).toBe('text')
    expect(stripUndefinedValues(7)).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// formatIssues
// ---------------------------------------------------------------------------

describe('formatIssues', () => {
  it('joins one line per issue, path first', () => {
    expect(
      formatIssues([
        { path: ['name'], message: 'Too small' },
        { path: ['billing', 'rate'], message: 'Expected number' }
      ])
    ).toBe('name: Too small; billing.rate: Expected number')
  })

  it('names an empty path "(root)" rather than rendering an empty field', () => {
    expect(formatIssues([{ path: [], message: 'Unrecognized key' }])).toBe('(root): Unrecognized key')
  })
})

// ---------------------------------------------------------------------------
// parseInput
// ---------------------------------------------------------------------------

const personSchema = z
  .object({
    name: z.string().min(1),
    notes: z.string().nullable().optional()
  })
  .strict()

describe('parseInput', () => {
  it('returns the parsed data on success', () => {
    expect(parseInput(personSchema, { name: 'Acme' })).toEqual({ name: 'Acme' })
  })

  it('strips an explicitly-undefined key from the result, so "absent" and "undefined" mean the same thing', () => {
    const parsed = parseInput(personSchema, { name: 'Acme', notes: undefined })
    expect('notes' in parsed).toBe(false)
  })

  it('keeps an explicitly-null key', () => {
    const parsed = parseInput(personSchema, { name: 'Acme', notes: null })
    expect('notes' in parsed).toBe(true)
    expect(parsed.notes).toBeNull()
  })

  it('throws a ValidationError, never a raw ZodError', () => {
    expect(() => parseInput(personSchema, { name: '' })).toThrow(ValidationError)
    expect(() => parseInput(personSchema, { name: '' })).not.toThrow(z.ZodError)
  })

  it('carries the joined message and the raw issues on the ValidationError', () => {
    try {
      parseInput(personSchema, { name: 1 })
      expect.unreachable('parseInput should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      const validation = error as ValidationError
      expect(validation.message).toContain('name: ')
      expect(validation.issues).toBeDefined()
      expect(validation.issues?.[0]?.path).toEqual(['name'])
    }
  })

  it('with stripBeforeParse, an undefined-valued key cannot defeat a union branch', () => {
    // The engagements shape in miniature: a `.strict()` branch with no
    // `mode` key at all, and a discriminated branch keyed on `mode`.
    const common = z.object({ notes: z.string() }).strict()
    const discriminated = z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('hourly'), rate: z.number() }).strict(),
      z.object({ mode: z.literal('fixed'), total: z.number() }).strict()
    ])
    const union = z.union([common, discriminated])

    expect(() => parseInput(union, { mode: undefined, notes: 'x' })).toThrow(ValidationError)
    expect(parseInput(union, { mode: undefined, notes: 'x' }, { stripBeforeParse: true })).toEqual({ notes: 'x' })
  })

  it('applies transformIssues before formatting the message', () => {
    const shouted = (issues: readonly z.core.$ZodIssue[]): readonly z.core.$ZodIssue[] =>
      issues.map((issue) => ({ ...issue, message: issue.message.toUpperCase() }))
    try {
      parseInput(personSchema, { name: 1 }, { transformIssues: shouted })
      expect.unreachable('parseInput should have thrown')
    } catch (error) {
      const validation = error as ValidationError
      const [path, ...rest] = validation.message.split(': ')
      const issueMessage = rest.join(': ')
      expect(path).toBe('name')
      expect(issueMessage).toBe(issueMessage.toUpperCase())
      expect(issueMessage.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// boolToSql
// ---------------------------------------------------------------------------

describe('boolToSql', () => {
  it('maps a boolean to 1/0 and null-ish to NULL rather than 0', () => {
    expect(boolToSql(true)).toBe(1)
    expect(boolToSql(false)).toBe(0)
    expect(boolToSql(null)).toBeNull()
    expect(boolToSql(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// sqlite-errors
// ---------------------------------------------------------------------------

const constraintError = (code: string, message = 'some driver text') => Object.assign(new Error(message), { code })

describe('isSqliteConstraintError', () => {
  it('recognises any SQLITE_CONSTRAINT_* subcode', () => {
    expect(isSqliteConstraintError(constraintError('SQLITE_CONSTRAINT_FOREIGNKEY'))).toBe(true)
    expect(isSqliteConstraintError(constraintError('SQLITE_CONSTRAINT_TRIGGER'))).toBe(true)
  })

  it('rejects everything else', () => {
    expect(isSqliteConstraintError(constraintError('SQLITE_BUSY'))).toBe(false)
    expect(isSqliteConstraintError(new Error('plain'))).toBe(false)
    expect(isSqliteConstraintError({ code: 42 })).toBe(false)
    expect(isSqliteConstraintError(null)).toBe(false)
    expect(isSqliteConstraintError(undefined)).toBe(false)
  })
})

describe('translateWriteError', () => {
  const handlers: Record<string, ConstraintHandler> = {
    SQLITE_CONSTRAINT_NOTNULL: NOT_NULL_HANDLER,
    SQLITE_CONSTRAINT_UNIQUE: UNIQUE_HANDLER,
    SQLITE_CONSTRAINT_PRIMARYKEY: PRIMARY_KEY_HANDLER
  }

  it('dispatches on the subcode', () => {
    expect(() => translateWriteError(handlers, constraintError('SQLITE_CONSTRAINT_NOTNULL'))).toThrow(
      'A required field was left empty.'
    )
    expect(() => translateWriteError(handlers, constraintError('SQLITE_CONSTRAINT_UNIQUE'))).toThrow(
      'This value conflicts with an existing row.'
    )
    expect(() => translateWriteError(handlers, constraintError('SQLITE_CONSTRAINT_PRIMARYKEY'))).toThrow('This id is already in use.')
  })

  it('attaches a structured blocker reason rather than leaving callers to match the message', () => {
    try {
      translateWriteError(handlers, constraintError('SQLITE_CONSTRAINT_UNIQUE'))
      expect.unreachable('translateWriteError should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RefusalError)
      expect((error as RefusalError).blocker).toEqual({ reason: 'unique' })
    }
  })

  it('passes the error to the handler, for a CHECK branch that dispatches on a constraint name', () => {
    const named: Record<string, ConstraintHandler> = {
      SQLITE_CONSTRAINT_CHECK: (error) =>
        error.message.includes('some_named_check')
          ? new RefusalError('The named check refused this.', { reason: 'named' })
          : new RefusalError('Some other check refused this.', { reason: 'check' })
    }
    expect(() => translateWriteError(named, constraintError('SQLITE_CONSTRAINT_CHECK', 'CHECK some_named_check failed'))).toThrow(
      'The named check refused this.'
    )
    expect(() => translateWriteError(named, constraintError('SQLITE_CONSTRAINT_CHECK', 'CHECK other failed'))).toThrow(
      'Some other check refused this.'
    )
  })

  it('refuses an uncovered constraint subcode without leaking driver text', () => {
    try {
      translateWriteError(handlers, constraintError('SQLITE_CONSTRAINT_TRIGGER', 'trigger raised abort'))
      expect.unreachable('translateWriteError should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(RefusalError)
      expect((error as RefusalError).message).toBe('This write violates a database constraint.')
      expect((error as RefusalError).message).not.toContain('trigger raised abort')
      expect((error as RefusalError).blocker).toEqual({ reason: 'constraint' })
    }
  })

  it('rethrows anything that is not a constraint error, unchanged', () => {
    const bug = new Error('genuine bug')
    expect(() => translateWriteError(handlers, bug)).toThrow(bug)
    const busy = constraintError('SQLITE_BUSY', 'database is locked')
    expect(() => translateWriteError(handlers, busy)).toThrow(busy)
  })
})

// ---------------------------------------------------------------------------
// The extraction itself (this task's Acceptance)
//
// Asserted by scanning the tree, not by reading a diff: the whole point of
// T-260828-43 is that a seventh hand-synced copy of this machinery must fail
// the suite rather than wait for a reviewer to notice it. A pattern matches
// only a declaration at the start of a line, so a mention inside a comment,
// a string or an import list does not count.
// ---------------------------------------------------------------------------

const ELECTRON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function typescriptFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      found.push(...typescriptFiles(path))
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      found.push(path)
    }
  }
  return found
}

function declarationsOf(name: string): string[] {
  const pattern = new RegExp(String.raw`^(?:export\s+)?(?:abstract\s+)?(?:function|const|let|var|type|interface|class)\s+${name}\b`, 'm')
  return typescriptFiles(ELECTRON_DIR)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(ELECTRON_DIR, file).replace(/\\/g, '/'))
}

describe('the machinery is declared exactly once', () => {
  it.each([
    ['parseInput', 'main/db/repositories/input.ts'],
    ['stripUndefinedValues', 'main/db/repositories/input.ts'],
    ['formatIssues', 'main/db/repositories/input.ts'],
    ['boolToSql', 'main/db/repositories/input.ts'],
    ['isSqliteConstraintError', 'main/db/repositories/sqlite-errors.ts'],
    ['translateWriteError', 'main/db/repositories/sqlite-errors.ts'],
    ['SqliteConstraintError', 'main/db/repositories/sqlite-errors.ts'],
    ['ConstraintHandler', 'main/db/repositories/sqlite-errors.ts']
  ])('%s is declared only in %s', (name, home) => {
    expect(declarationsOf(name)).toEqual([home])
  })

  it('finds the files it claims to be scanning (a broken scan must not pass vacuously)', () => {
    const files = typescriptFiles(ELECTRON_DIR)
    expect(files.length).toBeGreaterThan(50)
    expect(declarationsOf('RefusalError')).toEqual(['main/db/repositories/errors.ts'])
  })
})
