import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererIpcEvent } from '../../../src/main/ipc/rendererSender'

type RegisteredHandler = (...args: any[]) => any

type AppHarness = {
  _accessor: any
  _windowManager: any
  _listenForIpcMain: () => void
  _openSettingsWindow: ReturnType<typeof vi.fn>
  _applyShortcutStyle: ReturnType<typeof vi.fn>
  _getKeybindingPreferences: ReturnType<typeof vi.fn>
  _createEditorWindow: ReturnType<typeof vi.fn>
  _broadcastKeybindings: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredHandler>()
  const handles = new Map<string, RegisteredHandler>()
  const internalHandlers = new Map<string, RegisteredHandler>()

  return {
    listeners,
    handles,
    internalHandlers,
    app: {
      quit: vi.fn()
    },
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      on: vi.fn((channel: string, handler: RegisteredHandler) => {
        listeners.set(channel, handler)
      }),
      handle: vi.fn((channel: string, handler: RegisteredHandler) => {
        handles.set(channel, handler)
      }),
      emit: vi.fn()
    },
    dialog: {
      showOpenDialog: vi.fn()
    },
    shell: {
      trashItem: vi.fn()
    },
    nativeTheme: {
      shouldUseDarkColors: false
    },
    normalizeAndResolvePath: vi.fn((filePath: string) => `/resolved/${filePath}`),
    normalizeShortcutStyle: vi.fn((style: unknown) => `normalized:${String(style)}`),
    isUserKeybindings: vi.fn(() => true),
    registerKeyboardListeners: vi.fn(),
    registerSpellcheckerListeners: vi.fn(),
    onInternalChannel: vi.fn((channel: string, handler: RegisteredHandler) => {
      internalHandlers.set(channel, handler)
    }),
    openSettings: vi.fn(),
    setLanguage: vi.fn(),
    setNativeThemeSource: vi.fn(),
    selectTheme: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  clipboard: {},
  dialog: mocks.dialog,
  nativeTheme: mocks.nativeTheme,
  shell: mocks.shell,
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('common/filesystem/paths', () => ({ isChildOfDirectory: vi.fn() }))
vi.mock('../../../src/main/config', () => ({ isLinux: false, isOsx: false, isWindows: true }))
vi.mock('../../../src/main/cli/parser', () => ({ default: vi.fn() }))
vi.mock('../../../src/main/filesystem', () => ({
  normalizeAndResolvePath: mocks.normalizeAndResolvePath
}))
vi.mock('../../../src/main/filesystem/markdown', () => ({ normalizeMarkdownPath: vi.fn() }))
vi.mock('../../../src/main/keyboard', () => ({
  registerKeyboardListeners: mocks.registerKeyboardListeners
}))
vi.mock('../../../src/main/keyboard/shortcutStyles', () => ({
  normalizeShortcutStyle: mocks.normalizeShortcutStyle
}))
vi.mock('@shared/types/keybindings', () => ({
  isUserKeybindings: mocks.isUserKeybindings
}))
vi.mock('../../../src/main/menu/actions/theme', () => ({ selectTheme: mocks.selectTheme }))
vi.mock('../../../src/main/menu/templates', () => ({ dockMenu: {} }))
vi.mock('../../../src/main/spellchecker', () => ({
  default: mocks.registerSpellcheckerListeners
}))
vi.mock('../../../src/main/utils/imagePathAutoComplement', () => ({ watchers: new Map() }))
vi.mock('../../../src/main/utils/internalIpc', () => ({
  onInternalChannel: mocks.onInternalChannel
}))
vi.mock('../../../src/main/windows/base', () => ({
  WindowType: { EDITOR: 'editor', SETTINGS: 'settings' }
}))
vi.mock('../../../src/main/windows/editor', () => ({ default: class EditorWindow {} }))
vi.mock('../../../src/main/windows/setting', () => ({ default: class SettingWindow {} }))
vi.mock('../../../src/main/i18n', () => ({ setLanguage: mocks.setLanguage }))
vi.mock('../../../src/main/app/nativeTheme', () => ({
  getNativeThemeSource: mocks.setNativeThemeSource,
  isDarkApplicationTheme: vi.fn(() => false)
}))

import App from '../../../src/main/app'

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = {
    id: 11,
    webContents: { send: vi.fn() }
  } as unknown as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame } as RendererIpcEvent,
    childFrameEvent: { sender, senderFrame: childFrame } as RendererIpcEvent,
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame } as RendererIpcEvent,
    sender,
    window
  }
}

const createApp = (events: ReturnType<typeof createEvents>): AppHarness => {
  const editor = {
    openTab: vi.fn()
  }
  const preferences = {
    getAll: vi.fn(() => ({ defaultDirectoryToOpen: '/default' })),
    getItem: vi.fn((key: string) => (key === 'openFilesInNewWindow' ? false : undefined)),
    setItems: vi.fn(),
    setItem: vi.fn()
  }
  const keybindings = {
    keys: [['file.save', 'Ctrl+S']],
    openConfigInFileManager: vi.fn(),
    getDefaultKeybindings: vi.fn(() => ({ 'file.save': 'Ctrl+S' })),
    getUserKeybindings: vi.fn(() => ({ 'file.save': 'Ctrl+Shift+S' })),
    getShortcutStyle: vi.fn(() => 'auto'),
    setUserKeybindings: vi.fn(async () => ({ saved: true }))
  }
  const menu = {
    updateKeybindings: vi.fn()
  }
  const windowManager = {
    get: vi.fn((windowId: number) => (windowId === events.window.id ? editor : undefined)),
    getWindowsByType: vi.fn(() => [{ win: { browserWindow: events.window } }])
  }
  const appInstance = Object.create(App.prototype) as AppHarness

  appInstance._accessor = { preferences, keybindings, menu }
  appInstance._windowManager = windowManager
  appInstance._openSettingsWindow = vi.fn()
  appInstance._applyShortcutStyle = vi.fn()
  appInstance._getKeybindingPreferences = vi.fn(() => ({ shortcutStyle: 'auto' }))
  appInstance._createEditorWindow = vi.fn()
  appInstance._broadcastKeybindings = vi.fn()
  appInstance._listenForIpcMain()
  const registeredListenerCount = mocks.listeners.size
  const registeredHandlerCount = mocks.handles.size
  const registeredInternalHandlerCount = mocks.internalHandlers.size

  appInstance._listenForIpcMain()

  expect(mocks.registerKeyboardListeners).toHaveBeenCalledOnce()
  expect(mocks.registerSpellcheckerListeners).toHaveBeenCalledOnce()
  expect(mocks.listeners.size).toBe(registeredListenerCount)
  expect(mocks.handles.size).toBe(registeredHandlerCount)
  expect(mocks.internalHandlers.size).toBe(registeredInternalHandlerCount)

  return appInstance
}

describe('app renderer IPC sender guard', () => {
  let events: ReturnType<typeof createEvents>
  let appInstance: AppHarness

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
    mocks.handles.clear()
    mocks.internalHandlers.clear()
    events = createEvents()
    mocks.BrowserWindow.fromWebContents.mockImplementation((sender: WebContents) =>
      sender === events.sender ? events.window : null
    )
    mocks.dialog.showOpenDialog.mockResolvedValue({ filePaths: ['/chosen'], canceled: false })
    mocks.shell.trashItem.mockResolvedValue(undefined)
    appInstance = createApp(events)
  })

  it('registers all requested renderer-facing handlers', () => {
    expect([...mocks.listeners.keys()]).toEqual(
      expect.arrayContaining([
        'mt::app-try-quit',
        'mt::open-file-by-window-id',
        'mt::select-default-directory-to-open',
        'mt::open-setting-window',
        'mt::make-screenshot',
        'mt::request-keybindings',
        'mt::open-keybindings-config'
      ])
    )
    expect([...mocks.handles.keys()]).toEqual(
      expect.arrayContaining([
        'mt::keybinding-get-pref-keybindings',
        'mt::keybinding-set-style',
        'mt::keybinding-save-user-keybindings',
        'mt::fs-trash-item'
      ])
    )
  })

  it('fails closed for unknown senders and child frames before renderer side effects', async () => {
    const fireAndForget = [
      ['mt::app-try-quit', 123, 'note.md'],
      ['mt::open-file-by-window-id', 999, 'note.md'],
      ['mt::select-default-directory-to-open'],
      ['mt::open-setting-window'],
      ['mt::make-screenshot'],
      ['mt::request-keybindings'],
      ['mt::open-keybindings-config']
    ] as const

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const [channel, ...args] of fireAndForget) {
        const handler = mocks.listeners.get(channel)
        expect(handler).toBeDefined()
        await handler!(event, ...args)
      }

      expect(mocks.app.quit).not.toHaveBeenCalled()
      expect(mocks.dialog.showOpenDialog).not.toHaveBeenCalled()
      expect(mocks.ipcMain.emit).not.toHaveBeenCalledWith('screen-capture', expect.anything())
      expect(events.window.webContents.send).not.toHaveBeenCalled()
      expect(appInstance._openSettingsWindow).not.toHaveBeenCalled()
      expect(appInstance._windowManager.get).not.toHaveBeenCalled()
      expect(appInstance._accessor.keybindings.openConfigInFileManager).not.toHaveBeenCalled()
    }

    const invokeArgs = {
      'mt::keybinding-get-pref-keybindings': [],
      'mt::keybinding-set-style': ['legacy'],
      'mt::keybinding-save-user-keybindings': [{ bindings: {} }],
      'mt::fs-trash-item': ['/tmp/note.md']
    } as const

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const [channel, args] of Object.entries(invokeArgs)) {
        const handler = mocks.handles.get(channel)
        expect(handler).toBeDefined()
        await expect(Promise.resolve().then(() => handler!(event, ...args))).rejects.toThrow(
          'Rejected IPC sender'
        )
      }
    }

    expect(mocks.shell.trashItem).not.toHaveBeenCalled()
    expect(appInstance._getKeybindingPreferences).not.toHaveBeenCalled()
  })

  it('preserves valid behavior and binds windowId operations to the sending window', async () => {
    const quit = mocks.listeners.get('mt::app-try-quit')!
    quit(events.mainFrameEvent)
    expect(mocks.app.quit).toHaveBeenCalledOnce()

    const openFile = mocks.listeners.get('mt::open-file-by-window-id')!
    openFile(events.mainFrameEvent, 999, 'note.md')
    expect(mocks.normalizeAndResolvePath).toHaveBeenCalledWith('note.md')
    expect(appInstance._windowManager.get).toHaveBeenCalledWith(events.window.id)

    const editor = appInstance._windowManager.get.mock.results[0].value
    expect(editor.openTab).toHaveBeenCalledWith('/resolved/note.md', {}, true)

    const selectDirectory = mocks.listeners.get('mt::select-default-directory-to-open')!
    await selectDirectory(events.mainFrameEvent)
    expect(mocks.dialog.showOpenDialog).toHaveBeenCalledWith(
      events.window,
      expect.objectContaining({
        defaultPath: '/default',
        properties: ['openDirectory', 'createDirectory']
      })
    )
    expect(appInstance._accessor.preferences.setItems).toHaveBeenCalledWith({
      defaultDirectoryToOpen: '/chosen'
    })

    const openSettings = mocks.listeners.get('mt::open-setting-window')!
    openSettings(events.mainFrameEvent)
    expect(appInstance._openSettingsWindow).toHaveBeenCalledOnce()

    const makeScreenshot = mocks.listeners.get('mt::make-screenshot')!
    makeScreenshot(events.mainFrameEvent)
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith('screen-capture', events.window)

    const requestKeybindings = mocks.listeners.get('mt::request-keybindings')!
    requestKeybindings(events.mainFrameEvent)
    expect(events.window.webContents.send).toHaveBeenCalledWith('mt::keybindings-response', {
      'file.save': 'Ctrl+S'
    })

    const openKeybindingsConfig = mocks.listeners.get('mt::open-keybindings-config')!
    openKeybindingsConfig(events.mainFrameEvent)
    expect(appInstance._accessor.keybindings.openConfigInFileManager).toHaveBeenCalledOnce()
  })

  it('preserves valid keybinding invokes and protects the trash-item operation', async () => {
    const getPreferences = mocks.handles.get('mt::keybinding-get-pref-keybindings')!
    expect(getPreferences(events.mainFrameEvent)).toEqual({ shortcutStyle: 'auto' })
    expect(appInstance._getKeybindingPreferences).toHaveBeenCalledOnce()

    const setStyle = mocks.handles.get('mt::keybinding-set-style')!
    expect(setStyle(events.mainFrameEvent, 'legacy')).toEqual({
      shortcutStyle: 'auto'
    })
    expect(mocks.normalizeShortcutStyle).toHaveBeenCalledWith('legacy')
    expect(appInstance._accessor.preferences.setItem).toHaveBeenCalledWith(
      'shortcutStyle',
      'normalized:legacy'
    )
    expect(appInstance._applyShortcutStyle).toHaveBeenCalledWith('normalized:legacy')

    const saveKeybindings = mocks.handles.get('mt::keybinding-save-user-keybindings')!
    await expect(saveKeybindings(events.mainFrameEvent, { bindings: {} })).resolves.toEqual({
      saved: true
    })
    expect(appInstance._accessor.keybindings.setUserKeybindings).toHaveBeenCalledWith(
      { bindings: {} },
      [events.window]
    )
    expect(appInstance._accessor.menu.updateKeybindings).toHaveBeenCalledOnce()
    expect(appInstance._broadcastKeybindings).toHaveBeenCalledWith([events.window])

    const trashItem = mocks.handles.get('mt::fs-trash-item')!
    await expect(trashItem(events.mainFrameEvent, '/tmp/note.md')).resolves.toBeUndefined()
    expect(mocks.shell.trashItem).toHaveBeenCalledWith('/tmp/note.md')
  })
})
