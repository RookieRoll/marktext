import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handles = new Map<string, RegisteredHandler>()
  return {
    handles,
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: RegisteredHandler) => {
        handles.set(channel, handler)
      })
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain
}))
vi.mock('write-file-atomic', () => ({ default: { sync: vi.fn() } }))

import EditorBufferStore from '../../../src/main/editorBufferStore'
import type { BufferedState } from '../../../src/shared/types/bufferedState'

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as WebContents
  const unknownSender = { mainFrame } as WebContents
  const window = { restoreBufferId: 'restore-1' } as unknown as BrowserWindow

  return {
    mainFrameEvent: { sender, senderFrame: mainFrame },
    childFrameEvent: { sender, senderFrame: childFrame },
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame },
    sender,
    window
  }
}

const validState: BufferedState = {
  version: 1,
  tabs: [],
  currentFileId: null,
  restoreWarnings: []
}

describe('editor buffer state IPC renderer sender guard', () => {
  const events = createEvents()

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handles.clear()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  const createBufferStore = () => {
    const store = Object.create(EditorBufferStore.prototype) as EditorBufferStore
    store.updateBufferState = vi.fn(() => true)
    store._listenForIpcMain()
    return store
  }

  it('registers the buffered-state handler', () => {
    createBufferStore()

    expect(mocks.handles.has('update-buffer-state')).toBe(true)
  })

  it('rejects unknown senders and child frames before validation or writes', async() => {
    const store = createBufferStore()
    const handler = mocks.handles.get('update-buffer-state')
    expect(handler).toBeDefined()

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      await expect(Promise.resolve().then(() => handler!(event, validState))).rejects.toThrow(
        'Rejected IPC sender'
      )
    }

    expect(store.updateBufferState).not.toHaveBeenCalled()
  })

  it('preserves valid state validation and delegates trusted updates', () => {
    const store = createBufferStore()
    const handler = mocks.handles.get('update-buffer-state')!

    expect(handler(events.mainFrameEvent, validState)).toBe(true)
    expect(store.updateBufferState).toHaveBeenCalledWith(events.mainFrameEvent, validState)
    expect(() => handler(events.mainFrameEvent, { tabs: 'invalid' })).toThrow(
      'Invalid buffered state payload'
    )
  })
})