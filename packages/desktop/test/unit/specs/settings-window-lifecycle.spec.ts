import type Accessor from '../../../src/main/app/accessor'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeEvent {
  (...args: unknown[]): unknown
}

const mocks = vi.hoisted(() => {
  class FakeBrowserWindow {
    static nextId = 100
    static fromWebContents = vi.fn()
    private listeners = new Map<string, Set<FakeEvent>>()

    readonly id: number
    readonly webContents = {
      on: vi.fn(),
      send: vi.fn(),
      toggleDevTools: vi.fn()
    }
    private destroyed = false
    readonly loadURL = vi.fn()
    readonly setSheetOffset = vi.fn()

    constructor(_options: unknown) {
      this.id = FakeBrowserWindow.nextId++
    }

    on(event: string, listener: FakeEvent): this {
      const listeners = this.listeners.get(event) ?? new Set<FakeEvent>()
      listeners.add(listener)
      this.listeners.set(event, listeners)
      return this
    }

    once(event: string, listener: FakeEvent): this {
      const wrapper: FakeEvent = (...args) => {
        this.removeListener(event, wrapper)
        return listener(...args)
      }
      return this.on(event, wrapper)
    }

    emit(event: string, ...args: unknown[]): boolean {
      const listeners = [...(this.listeners.get(event) ?? [])]
      listeners.forEach((listener) => listener(...args))
      return listeners.length > 0
    }

    removeListener(event: string, listener: FakeEvent): this {
      this.listeners.get(event)?.delete(listener)
      return this
    }

    removeAllListeners(event?: string): this {
      if (event) this.listeners.delete(event)
      else this.listeners.clear()
      return this
    }

    listenerCount(event: string): number {
      return this.listeners.get(event)?.size ?? 0
    }

    isDestroyed(): boolean {
      return this.destroyed
    }

    destroy(): void {
      if (this.destroyed) return
      this.destroyed = true
      this.emit('closed')
      this.removeAllListeners()
    }
  }

  return {
    FakeBrowserWindow,
    ipcMain: {
      listeners: new Map<string, (...args: any[]) => unknown>(),
      on: vi.fn((channel: string, listener: (...args: any[]) => unknown) => {
        mocks.ipcMain.listeners.set(channel, listener)
      }),
      emit: vi.fn((channel: string, ...args: any[]) => {
        return mocks.ipcMain.listeners.get(channel)?.(...args)
      })
    },
    app: {
      quit: vi.fn()
    },
    screen: {
      getDisplayNearestPoint: vi.fn(() => ({
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 }
      })),
      getCursorScreenPoint: vi.fn(() => ({ x: 0, y: 0 }))
    },
    shortcut: {
      register: vi.fn(),
      unregister: vi.fn()
    },
    log: {
      error: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.FakeBrowserWindow,
  ipcMain: mocks.ipcMain,
  app: mocks.app,
  screen: mocks.screen,
  net: {},
  protocol: {}
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('@hfelix/electron-localshortcut', () => ({
  electronLocalshortcut: mocks.shortcut
}))
vi.mock('../../../src/main/filesystem/watcher', () => ({
  default: class FakeWatcher {
    unwatchByWindowId = vi.fn()
    close = vi.fn()
  },
  WATCHER_STABILITY_THRESHOLD: 1000,
  WATCHER_STABILITY_POLL_INTERVAL: 150
}))

const { readFileSync } = await import('node:fs')
const { resolve } = await import('node:path')
const { default: WindowManager } = await import('../../../src/main/app/windowManager')
const { default: SettingWindow } = await import('../../../src/main/windows/setting')
const {
  default: BaseWindow,
  WindowLifecycle,
  WindowType
} = await import('../../../src/main/windows/base')

const renderer = resolve(__dirname, '../../../src/renderer/src')
const readRendererFile = (relativePath: string): string =>
  readFileSync(resolve(renderer, relativePath), 'utf8')

interface EditorState {
  document: string
  activeTab: string
}

const createFixture = () => {
  const editorState: EditorState = {
    document: '# editor document',
    activeTab: 'tab-editor'
  }
  const menuEntries = new Map<number, string>()
  let activeMenuWindowId: number | null = null
  const appMenu = {
    has: vi.fn((windowId: number) => menuEntries.has(windowId)),
    addDefaultMenu: vi.fn((windowId: number) => menuEntries.set(windowId, 'editor')),
    addSettingMenu: vi.fn((window: { id: number }) => menuEntries.set(window.id, 'settings')),
    setActiveWindow: vi.fn((windowId: number) => {
      activeMenuWindowId = windowId
    }),
    removeWindowMenu: vi.fn((windowId: number) => menuEntries.delete(windowId)),
    updateAlwaysOnTopMenu: vi.fn()
  }
  const preferences = {
    getStartupPreferences: vi.fn(() => ({
      language: 'en-US',
      followSystemTheme: false,
      lightModeTheme: 'light',
      darkModeTheme: 'dark',
      shortcutStyle: 'default',
      codeFontFamily: 'system-ui',
      codeFontSize: 14,
      hideScrollbar: false,
      theme: 'light',
      titleBarStyle: 'native'
    })),
    getAll: vi.fn(() => ({
      codeFontFamily: 'system-ui',
      codeFontSize: 14,
      hideScrollbar: false,
      theme: 'light',
      titleBarStyle: 'native'
    }))
  }
  const accessor = {
    menu: appMenu,
    env: { debug: true, paths: { userDataPath: 'C:/marktext-user-data' } },
    keybindings: { getAccelerator: vi.fn(() => 'Ctrl+Shift+I') },
    preferences
  }

  const manager = new WindowManager(appMenu, preferences as never, {
    handleClose: vi.fn()
  })
  const editor = new BaseWindow(accessor as unknown as Accessor)
  editor.id = 1
  editor.type = WindowType.EDITOR
  Object.assign(editor, { editorState })
  manager.add(editor)

  const setting = new SettingWindow(accessor as unknown as Accessor)
  const settingBrowserWindow = setting.createWindow()
  manager.add(setting)

  return {
    appMenu,
    editor,
    editorState,
    manager,
    menuEntries,
    setting,
    settingBrowserWindow,
    get activeMenuWindowId() {
      return activeMenuWindowId
    }
  }
}

describe('settings window lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcMain.listeners.clear()
    mocks.FakeBrowserWindow.nextId = 100
  })

  it('releases the settings wrapper, shortcut and menu while preserving editor state', () => {
    const fixture = createFixture()
    const originalEditorState = { ...fixture.editorState }

    expect(fixture.manager.get(fixture.setting.id)).toBe(fixture.setting)
    expect(fixture.menuEntries.get(fixture.settingBrowserWindow.id)).toBe('settings')
    expect(mocks.shortcut.register).toHaveBeenCalledWith(
      fixture.settingBrowserWindow,
      'Ctrl+Shift+I',
      expect.any(Function)
    )

    expect(fixture.manager.forceClose(fixture.settingBrowserWindow)).toBe(true)

    expect(fixture.manager.get(fixture.settingBrowserWindow.id)).toBeUndefined()
    expect(fixture.manager.getActiveEditorId()).toBe(1)
    expect(fixture.activeMenuWindowId).toBe(1)
    expect(fixture.menuEntries.get(1)).toBe('editor')
    expect(fixture.menuEntries.has(fixture.settingBrowserWindow.id)).toBe(false)
    expect(fixture.appMenu.removeWindowMenu).toHaveBeenCalledWith(fixture.settingBrowserWindow.id)
    expect(mocks.shortcut.unregister).toHaveBeenCalledWith(
      fixture.settingBrowserWindow,
      'Ctrl+Shift+I'
    )

    expect(fixture.editorState).toEqual(originalEditorState)
    expect(fixture.editor.listenerCount('window-focus')).toBe(1)
    expect(fixture.setting.id).toBeNull()
    expect(fixture.setting.browserWindow).toBeNull()
    expect(fixture.setting.lifecycle).toBe(WindowLifecycle.QUITTED)
    expect(fixture.setting.eventNames()).toEqual([])
  })

  it('routes the native close event through the guarded close IPC path', () => {
    const fixture = createFixture()
    const event = { preventDefault: vi.fn() }

    fixture.settingBrowserWindow.emit('close', event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith(
      'window-close-by-id',
      fixture.settingBrowserWindow.id
    )
    expect(fixture.manager.get(fixture.settingBrowserWindow.id)).toBeUndefined()
    expect(fixture.manager.getActiveEditorId()).toBe(1)
    expect(fixture.editorState).toEqual({
      document: '# editor document',
      activeTab: 'tab-editor'
    })
    expect(fixture.setting.lifecycle).toBe(WindowLifecycle.QUITTED)
  })

  it('removes browser-window listeners so a late settings event cannot change editor state', () => {
    const fixture = createFixture()

    expect(fixture.settingBrowserWindow.listenerCount('focus')).toBe(1)
    expect(fixture.settingBrowserWindow.listenerCount('blur')).toBe(1)
    expect(fixture.settingBrowserWindow.listenerCount('close')).toBe(1)

    expect(fixture.manager.forceClose(fixture.settingBrowserWindow)).toBe(true)

    expect(fixture.settingBrowserWindow.listenerCount('focus')).toBe(0)
    expect(fixture.settingBrowserWindow.listenerCount('blur')).toBe(0)
    expect(fixture.settingBrowserWindow.listenerCount('close')).toBe(0)
    expect(fixture.manager.getActiveEditorId()).toBe(1)
    expect(fixture.activeMenuWindowId).toBe(1)
    expect(fixture.menuEntries.get(1)).toBe('editor')
    expect(fixture.editorState).toEqual({
      document: '# editor document',
      activeTab: 'tab-editor'
    })

    // A stale native event after close must be inert and must not resurrect the
    // settings menu or affect the editor window's active state.
    fixture.settingBrowserWindow.emit('focus')
    fixture.settingBrowserWindow.emit('blur')
    expect(fixture.manager.getActiveEditorId()).toBe(1)
    expect(fixture.activeMenuWindowId).toBe(1)
    expect(fixture.menuEntries.get(1)).toBe('editor')
  })

  it('documents disposable settings-page listeners and component ownership', () => {
    const preferencePage = readRendererFile('pages/preference.vue')
    const settingsSidebar = readRendererFile('prefComponents/sideBar/index.vue')
    const keybindingsPage = readRendererFile('prefComponents/keybindings/index.vue')
    const uploader = readRendererFile('prefComponents/image/components/uploader/index.vue')

    expect(preferencePage).toContain('<router-view class="pref-setting" />')
    expect(settingsSidebar).toContain('onUnmounted(() => {')
    expect(settingsSidebar).toContain('window.removeEventListener')
    expect(settingsSidebar).toContain('stopLanguageChangeListener?.()')
    expect(keybindingsPage).toContain('onUnmounted(() => {')
    expect(uploader).toContain("document.removeEventListener('visibilitychange'")
  })
})
