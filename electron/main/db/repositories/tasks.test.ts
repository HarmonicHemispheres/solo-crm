import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nowTimestamp } from '../../../shared/format'
import { closeDatabase, getDatabase, openDatabase } from '../connection'
import { NotFoundError, RefusalError, ValidationError } from './errors'
import { countOpenTasks, createTask, deleteTask, getTask, listTasks, setNextStep, updateTask } from './tasks'

/**
 * Every test here runs `createTask`/`getTask`/`updateTask`/`deleteTask`/
 * `setNextStep`/`countOpenTasks`/`listTasks` against a real, migrated
 * database opened through `openDatabase({ userDataDir })` — same discipline
 * as `companies.test.ts`, not a mock or an in-memory stub of the
 * repository's own making.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'solo-crm-tasks-repo-'))
}

afterEach(() => {
  closeDatabase()
})

function withDatabase<T>(fn: (db: Database.Database) => T): T {
  const tmpDir = makeTmpDir()
  try {
    openDatabase({ userDataDir: tmpDir })
    return fn(getDatabase())
  } finally {
    closeDatabase()
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** Raw insert — `companies` has no repository-independent dependency this file needs to avoid. */
function insertCompany(db: Database.Database, name: string): string {
  const id = randomUUID()
  const now = nowTimestamp()
  db.prepare(
    `INSERT INTO companies (id, name, bills_directly, cadence_days, created_at, updated_at) VALUES (?, ?, 1, 14, ?, ?)`
  ).run(id, name, now, now)
  return id
}

function insertEngagement(db: Database.Database, name: string): string {
  const id = randomUUID()
  const now = nowTimestamp()
  db.prepare(`INSERT INTO engagements (id, name, started_on, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    name,
    '2026-01-01',
    now,
    now
  )
  return id
}

function insertPerson(db: Database.Database, name: string): string {
  const id = randomUUID()
  const now = nowTimestamp()
  db.prepare(`INSERT INTO people (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(id, name, now, now)
  return id
}

/** Raw read of a single column, for assertions the repository's own return value could mask a bug in. */
function rawColumn(db: Database.Database, id: string, column: 'waiting_since' | 'done_at' | 'is_next_step'): unknown {
  const row = db.prepare(`SELECT ${column} AS value FROM tasks WHERE id = ?`).get(id) as { value: unknown }
  return row.value
}

describe('createTask / getTask: round-trip', () => {
  it('round-trips every field when all are given', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Acme')
      const engagementId = insertEngagement(db, 'Acme Retainer')
      const personId = insertPerson(db, 'Jane')

      const created = createTask(db, {
        title: 'Follow up with Jane',
        status: 'todo',
        dueOn: '2026-09-01',
        companyId,
        engagementId,
        personId
      })
      const fetched = getTask(db, created.id)

      expect(fetched).toEqual(created)
      expect(created.id).toMatch(UUID_PATTERN)
      expect(created.title).toBe('Follow up with Jane')
      expect(created.status).toBe('todo')
      expect(created.dueOn).toBe('2026-09-01')
      expect(created.companyId).toBe(companyId)
      expect(created.engagementId).toBe(engagementId)
      expect(created.personId).toBe(personId)
      expect(created.isNextStep).toBe(false)
      expect(created.waitingSince).toBeNull()
      expect(created.doneAt).toBeNull()
      expect(created.createdAt).toEqual(created.updatedAt)
    })
  })

  it('defaults status to todo when the caller omits it', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Bare task' })
      expect(created.status).toBe('todo')
      expect(created.isNextStep).toBe(false)
      expect(created.waitingSince).toBeNull()
      expect(created.doneAt).toBeNull()
    })
  })

  it('is creatable with no company, engagement or person, and appears in an unfiltered list', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Untethered task' })
      expect(created.companyId).toBeNull()
      expect(created.engagementId).toBeNull()
      expect(created.personId).toBeNull()

      const all = listTasks(db)
      expect(all.map((t) => t.id)).toContain(created.id)
    })
  })

  it('creating directly into waiting stamps waiting_since', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Blocked task', status: 'waiting' })
      expect(created.status).toBe('waiting')
      expect(created.waitingSince).not.toBeNull()
      expect(created.doneAt).toBeNull()
    })
  })

  it('creating directly into done stamps done_at', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Already handled', status: 'done' })
      expect(created.status).toBe('done')
      expect(created.doneAt).not.toBeNull()
      expect(created.waitingSince).toBeNull()
    })
  })

  it('getTask returns null for an id that does not exist', () => {
    withDatabase((db) => {
      expect(getTask(db, randomUUID())).toBeNull()
    })
  })
})

describe('createTask / updateTask: id and timestamps', () => {
  it('assigns a UUID id and equal created_at/updated_at on create; update moves updated_at and leaves created_at', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-28T10:00:00.000Z'))
      withDatabase((db) => {
        const created = createTask(db, { title: 'Time task' })
        expect(created.id).toMatch(UUID_PATTERN)
        expect(created.createdAt).toBe('2026-08-28T10:00:00.000Z')
        expect(created.updatedAt).toBe('2026-08-28T10:00:00.000Z')

        vi.setSystemTime(new Date('2026-08-28T10:05:00.000Z'))
        const updated = updateTask(db, created.id, { title: 'Time task, renamed' })
        expect(updated.createdAt).toBe(created.createdAt)
        expect(updated.updatedAt).toBe('2026-08-28T10:05:00.000Z')
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('updateTask throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => updateTask(db, randomUUID(), { title: 'x' })).toThrow(NotFoundError)
    })
  })

  it('a patch with an explicit undefined-valued key leaves the column untouched, same as an absent key', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Acme')
      const created = createTask(db, { title: 'Patch task', companyId })
      expect(created.companyId).toBe(companyId)

      const updated = updateTask(db, created.id, { companyId: undefined, title: 'Patch task, renamed' })
      expect(updated.companyId).toBe(companyId)
      expect(updated.title).toBe('Patch task, renamed')
    })
  })
})

describe('status transitions own waiting_since / done_at', () => {
  it('todo -> waiting -> todo sets waiting_since then clears it, asserted on the raw column at each step', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Ping the vendor' })
      expect(rawColumn(db, created.id, 'waiting_since')).toBeNull()

      const waiting = updateTask(db, created.id, { status: 'waiting' })
      expect(waiting.status).toBe('waiting')
      expect(rawColumn(db, created.id, 'waiting_since')).not.toBeNull()
      expect(waiting.waitingSince).not.toBeNull()

      const backToTodo = updateTask(db, created.id, { status: 'todo' })
      expect(backToTodo.status).toBe('todo')
      expect(rawColumn(db, created.id, 'waiting_since')).toBeNull()
      expect(backToTodo.waitingSince).toBeNull()
    })
  })

  it('a task moved to done and reopened has done_at set then null', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Draft the proposal' })

      const done = updateTask(db, created.id, { status: 'done' })
      expect(done.status).toBe('done')
      expect(rawColumn(db, created.id, 'done_at')).not.toBeNull()
      expect(done.doneAt).not.toBeNull()

      const reopened = updateTask(db, created.id, { status: 'todo' })
      expect(reopened.status).toBe('todo')
      expect(rawColumn(db, created.id, 'done_at')).toBeNull()
      expect(reopened.doneAt).toBeNull()
    })
  })

  it('waiting -> done clears waiting_since and sets done_at in the same update', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Chase the signature', status: 'waiting' })
      expect(created.waitingSince).not.toBeNull()

      const done = updateTask(db, created.id, { status: 'done' })
      expect(done.status).toBe('done')
      expect(done.waitingSince).toBeNull()
      expect(done.doneAt).not.toBeNull()
    })
  })

  it('resending the same status is a no-op on waiting_since / done_at', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Steady task', status: 'waiting' })
      const firstWaitingSince = created.waitingSince

      // Advance time so a stamp, if wrongly re-applied, would visibly differ.
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'))
        const resent = updateTask(db, created.id, { status: 'waiting', title: 'Steady task, renamed' })
        expect(resent.waitingSince).toBe(firstWaitingSince)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  it('createTask rejects waiting_since and done_at as unrecognized keys', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'x', waiting_since: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)
      expect(() => createTask(db, { title: 'x', waitingSince: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)
      expect(() => createTask(db, { title: 'x', doneAt: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)
    })
  })

  it('updateTask rejects waiting_since and done_at as unrecognized keys, and the row is left unchanged', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Untouchable' })

      expect(() => updateTask(db, created.id, { waitingSince: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)
      expect(() => updateTask(db, created.id, { doneAt: '2026-08-28T10:00:00.000Z' })).toThrow(ValidationError)

      const after = getTask(db, created.id)
      expect(after?.waitingSince).toBeNull()
      expect(after?.doneAt).toBeNull()
      expect(after?.updatedAt).toBe(created.updatedAt)
    })
  })

  it('createTask and updateTask reject isNextStep as an unrecognized key — only setNextStep may write it', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'x', isNextStep: true })).toThrow(ValidationError)

      const created = createTask(db, { title: 'y' })
      expect(() => updateTask(db, created.id, { isNextStep: true })).toThrow(ValidationError)
    })
  })
})

describe('countOpenTasks: one definition of open, excluding waiting and done', () => {
  it('over a fixture of 1 todo, 1 waiting, 1 done, returns 1', () => {
    withDatabase((db) => {
      createTask(db, { title: 'Open task', status: 'todo' })
      createTask(db, { title: 'Waiting task', status: 'waiting' })
      createTask(db, { title: 'Done task', status: 'done' })

      expect(countOpenTasks(db)).toBe(1)
    })
  })

  it('counts a null-status task as open', () => {
    withDatabase((db) => {
      // Direct insert: createTask always defaults status to 'todo', so a
      // genuinely null status can only arise from a raw row (e.g. a legacy
      // import) — countOpenTasks must still treat it as open, not silently
      // drop it from the count.
      const now = nowTimestamp()
      db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(randomUUID(), 'Null status', now, now)

      expect(countOpenTasks(db)).toBe(1)
    })
  })

  it('filters by companyId', () => {
    withDatabase((db) => {
      const companyA = insertCompany(db, 'A Co')
      const companyB = insertCompany(db, 'B Co')
      createTask(db, { title: 'A task', companyId: companyA })
      createTask(db, { title: 'B task 1', companyId: companyB })
      createTask(db, { title: 'B task 2', companyId: companyB })

      expect(countOpenTasks(db, { companyId: companyA })).toBe(1)
      expect(countOpenTasks(db, { companyId: companyB })).toBe(2)
    })
  })
})

describe('listTasks: filters', () => {
  it('filters by status', () => {
    withDatabase((db) => {
      createTask(db, { title: 'Todo task', status: 'todo' })
      createTask(db, { title: 'Waiting task', status: 'waiting' })

      const waiting = listTasks(db, { status: 'waiting' })
      expect(waiting).toHaveLength(1)
      expect(waiting[0].title).toBe('Waiting task')
    })
  })

  it('filters by company, engagement and person', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Acme')
      const engagementId = insertEngagement(db, 'Acme Retainer')
      const personId = insertPerson(db, 'Jane')

      createTask(db, { title: 'Linked task', companyId, engagementId, personId })
      createTask(db, { title: 'Unlinked task' })

      expect(listTasks(db, { companyId }).map((t) => t.title)).toEqual(['Linked task'])
      expect(listTasks(db, { engagementId }).map((t) => t.title)).toEqual(['Linked task'])
      expect(listTasks(db, { personId }).map((t) => t.title)).toEqual(['Linked task'])
    })
  })

  it('filters by due window inclusively, excluding tasks with no due date', () => {
    withDatabase((db) => {
      createTask(db, { title: 'Too early', dueOn: '2026-08-01' })
      createTask(db, { title: 'In window start', dueOn: '2026-09-01' })
      createTask(db, { title: 'In window end', dueOn: '2026-09-30' })
      createTask(db, { title: 'Too late', dueOn: '2026-10-15' })
      createTask(db, { title: 'No due date' })

      const inWindow = listTasks(db, { dueFrom: '2026-09-01', dueTo: '2026-09-30' })
      expect(inWindow.map((t) => t.title).sort()).toEqual(['In window end', 'In window start'])
    })
  })
})

describe('setNextStep: exactly one open task per company', () => {
  it('leaves exactly one row with is_next_step true among three open tasks, and does not touch another company', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Acme')
      const otherCompanyId = insertCompany(db, 'Other Co')

      const first = createTask(db, { title: 'First', companyId })
      const second = createTask(db, { title: 'Second', companyId })
      const third = createTask(db, { title: 'Third', companyId })
      const otherTask = setNextStep(db, createTask(db, { title: 'Other next step', companyId: otherCompanyId }).id)
      expect(otherTask.isNextStep).toBe(true)

      setNextStep(db, first.id)
      setNextStep(db, second.id)
      const finalNext = setNextStep(db, third.id)

      expect(finalNext.isNextStep).toBe(true)
      expect(getTask(db, first.id)?.isNextStep).toBe(false)
      expect(getTask(db, second.id)?.isNextStep).toBe(false)

      const nextStepCount = db
        .prepare('SELECT COUNT(*) AS count FROM tasks WHERE company_id = ? AND is_next_step = 1')
        .get(companyId) as { count: number }
      expect(nextStepCount.count).toBe(1)

      // The other company's next step is untouched.
      expect(getTask(db, otherTask.id)?.isNextStep).toBe(true)
    })
  })

  it('does not clear the flag on a done task from the same company — closed history is not rewritten', () => {
    withDatabase((db) => {
      const companyId = insertCompany(db, 'Acme')

      const closed = createTask(db, { title: 'Closed next step', companyId })
      setNextStep(db, closed.id)
      updateTask(db, closed.id, { status: 'done' })
      expect(rawColumn(db, closed.id, 'is_next_step')).toBe(1)

      const open = createTask(db, { title: 'New next step', companyId })
      const result = setNextStep(db, open.id)

      expect(result.isNextStep).toBe(true)
      // The done task's flag survives — setNextStep only clears OPEN tasks.
      expect(rawColumn(db, closed.id, 'is_next_step')).toBe(1)
    })
  })

  it('refuses a task with no company, leaving no row changed', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Companyless task' })

      let thrown: unknown
      try {
        setNextStep(db, created.id)
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('no-company')
      expect(getTask(db, created.id)?.isNextStep).toBe(false)
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => setNextStep(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

describe('deleteTask', () => {
  it('deletes cleanly — no table references tasks.id', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Disposable task' })
      deleteTask(db, created.id)
      expect(getTask(db, created.id)).toBeNull()
    })
  })

  it('throws NotFoundError for an id that does not exist', () => {
    withDatabase((db) => {
      expect(() => deleteTask(db, randomUUID())).toThrow(NotFoundError)
    })
  })
})

describe('foreign key refusals', () => {
  it('createTask refuses a companyId that does not exist', () => {
    withDatabase((db) => {
      let thrown: unknown
      try {
        createTask(db, { title: 'Dangling', companyId: randomUUID() })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(RefusalError)
      expect((thrown as RefusalError).blocker?.reason).toBe('foreign-key')
    })
  })

  it('createTask refuses an engagementId that does not exist', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'Dangling', engagementId: randomUUID() })).toThrow(RefusalError)
    })
  })

  it('createTask refuses a personId that does not exist', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'Dangling', personId: randomUUID() })).toThrow(RefusalError)
    })
  })
})

describe('input validation', () => {
  it('createTask rejects a blank title as a ValidationError', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: '' })).toThrow(ValidationError)
    })
  })

  it('createTask rejects an unknown status value', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'Odd task', status: 'not-a-real-status' })).toThrow(ValidationError)
    })
  })

  it('createTask rejects an unknown field name', () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'Typo task', ttile: 'Typo task' })).toThrow(ValidationError)
    })
  })

  it('updateTask rejects a non-object patch', () => {
    withDatabase((db) => {
      const created = createTask(db, { title: 'Patch task' })
      expect(() => updateTask(db, created.id, 'not an object')).toThrow(ValidationError)
    })
  })

  it("the due_on column: dateOnlySchema rejects '2026-9-1'", () => {
    withDatabase((db) => {
      expect(() => createTask(db, { title: 'Bad date task', dueOn: '2026-9-1' })).toThrow(ValidationError)
    })
  })
})
