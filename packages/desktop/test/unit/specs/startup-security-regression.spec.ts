import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../../../src')
const read = (relativePath: string): string => readFileSync(resolve(root, relativePath), 'utf8')

describe('startup security boundary', () => {
  it('registers the boot handshake and sandbox IPC before App construction', () => {
    const main = read('main/index.ts')
    expect(main.indexOf('registerSandboxIpcHandlers()')).toBeGreaterThanOrEqual(0)
    expect(main.indexOf('registerSandboxIpcHandlers()')).toBeLessThan(
      main.indexOf('accessor = new Accessor')
    )
    expect(read('main/ipc/bootInfo.ts')).toContain("ipcMain.on('mt::boot-info'")
    expect(read('main/ipc/bootInfo.ts')).toContain("ipcMain.handle('mt::boot-info-async'")
  })

  it('keeps trusted sender checks on renderer-facing privileged handlers', () => {
    const app = read('main/app/index.ts')
    const windowManager = read('main/app/windowManager.ts')
    expect(app).toContain('createRendererSenderGuard')
    expect(app).toContain('rendererSenderGuard.getWindow(event)')
    expect(app).toContain('rendererSenderGuard.assertTrustedRenderer(event)')
    expect(windowManager).toContain('createRendererSenderGuard')
    expect(windowManager).toContain('rendererSenderGuard.getWindow(e)')
  })

  it('keeps navigation, webview, and window.open denied independently of deferred services', () => {
    const security = read('main/app/webSecurity.ts')
    expect(security).toContain("'will-attach-webview'")
    expect(security).toContain("'will-navigate'")
    expect(security).toContain('setWindowOpenHandler')
    expect(security).toContain("action: 'deny'")
  })

  it('keeps the sidebar tree/content optimization inside the existing IPC boundary', () => {
    // The metadata snapshot is delivered on the pre-existing object-tree
    // channel; the renderer gains no new fs/channel capability from the
    // optimization slice.
    const preload = read('preload/index.ts')
    const watcher = read('main/filesystem/watcher.ts')
    const project = read('renderer/src/store/project.ts')

    expect(watcher).toContain("'mt::update-object-tree'")
    expect(project).toContain("getIpcRenderer().on('mt::update-object-tree'")
    // The only renderer-initiated open path stays the validated main-side handler.
    expect(project).not.toContain('mt::fs-read')
    expect(project).not.toContain("require('fs')")
    expect(preload).not.toContain("'mt::fs-read'")
  })

  it('does not defer registration of the early performance send handler', () => {
    const ipc = read('main/ipc/index.ts')
    const performance = read('main/ipc/performance.ts')
    expect(ipc).toContain('registerPerformanceHandlers()')
    expect(performance).toContain("ipcMain.on('mt::performance-mark'")
  })
})
