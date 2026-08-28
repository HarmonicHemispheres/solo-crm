import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// electron/main/index.ts's own `import { ipcMain } from 'electron'` needs a
// real Electron process; under plain vitest it would resolve to the binary
// path string (renderer-globals.test.ts's header comment). Mocking ipcMain
// with a spy lets this file prove registerIpcHandlers' validation and
// error-envelope behaviour — the point of this test — without booting a
// real Electron process; the real end-to-end proof (contextBridge +
// ipcMain + a real preload under sandbox: true) lives in bridge.test.ts.
const handle = vi.fn()
vi.mock('electron', () => ({ ipcMain: { handle } }))

const { registerIpcHandlers } = await import('./index')
const { defineChannel } = await import('./registry')
const { errResult, okResult } = await import('../../shared/ipc-types')

/** Retrieves the wrapped handler registerIpcHandlers registered for `channel`, so a test can invoke it directly with a fake IPC event. */
function getRegisteredHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  const call = handle.mock.calls.find(([registeredChannel]) => registeredChannel === channel)
  if (!call) throw new Error(`no ipcMain.handle call registered for "${channel}"`)
  return call[1] as (event: unknown, payload: unknown) => Promise<unknown>
}

const fakeEvent = {} as never

describe('registerIpcHandlers', () => {
  it('a valid payload reaches the handler and returns an ok envelope with the validated response', async () => {
    handle.mockClear()
    const handler = vi.fn(async (payload: { name: string }) => ({ greeting: `hello ${payload.name}` }))
    registerIpcHandlers({
      'test:greet': defineChannel({
        request: z.object({ name: z.string() }),
        response: z.object({ greeting: z.string() }),
        handler
      })
    })

    const result = await getRegisteredHandler('test:greet')(fakeEvent, { name: 'Robby' })

    expect(handler).toHaveBeenCalledWith({ name: 'Robby' })
    expect(result).toEqual(okResult({ greeting: 'hello Robby' }))
  })

  it('an invalid request payload returns a typed error envelope, and the handler is never called — nothing throws', async () => {
    handle.mockClear()
    const handler = vi.fn()
    registerIpcHandlers({
      'test:greet': defineChannel({
        request: z.object({ name: z.string() }),
        response: z.object({ greeting: z.string() }),
        handler
      })
    })

    let thrown: unknown
    let result: unknown
    try {
      result = await getRegisteredHandler('test:greet')(fakeEvent, { name: 42 })
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeUndefined()
    expect(handler).not.toHaveBeenCalled()
    expect(result).toEqual({ ok: false, error: { code: 'invalid-request', message: expect.any(String) } })
  })

  it('a handler that throws returns a typed error envelope with no stack trace or thrown exception crossing the boundary', async () => {
    handle.mockClear()
    registerIpcHandlers({
      'test:explode': defineChannel({
        request: z.undefined(),
        response: z.object({ ok: z.literal(true) }),
        handler: () => {
          throw new Error('boom: C:\\Users\\robby\\AppData\\Local\\solocrm\\solocrm.db is locked')
        }
      })
    })

    let thrown: unknown
    const result = await getRegisteredHandler('test:explode')(fakeEvent, undefined).catch((error: unknown) => {
      thrown = error
      return undefined
    })

    expect(thrown).toBeUndefined()
    expect(result).toEqual(errResult('handler-error', expect.any(String)))
    const message = (result as { error: { message: string } }).error.message
    expect(message).not.toContain('AppData')
    expect(message).not.toContain('.db')
    expect(message).not.toContain('boom')
  })

  it('a handler returning the wrong shape fails response validation and never reaches the caller as-is', async () => {
    handle.mockClear()
    registerIpcHandlers({
      'test:wrongShape': defineChannel({
        request: z.undefined(),
        response: z.object({ version: z.string() }),
        // A repository bug: returns a number where the response schema
        // requires a string. This must fail loudly here, not render as
        // `undefined` in a card downstream.
        handler: () => ({ version: 42 }) as unknown as { version: string }
      })
    })

    const result = await getRegisteredHandler('test:wrongShape')(fakeEvent, undefined)

    expect(result).toEqual({ ok: false, error: { code: 'invalid-response', message: expect.any(String) } })
  })
})
