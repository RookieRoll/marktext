import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererIpcEvent } from '../../../src/main/ipc/rendererSender'

type RegisteredHandler = (event: RendererIpcEvent, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredHandler>()
  const handles = new Map<string, RegisteredHandler>()

  return {
    listeners,
    handles,
    app: {
      isReady: vi.fn(() => true),
      getVersion: vi.fn(() => '0.0.0')
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
      })
    },
    shell: {
      openPath: vi.fn(() => Promise.resolve(''))
    },
    clipboard: {
      writeText: vi.fn()
    },
    crashReporter: {
      start: vi.fn()
    },
    dialog: {
      showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
      showErrorBox: vi.fn()
    },
    writeFile: vi.fn(() => Promise.resolve()),
    getCurrentKeyboardLayout: vi.fn(() => ({ name: 'test' })),
    getKeyMap: vi.fn(() => ({})),
    onDidChangeKeyboardLayout: vi.fn(),
    logError: vi.fn(),
    translate: vi.fn((key: string) => key)
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: mocks.BrowserWindow,
  clipboard: mocks.clipboard,
  crashReporter: mocks.crashReporter,
  dialog: mocks.dialog,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell
}))
vi.mock('electron-log', () => ({ default: { error: mocks.logError } }))
vi.mock('fs/promises', () => ({
  default: { writeFile: mocks.writeFile },
  writeFile: mocks.writeFile
}))
vi.mock('native-keymap', () => ({
  getCurrentKeyboardLayout: mocks.getCurrentKeyboardLayout,
  getKeyMap: mocks.getKeyMap,
  onDidChangeKeyboardLayout: mocks.onDidChangeKeyboardLayout
}))
vi.mock('../../../src/main/i18n', () => ({ t: mocks.translate }))
vi.mock('../../../src/main/utils/createGitHubIssue', () => ({
  createAndOpenGitHubIssueUrl: vi.fn()
}))

import { registerKeyboardListeners } from '../../../src/main/keyboard'
import setupExceptionHandler from '../../../src/main/exceptionHandler'

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = { id: 1 } as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame } as RendererIpcEvent,
    childFrameEvent: { sender, senderFrame: childFrame } as RendererIpcEvent,
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame } as RendererIpcEvent,
    sender,
    window
  }
}

beforeAll(() => {
  registerKeyboardListeners()
  setupExceptionHandler()
})

describe('keyboard and exception IPC renderer sender guards', () => {
  let events: ReturnType<typeof createEvents>

  beforeEach(() => {
    vi.clearAllMocks()
    events = createEvents()
    mocks.BrowserWindow.fromWebContents.mockImplementation((sender: WebContents) =>
      sender === events.sender ? events.window : null
    )
  })

  it('rejects unknown and child-frame keyboard invoke senders', async() => {
    const handler = mocks.handles.get('mt::keybinding-get-keyboard-info')
    expect(handler).toBeDefined()

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      await expect(Promise.resolve().then(() => handler!(event))).rejects.toThrow(
        'Rejected IPC sender'
      )
    }
  })

  it('ignores invalid keyboard debug senders and preserves main-frame behavior', async() => {
    const handler = mocks.listeners.get('mt::keybinding-debug-dump-keyboard-info')
    expect(handler).toBeDefined()

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      await expect(handler!(event)).resolves.toBeUndefined()
    }
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.shell.openPath).not.toHaveBeenCalled()

    await expect(handler!(events.mainFrameEvent)).resolves.toBeUndefined()
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('marktext_keyboard_info.json'),
      expect.any(String),
      'utf8'
    )
    await vi.waitFor(() => {
      expect(mocks.shell.openPath).toHaveBeenCalledWith(
        expect.stringContaining('marktext_keyboard_info.json')
      )
    })
  })

  it('ignores invalid renderer-error senders and handles a trusted main frame', async() => {
    const handler = mocks.listeners.get('mt::handle-renderer-error')
    expect(handler).toBeDefined()
    const error = new Error('renderer failure')

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      handler!(event, error)
    }
    await Promise.resolve()
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled()

    handler!(events.mainFrameEvent, error)
    await vi.waitFor(() => {
      expect(mocks.dialog.showMessageBox).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'error.unexpectedRendererProcess',
          detail: error.stack
        })
      )
    })
  })
})
