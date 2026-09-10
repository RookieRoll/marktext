import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mainSource = readFileSync(resolve(__dirname, '../../../src/main/index.ts'), 'utf8')
const preloadSource = readFileSync(resolve(__dirname, '../../../src/preload/index.ts'), 'utf8')
const ipcSource = readFileSync(resolve(__dirname, '../../../src/main/ipc/index.ts'), 'utf8')

describe('early startup IPC registration', () => {
  it('registers sandbox IPC before constructing the application controller', () => {
    const registration = mainSource.indexOf('registerSandboxIpcHandlers()')
    const accessor = mainSource.indexOf('accessor = new Accessor')
    expect(registration).toBeGreaterThanOrEqual(0)
    expect(accessor).toBeGreaterThan(registration)
  })

  it('keeps the synchronous boot handshake at the beginning of preload execution', () => {
    const handshake = preloadSource.indexOf("ipcRenderer.sendSync('mt::boot-info')")
    const bridge = preloadSource.indexOf('const ipcWrapper = {')
    expect(handshake).toBeGreaterThanOrEqual(0)
    expect(bridge).toBeGreaterThan(handshake)
  })

  it('registers boot, async boot, and performance handlers in the early IPC set', () => {
    expect(ipcSource).toContain('registerBootInfo()')
    expect(ipcSource).toContain('registerPerformanceHandlers()')
    expect(readFileSync(resolve(__dirname, '../../../src/main/ipc/bootInfo.ts'), 'utf8')).toContain(
      "ipcMain.handle('mt::boot-info-async'"
    )
    expect(
      readFileSync(resolve(__dirname, '../../../src/main/ipc/performance.ts'), 'utf8')
    ).toContain("ipcMain.on('mt::performance-mark'")
  })
})
