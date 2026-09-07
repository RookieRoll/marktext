import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCommandExistsBridge,
  getElectronPaths,
  getFontsBridge,
  getIpcRenderer,
  getProcessBridge,
  getProcessPlatform,
  getShellBridge,
  hasElectronBridge
} from '@/platform/electron'
import {
  getCurrentWindowId,
  getDocumentDirectory,
  getInitialState,
  getWindowType,
  setDocumentDirectory
} from '@/platform/runtime'

const win = window as unknown as {
  electron?: Window['electron']
  commandExists?: Window['commandExists']
  fonts?: Window['fonts']
  marktext?: Window['marktext']
  DIRNAME?: string
}

describe('renderer platform facades', () => {
  beforeEach(() => {
    win.electron = {
      ipcRenderer: {
        send: vi.fn(),
        sendSync: vi.fn(),
        invoke: vi.fn(),
        on: vi.fn(),
        once: vi.fn(),
        removeAllListeners: vi.fn()
      },
      shell: {
        openExternal: vi.fn(),
        showItemInFolder: vi.fn(),
        openPath: vi.fn()
      },
      clipboard: {
        writeText: vi.fn(),
        readText: vi.fn(),
        guessFilePath: vi.fn()
      },
      webFrame: {
        setZoomFactor: vi.fn(),
        setZoomLevel: vi.fn()
      },
      webUtils: {
        getPathForFile: vi.fn()
      },
      process: {
        platform: 'win32',
        versions: {},
        env: { MARKTEXT_VERSION_STRING: 'test' }
      },
      paths: {
        userData: 'D:/notes',
        resources: 'D:/resources',
        cwd: 'D:/Study/marktext',
        ripgrepBinary: 'D:/rg.exe'
      },
      windowControl: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        unmaximize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        setFullScreen: vi.fn(),
        toggleFullScreen: vi.fn(),
        isMaximized: vi.fn(),
        isFullScreen: vi.fn(),
        popupMenu: vi.fn(),
        popupApplicationMenu: vi.fn()
      }
    }
    win.commandExists = { exists: vi.fn() }
    win.fonts = { list: vi.fn() }
    win.DIRNAME = 'D:/notes/docs'
    win.marktext = {
      env: { windowId: 7, type: 'editor', debug: true },
      initialState: { theme: 'dark' },
      paths: { userDataPath: 'D:/notes' }
    }
  })

  afterEach(() => {
    delete win.electron
    delete win.commandExists
    delete win.fonts
    delete win.marktext
    delete win.DIRNAME
  })

  it('exposes stable seams for Electron and preload capabilities', () => {
    expect(hasElectronBridge()).toBe(true)
    expect(getIpcRenderer()).toBe(win.electron?.ipcRenderer)
    expect(getShellBridge()).toBe(win.electron?.shell)
    expect(getProcessBridge().platform).toBe('win32')
    expect(getProcessPlatform()).toBe('win32')
    expect(getElectronPaths().userData).toBe('D:/notes')
    expect(getCommandExistsBridge()).toBe(win.commandExists)
    expect(getFontsBridge()).toBe(win.fonts)
  })

  it('keeps per-window boot state out of feature modules', () => {
    expect(getCurrentWindowId()).toBe(7)
    expect(getWindowType()).toBe('editor')
    expect(getInitialState()).toEqual({ theme: 'dark' })
    expect(getDocumentDirectory()).toBe('D:/notes/docs')
    setDocumentDirectory('D:/notes/archive')
    expect(getDocumentDirectory()).toBe('D:/notes/archive')
  })

  it('provides safe process metadata before preload is available', () => {
    delete win.electron
    delete win.DIRNAME
    expect(hasElectronBridge()).toBe(false)
    expect(getDocumentDirectory()).toBe('')
    expect(getProcessPlatform()).toBe('')
    expect(getProcessBridge().env).toEqual({})
  })
})
