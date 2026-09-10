import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const appSource = readFileSync(resolve(__dirname, '../../../src/main/app/index.ts'), 'utf8')

describe('startup open-request queue', () => {
  it('buffers macOS open-file requests before readiness and flushes them after the first window', () => {
    expect(appSource).toContain("app.on('open-file', this.openFile)")
    expect(appSource).toContain('this._pendingOpenRequests.enqueue([info as PathInfo])')
    expect(appSource).toContain("this._startupState === 'not-started' && app.isReady()")
    expect(appSource).toContain("this._startupState !== 'ready'")
    expect(appSource).toContain('this._windowManager.windowCount === 0')
    expect(appSource).toContain('this._ensureFirstWindowAndFlush()')
    expect(appSource).toContain('this._schedulePendingOpenRequestFlush()')
  })

  it('preserves second-instance request ordering and new-window intent', () => {
    expect(appSource).toContain("const openFilesInSameWindow = !!args['--new-window']")
    expect(appSource).toContain('this._pendingOpenRequests.enqueue(buf, openFilesInSameWindow)')
    expect(appSource).toContain('for (const request of this._pendingOpenRequests.drain())')
    expect(appSource).toContain('this._openPathList(request.paths, request.openFilesInSameWindow)')
  })

  it('does not restore a previous session over explicit startup files', () => {
    expect(appSource).toContain('if (args._.length)')
    expect(appSource).toContain(
      'if (_openFilesCache.length === 0 && this._pendingOpenRequests.size === 0)'
    )
    expect(appSource).toContain('this._isRestorePathway = true')
  })

  it('serializes first-window recreation across activate and queued requests', () => {
    expect(appSource).toContain(
      'if (this._windowCreationPromise) return this._windowCreationPromise'
    )
    expect(appSource).toContain("app.on('activate', () => {")
    expect(appSource).toContain("if (this._startupState === 'ready') {")
    expect(appSource).toContain('void this._createFirstWindow(false)')
    expect(appSource).toContain('.then(() => this._flushPendingOpenRequests())')
  })
})
