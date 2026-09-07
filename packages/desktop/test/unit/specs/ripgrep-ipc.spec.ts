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
    spawn: vi.fn(),
    log: {
      warn: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('@vscode/ripgrep', () => ({ rgPath: 'bundled-rg' }))
vi.mock('child_process', async(importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const mockedChildProcess = {
    ...actual,
    spawn: mocks.spawn
  }
  return {
    ...mockedChildProcess,
    default: mockedChildProcess
  }
})

import { registerRipgrepHandlers } from '../../../src/main/ipc/ripgrep'

const createChild = () => ({
  on: vi.fn(),
  kill: vi.fn(),
  stdout: undefined,
  stderr: undefined
})

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = {
    mainFrame,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn()
  } as unknown as WebContents

  const otherMainFrame = {} as WebFrameMain
  const otherSender = {
    mainFrame: otherMainFrame,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn()
  } as unknown as WebContents

  const unknownMainFrame = {} as WebFrameMain
  const unknownSender = {
    mainFrame: unknownMainFrame,
    isDestroyed: vi.fn(() => false),
    send: vi.fn(),
    once: vi.fn()
  } as unknown as WebContents

  const window = { id: 1 } as BrowserWindow
  const otherWindow = { id: 2 } as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    otherMainFrameEvent: { sender: otherSender, senderFrame: otherMainFrame },
    unknownEvent: { sender: unknownSender, senderFrame: unknownMainFrame },
    sender,
    otherSender,
    unknownSender,
    window,
    otherWindow
  }
}

const events = createEvents()
registerRipgrepHandlers()

const request = (searchId: string) => ({
  searchId,
  mode: 'files',
  directories: ['C:/project'],
  pattern: '',
  options: {}
})

describe('ripgrep IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) => {
      if (candidate === events.sender) return events.window
      if (candidate === events.otherSender) return events.otherWindow
      return null
    })
  })

  it('registers the start and cancel handlers', () => {
    expect(mocks.handles.has('mt::rg::start')).toBe(true)
    expect(mocks.listeners.has('mt::rg::cancel')).toBe(true)
  })

  it('rejects unknown senders and child frames before starting a search', () => {
    const handler = mocks.handles.get('mt::rg::start')!

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      expect(() => handler(event, request('rejected-search'))).toThrow(
        'Rejected IPC sender'
      )
    }

    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('preserves valid searches and binds cancellation to the starting sender', () => {
    const child = createChild()
    mocks.spawn.mockReturnValue(child)

    const startHandler = mocks.handles.get('mt::rg::start')!
    const cancelHandler = mocks.listeners.get('mt::rg::cancel')!
    const searchId = 'valid-search'

    expect(startHandler(events.mainFrameEvent, request(searchId))).toEqual({ searchId })
    expect(mocks.spawn).toHaveBeenCalledWith(
      'bundled-rg',
      ['--files', '--', 'C:/project'],
      { cwd: 'C:/project', stdio: ['pipe', 'pipe', 'pipe'] }
    )

    cancelHandler(events.otherMainFrameEvent, searchId)
    expect(child.kill).not.toHaveBeenCalled()
    expect(events.sender.send).not.toHaveBeenCalled()

    cancelHandler(events.mainFrameEvent, searchId)
    expect(child.kill).toHaveBeenCalledOnce()
    expect(events.sender.send).toHaveBeenCalledWith('mt::rg::cancelled', { searchId })
  })

  it('silently ignores invalid cancel senders and child frames', () => {
    const child = createChild()
    mocks.spawn.mockReturnValue(child)

    const startHandler = mocks.handles.get('mt::rg::start')!
    const cancelHandler = mocks.listeners.get('mt::rg::cancel')!
    const searchId = 'invalid-cancel'
    startHandler(events.mainFrameEvent, request(searchId))

    cancelHandler(events.unknownEvent, searchId)
    cancelHandler(events.childFrameEvent, searchId)

    expect(child.kill).not.toHaveBeenCalled()
    expect(events.sender.send).not.toHaveBeenCalled()

    cancelHandler(events.mainFrameEvent, searchId)
  })
})
