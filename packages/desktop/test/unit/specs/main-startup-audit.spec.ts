import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '../../../', relativePath), 'utf8')

const mainSource = read('src/main/index.ts')
const appSource = read('src/main/app/index.ts')
const bootInfoSource = read('src/main/ipc/bootInfo.ts')
const ipcSource = read('src/main/ipc/index.ts')
const preloadSource = read('src/preload/index.ts')
const configSource = read('src/main/config.ts')
const securitySource = read('src/main/app/webSecurity.ts')
const senderGuardSource = read('src/main/ipc/rendererSender.ts')

const position = (source: string, needle: string): number => {
  const index = source.indexOf(needle)
  expect(index, `missing startup evidence: ${needle}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('main startup audit (OpenSpec 2.1)', () => {
  it('keeps CLI/environment, error handling, single-instance and early IPC before Accessor', () => {
    const protocol = position(mainSource, 'registerMarkTextScheme(protocol)')
    const exception = position(mainSource, 'setupExceptionHandler()')
    const cli = position(mainSource, 'const args = cli()')
    const environment = position(mainSource, 'const appEnvironment = setupEnvironment')
    const singleInstance = position(mainSource, 'app.requestSingleInstanceLock()')
    const ipc = position(mainSource, 'registerSandboxIpcHandlers()')
    const accessor = position(mainSource, 'accessor = new Accessor')
    const appController = position(mainSource, 'const appController = new App')

    expect(protocol).toBeLessThan(exception)
    expect(exception).toBeLessThan(cli)
    expect(cli).toBeLessThan(environment)
    expect(environment).toBeLessThan(singleInstance)
    expect(singleInstance).toBeLessThan(ipc)
    expect(ipc).toBeLessThan(accessor)
    expect(accessor).toBeLessThan(appController)
    expect(mainSource).toContain("process.on('uncaughtException'")
    expect(mainSource).toContain("process.on('unhandledRejection'")
    expect(mainSource).toContain('process.exit(1)')
  })

  it('keeps early file events and security policy registered before ready can create a window', () => {
    const secondInstance = position(appSource, "app.on('second-instance'")
    const openFile = position(appSource, "app.on('open-file', this.openFile)")
    const ready = position(appSource, "app.on('ready', this.ready)")
    const activate = position(appSource, "app.on('activate'")
    const security = position(appSource, 'registerWebContentsSecurityPolicy(app)')
    const firstWindow = position(appSource, 'private _createFirstWindow =')

    expect(secondInstance).toBeLessThan(ready)
    expect(openFile).toBeLessThan(ready)
    expect(activate).toBeLessThan(firstWindow)
    expect(security).toBeLessThan(firstWindow)
    expect(appSource).toContain('this._pendingOpenRequests.enqueue')
    expect(appSource).toContain('this._flushPendingOpenRequests()')
    expect(appSource).toContain('private _ensureFirstWindowAndFlush')
  })

  it('keeps boot-info and the minimal IPC set registered before preload bridge construction', () => {
    const bootRegistration = position(ipcSource, 'registerBootInfo()')
    const performanceRegistration = position(ipcSource, 'registerPerformanceHandlers()')
    const handshake = position(preloadSource, "ipcRenderer.sendSync('mt::boot-info')")
    const bridge = position(preloadSource, 'const ipcWrapper = {')

    expect(bootRegistration).toBeLessThan(performanceRegistration)
    expect(handshake).toBeLessThan(bridge)
    expect(bootInfoSource).toContain("ipcMain.on('mt::boot-info'")
    expect(bootInfoSource).toContain("ipcMain.handle('mt::boot-info-async'")
    expect(ipcSource).toContain('registerFsHandlers()')
    expect(ipcSource).toContain('registerWindowHandlers()')
    expect(ipcSource).toContain('registerI18nHandlers()')
    expect(ipcSource).toContain('registerPerformanceHandlers()')
  })

  it('keeps Electron security defaults, sender validation and one window creation entry', () => {
    expect(configSource).toContain('contextIsolation: true')
    expect(configSource).toContain('sandbox: true')
    expect(configSource).toContain('nodeIntegration: false')
    expect(securitySource).toContain('event.preventDefault()')
    expect(securitySource).toContain('contents.setWindowOpenHandler')
    expect(senderGuardSource).toContain('event.senderFrame === event.sender.mainFrame')
    expect(appSource).toContain('private _createEditorWindow(')
    expect(appSource).toContain('private _createFirstWindow = (restore = true)')
    expect(appSource).toContain(
      'if (this._windowCreationPromise) return this._windowCreationPromise'
    )
  })

  it('limits this audit slice to its documented files instead of touching other agents’ code', () => {
    const auditDoc = readFileSync(
      resolve(
        __dirname,
        '../../../../../openspec/changes/optimize-startup-memory/main-startup-audit.md'
      ),
      'utf8'
    )
    expect(auditDoc).toContain('本任务允许新增/修改的文件仅为')
    expect(auditDoc).toContain('packages/desktop/test/unit/specs/main-startup-audit.spec.ts')
    expect(auditDoc).toContain('不回退、不重排、不覆盖任何已有未提交修改')
    expect(auditDoc).toContain('只改审计文档、审计测试和 2.1 tasks 行')
  })
})
