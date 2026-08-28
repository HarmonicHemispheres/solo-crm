import { ipcMain } from 'electron'
import { errResult, okResult } from '../../shared/ipc-types'
import type { IpcResult } from '../../shared/ipc-types'
import { registry as defaultRegistry } from './registry'
import type { ChannelDefinition } from './registry'

/**
 * Binds every entry in `registry` (registry.ts) to a real `ipcMain.handle`
 * call. Loops generically over whatever the registry declares — this file
 * never needs an edit when a channel is added, which is the point: T-260828-09's
 * Why warns that if adding a channel takes edits in four files, four files
 * will drift, and this is one of the two files (with preload/index.ts) that
 * has to stay generic for that to hold.
 *
 * Nothing thrown by a handler, and no value a handler returns, reaches the
 * renderer directly — every path below returns an `IpcResult`, so a caller
 * on the other side of `contextBridge` never sees a thrown exception cross
 * the boundary, only data with a `code` and a `message` (never a stack trace
 * or a filesystem path — this task's Risks note).
 *
 * Response validation runs in every environment, not only development: this
 * app's single-user, local-desktop volumes (§8) make one extra `safeParse`
 * per round trip negligible, and skipping it in production would leave the
 * exact silent asymmetry the Risks note warns against — a repository bug
 * that fails loudly in dev would instead ship `undefined` into a card in a
 * packaged build. Both request and response validation are unconditional by
 * design, in both directions, in every build.
 *
 * registryOverride mirrors runMigrations(db, migrations) /
 * openDatabase({ migrations })'s existing pattern (T-260828-07): tests
 * only — production always calls this with no argument, so a test's
 * synthetic (including deliberately broken) channel definitions can never
 * reach a real boot. Exists so index.test.ts can prove the validation and
 * error-envelope behaviour below against a handler that throws or returns
 * the wrong shape, without depending on a real database or app object.
 */
export function registerIpcHandlers(registryOverride: Record<string, ChannelDefinition> = defaultRegistry): void {
  for (const [channel, definition] of Object.entries(registryOverride)) {
    ipcMain.handle(channel, async (_event, rawPayload: unknown): Promise<IpcResult<unknown>> => {
      const parsedRequest = definition.request.safeParse(rawPayload)
      if (!parsedRequest.success) {
        console.error(`[ipc] ${channel}: request payload failed validation —`, parsedRequest.error.message)
        return errResult('invalid-request', `${channel}: the request payload was not in the expected shape.`)
      }

      let handlerResult: unknown
      try {
        handlerResult = await definition.handler(parsedRequest.data)
      } catch (error) {
        console.error(`[ipc] ${channel}: handler threw —`, error)
        return errResult('handler-error', `${channel}: something went wrong handling this request.`)
      }

      const parsedResponse = definition.response.safeParse(handlerResult)
      if (!parsedResponse.success) {
        // A handler returning the wrong shape is a bug in this codebase, not
        // bad input — logged loudly here (main's own console, never the
        // renderer) and surfaced to the caller as a safe, generic envelope.
        console.error(`[ipc] ${channel}: handler response failed validation —`, parsedResponse.error.message)
        return errResult('invalid-response', `${channel}: the response was not in the expected shape.`)
      }

      return okResult(parsedResponse.data)
    })
  }
}
