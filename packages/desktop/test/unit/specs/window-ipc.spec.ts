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
    Menu: vi.fn(),
    MenuItem: vi.fn(),
    log: {
      error: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  Menu: mocks.Menu,
  MenuItem: mocks.MenuItem,
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: mocks.log }))

import { registerWindowHandlers } from '../../../src/main/ipc/window'

const invokeChannels = ['mt::win::is-maximized', 'mt::win::is-fullscreen'] as const
const sendChannels = [
  'mt::win::minimize',
  'mt::win::toggle-maximize',
  'mt::win::maximize',
  'mt::win::unmaximize',
  'mt::win::close',
  'mt::win::set-fullscreen',
  'mt::win::toggle-fullscreen'
] as const

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = {
    id: 1,
    minimize: vi.fn(),
    isMaximized: vi.fn(() => false),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    setFullScreen: vi.fn(),
    isFullScreen: vi.fn(() => false)
  }

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame },
    sender,
    window
  }
}

const events = createEvents()
registerWindowHandlers()

describe('window IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? (events.window as unknown as BrowserWindow) : null
    )
  })

  it('registers all window control handlers', () => {
    expect([...mocks.handles.keys()]).toEqual(expect.arrayContaining([...invokeChannels]))
    expect([...mocks.listeners.keys()]).toEqual(expect.arrayContaining([...sendChannels]))
    expect(mocks.handles).toHaveProperty('size', invokeChannels.length)
    expect(mocks.listeners).toHaveProperty('size', sendChannels.length + 2)
  })

  it('rejects unknown senders and child frames for invoke handlers', async() => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of invokeChannels) {
        const handler = mocks.handles.get(channel)
        expect(handler).toBeDefined()
        await expect(Promise.resolve().then(() => handler!(event))).rejects.toThrow(
          'Rejected IPC sender'
        )
      }
    }

    expect(events.window.isMaximized).not.toHaveBeenCalled()
    expect(events.window.isFullScreen).not.toHaveBeenCalled()
  })

  it('no-ops all fire-and-forget window handlers for invalid senders', () => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of sendChannels) {
        const listener = mocks.listeners.get(channel)
        expect(listener).toBeDefined()
        expect(listener!(event, true)).toBeUndefined()
      }
    }

    expect(events.window.minimize).not.toHaveBeenCalled()
    expect(events.window.maximize).not.toHaveBeenCalled()
    expect(events.window.unmaximize).not.toHaveBeenCalled()
    expect(events.window.close).not.toHaveBeenCalled()
    expect(events.window.setFullScreen).not.toHaveBeenCalled()
  })

  it('preserves valid window control behavior and invoke return values', async() => {
    events.window.isMaximized.mockReturnValueOnce(true).mockReturnValueOnce(false)
    events.window.isFullScreen.mockReturnValueOnce(true).mockReturnValueOnce(false)

    expect(mocks.handles.get('mt::win::is-maximized')!(events.mainFrameEvent)).toBe(true)
    expect(mocks.handles.get('mt::win::is-maximized')!(events.mainFrameEvent)).toBe(false)
    expect(mocks.handles.get('mt::win::is-fullscreen')!(events.mainFrameEvent)).toBe(true)
    expect(mocks.handles.get('mt::win::is-fullscreen')!(events.mainFrameEvent)).toBe(false)

    events.window.isMaximized.mockReset().mockReturnValue(true)
    events.window.isFullScreen.mockReset().mockReturnValue(true)

    mocks.listeners.get('mt::win::minimize')!(events.mainFrameEvent)
    mocks.listeners.get('mt::win::toggle-maximize')!(events.mainFrameEvent)
    mocks.listeners.get('mt::win::maximize')!(events.mainFrameEvent)
    mocks.listeners.get('mt::win::unmaximize')!(events.mainFrameEvent)
    mocks.listeners.get('mt::win::close')!(events.mainFrameEvent)
    mocks.listeners.get('mt::win::set-fullscreen')!(events.mainFrameEvent, true)
    mocks.listeners.get('mt::win::toggle-fullscreen')!(events.mainFrameEvent)

    expect(events.window.minimize).toHaveBeenCalledTimes(1)
    expect(events.window.unmaximize).toHaveBeenCalledTimes(2)
    expect(events.window.maximize).toHaveBeenCalledTimes(1)
    expect(events.window.close).toHaveBeenCalledTimes(1)
    expect(events.window.setFullScreen).toHaveBeenNthCalledWith(1, true)
    expect(events.window.setFullScreen).toHaveBeenNthCalledWith(2, false)
  })
})
