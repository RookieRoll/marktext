import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredListener = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredListener>()
  return {
    listeners,
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      on: vi.fn((channel: string, listener: RegisteredListener) => {
        listeners.set(channel, listener)
      })
    },
    app: {
      quit: vi.fn()
    },
    log: {
      error: vi.fn()
    },
    onInternalChannel: vi.fn()
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain,
  app: mocks.app
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('../../../src/main/filesystem/watcher', () => ({
  default: vi.fn(),
  WATCHER_STABILITY_THRESHOLD: 1000,
  WATCHER_STABILITY_POLL_INTERVAL: 150
}))
vi.mock('../../../src/main/utils/internalIpc', () => ({
  onInternalChannel: mocks.onInternalChannel
}))
vi.mock('../../../src/main/windows/base', () => ({
  WindowType: {
    BASE: 'base',
    EDITOR: 'editor',
    SETTINGS: 'settings'
  },
  default: class {}
}))

import WindowManager from '../../../src/main/app/windowManager'

const rendererChannels = [
  'mt::window-add-file-path',
  'mt::close-window',
  'mt::open-file',
  'mt::window-tab-closed',
  'mt::window-toggle-always-on-top'
] as const

const createFixture = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const browserWindow = {
    id: 7,
    restoreBufferId: 'restore-7',
    isAlwaysOnTop: vi.fn(() => false),
    setAlwaysOnTop: vi.fn()
  } as unknown as BrowserWindow
  const editor = {
    id: browserWindow.id,
    type: 'editor',
    addToOpenedFiles: vi.fn(),
    openTab: vi.fn(),
    removeFromOpenedFiles: vi.fn()
  }
  const appMenu = {
    updateAlwaysOnTopMenu: vi.fn()
  }
  const editorBufferStore = {
    handleClose: vi.fn()
  }
  const manager = Object.create(WindowManager.prototype) as WindowManager

  Object.assign(manager, {
    _appMenu: appMenu,
    _windows: new Map([[browserWindow.id, editor]]),
    editorBufferStore
  })
  manager.forceClose = vi.fn(() => true)

  mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
    candidate === sender ? browserWindow : null
  )
  ;(manager as unknown as { _listenForIpcMain: () => void })._listenForIpcMain()

  return {
    appMenu,
    browserWindow,
    childFrameEvent: { sender, senderFrame: childFrame },
    editor,
    editorBufferStore,
    mainFrameEvent: { sender, senderFrame: mainFrame },
    manager,
    sender,
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame }
  }
}

describe('WindowManager renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listeners.clear()
  })

  it('registers the high-risk renderer IPC handlers', () => {
    createFixture()

    expect([...mocks.listeners.keys()]).toEqual(expect.arrayContaining([...rendererChannels]))
  })

  it('no-ops invalid senders and child frames for every high-risk handler', () => {
    const fixture = createFixture()
    const events = [fixture.unknownEvent, fixture.childFrameEvent]

    for (const event of events) {
      mocks.listeners.get('mt::window-add-file-path')!(event, '/tmp/opened.md')
      mocks.listeners.get('mt::close-window')!(event)
      mocks.listeners.get('mt::open-file')!(event, '/tmp/open.md', { fromRecent: true })
      mocks.listeners.get('mt::window-tab-closed')!(event, '/tmp/closed.md')
      mocks.listeners.get('mt::window-toggle-always-on-top')!(event)
    }

    expect(fixture.editor.addToOpenedFiles).not.toHaveBeenCalled()
    expect(fixture.editor.openTab).not.toHaveBeenCalled()
    expect(fixture.editor.removeFromOpenedFiles).not.toHaveBeenCalled()
    expect(fixture.editorBufferStore.handleClose).not.toHaveBeenCalled()
    expect(fixture.manager.forceClose).not.toHaveBeenCalled()
    expect(fixture.browserWindow.isAlwaysOnTop).not.toHaveBeenCalled()
    expect(fixture.browserWindow.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(fixture.appMenu.updateAlwaysOnTopMenu).not.toHaveBeenCalled()
  })

  it('preserves valid main-frame behavior for file and window operations', () => {
    const fixture = createFixture()
    const options = { fromRecent: true }

    mocks.listeners.get('mt::window-add-file-path')!(fixture.mainFrameEvent, '/tmp/opened.md')
    mocks.listeners.get('mt::open-file')!(fixture.mainFrameEvent, '/tmp/open.md', options)
    mocks.listeners.get('mt::window-tab-closed')!(fixture.mainFrameEvent, '/tmp/closed.md')
    mocks.listeners.get('mt::window-toggle-always-on-top')!(fixture.mainFrameEvent)
    mocks.listeners.get('mt::close-window')!(fixture.mainFrameEvent)

    expect(fixture.editor.addToOpenedFiles).toHaveBeenCalledWith('/tmp/opened.md')
    expect(fixture.editor.openTab).toHaveBeenCalledWith('/tmp/open.md', options, true)
    expect(fixture.editor.removeFromOpenedFiles).toHaveBeenCalledWith('/tmp/closed.md')
    expect(fixture.browserWindow.isAlwaysOnTop).toHaveBeenCalledTimes(1)
    expect(fixture.browserWindow.setAlwaysOnTop).toHaveBeenCalledWith(true)
    expect(fixture.appMenu.updateAlwaysOnTopMenu).toHaveBeenCalledWith(7, true)
    expect(fixture.editorBufferStore.handleClose).toHaveBeenCalledWith('restore-7', [
      { id: 7, win: fixture.editor }
    ])
    expect(fixture.manager.forceClose).toHaveBeenCalledWith(fixture.browserWindow)
  })

  it('keeps close-window safe when the sender no longer resolves to a window', () => {
    const fixture = createFixture()
    mocks.BrowserWindow.fromWebContents.mockReturnValue(null)

    expect(() => mocks.listeners.get('mt::close-window')!(fixture.mainFrameEvent)).not.toThrow()
    expect(fixture.editorBufferStore.handleClose).not.toHaveBeenCalled()
    expect(fixture.manager.forceClose).not.toHaveBeenCalled()
  })
})
