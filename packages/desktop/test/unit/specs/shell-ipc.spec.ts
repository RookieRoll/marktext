import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handles = new Map<string, RegisteredHandler>()
  const listeners = new Map<string, RegisteredHandler>()
  return {
    handles,
    listeners,
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: RegisteredHandler) => {
        handles.set(channel, handler)
      }),
      on: vi.fn((channel: string, listener: RegisteredHandler) => {
        listeners.set(channel, listener)
      })
    },
    shell: {
      openExternal: vi.fn(() => Promise.resolve()),
      showItemInFolder: vi.fn(),
      openPath: vi.fn(() => Promise.resolve(''))
    },
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn(() => 'copied'),
      has: vi.fn(() => false),
      read: vi.fn(() => '')
    },
    log: {
      error: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain,
  shell: mocks.shell,
  clipboard: mocks.clipboard
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('plist', () => ({ parse: vi.fn() }))

import { registerShellHandlers } from '../../../src/main/ipc/shell'

const invokeChannels = [
  'mt::shell::open-external',
  'mt::shell::open-path',
  'mt::clipboard::read-text',
  'mt::clipboard::guess-file-path'
] as const
const sendChannels = [
  'mt::shell::open-external',
  'mt::shell::show-item',
  'mt::clipboard::write-text'
] as const

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = { id: 1 } as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame },
    sender,
    window
  }
}

const events = createEvents()
registerShellHandlers()

describe('shell and clipboard IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  it('rejects unknown senders and child frames for invoke handlers', async() => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of invokeChannels) {
        const handler = mocks.handles.get(channel)
        expect(handler).toBeDefined()
        await expect(
          Promise.resolve().then(() => handler!(event, 'https://example.test'))
        ).rejects.toThrow('Rejected IPC sender')
      }
    }
  })

  it('no-ops all legacy fire-and-forget handlers for invalid senders', () => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of sendChannels) {
        const listener = mocks.listeners.get(channel)
        expect(listener).toBeDefined()
        expect(listener!(event, 'payload')).toBeUndefined()
      }
    }

    expect(mocks.shell.openExternal).not.toHaveBeenCalled()
    expect(mocks.shell.showItemInFolder).not.toHaveBeenCalled()
    expect(mocks.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('preserves valid shell and clipboard behavior for the main frame', async() => {
    await expect(
      mocks.handles.get('mt::shell::open-external')!(events.mainFrameEvent, 'https://example.test')
    ).resolves.toBe(true)
    await expect(
      mocks.handles.get('mt::shell::open-path')!(events.mainFrameEvent, 'note.md')
    ).resolves.toBe('')
    expect(mocks.handles.get('mt::clipboard::read-text')!(events.mainFrameEvent)).toBe('copied')

    mocks.listeners.get('mt::shell::open-external')!(events.mainFrameEvent, 'https://example.test')
    mocks.listeners.get('mt::shell::show-item')!(events.mainFrameEvent, 'note.md')
    mocks.listeners.get('mt::clipboard::write-text')!(events.mainFrameEvent, 'copied')

    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://example.test')
    expect(mocks.shell.showItemInFolder).toHaveBeenCalledWith('note.md')
    expect(mocks.clipboard.writeText).toHaveBeenCalledWith('copied')
  })
})
