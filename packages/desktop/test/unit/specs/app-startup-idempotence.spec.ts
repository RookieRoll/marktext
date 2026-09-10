import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(__dirname, '../../../src/main/app/index.ts'), 'utf8')

describe('main startup idempotence', () => {
  it('routes second-instance, activate, and open-file window recreation through one helper', () => {
    expect(appSource).toContain('private _ensureFirstWindowAndFlush = (): void => {')
    expect(appSource).toContain('this._ensureFirstWindowAndFlush()')
    expect(appSource).toContain("app.on('activate', () => {")
    expect(appSource).toContain("if (this._startupState === 'ready') {")
  })

  it('shares the first-window creation promise and flushes pending requests after completion', () => {
    expect(appSource).toContain(
      'if (this._windowCreationPromise) return this._windowCreationPromise'
    )
    expect(appSource).toContain('void this._createFirstWindow(false)')
    expect(appSource).toContain('.then(() => this._flushPendingOpenRequests())')
    expect(appSource).toContain(
      ".catch((error) => log.error('Unable to recreate the first window:', error))"
    )
  })

  it('guards initialization and ignores requests while quitting', () => {
    expect(appSource).toContain('if (this._initialized) return')
    expect(appSource).toContain('const startupAbortController = new AbortController()')
    expect(appSource).toContain('startupAbortController.signal')
    expect(appSource).toContain('this._startupAbortController?.abort()')
    expect(appSource).toContain('private _ipcListenersRegistered = false')
    expect(appSource).toContain('if (this._ipcListenersRegistered) return')
    expect(appSource).toContain(
      "if (this._isQuitting || this._startupState !== 'not-started') return"
    )
    expect(appSource).toContain('this._cancelDeferredStartupTasks()')
    expect(appSource).toContain('this._pendingOpenRequests.drain()')
    expect(appSource).toContain(
      'if (this._windowManager.windowCount === 0) this._removeFirstWindowListeners()'
    )
    expect(appSource).toContain('private _removeFirstWindowListeners(): void {')
    expect(appSource).toContain(
      'void this._createFirstWindow(false)\n      .then(() => this._flushPendingOpenRequests())\n      .catch'
    )
  })
})
