import path from 'path'
import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererIpcEvent } from '../../../src/main/ipc/rendererSender'

type RegisteredHandler = (event: RendererIpcEvent, payload?: unknown) => unknown

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredHandler>()

  return {
    listeners,
    fromWebContents: vi.fn(),
    ipcMain: {
      on: vi.fn((channel: string, handler: RegisteredHandler) => {
        listeners.set(channel, handler)
      })
    },
    log: {
      error: vi.fn()
    },
    searchFilesAndDir: vi.fn(),
    window: {
      webContents: {
        send: vi.fn()
      }
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('../../../src/main/commands', () => ({ COMMANDS: {} }))
vi.mock('../../../src/main/utils/imagePathAutoComplement', () => ({
  searchFilesAndDir: mocks.searchFilesAndDir
}))

await import('../../../src/main/menu/actions/edit')

const mainFrame = {} as WebFrameMain
const childFrame = {} as WebFrameMain
const sender = { mainFrame } as WebContents
const unknownSender = { mainFrame } as WebContents
const events = {
  childFrameEvent: { sender, senderFrame: childFrame } as RendererIpcEvent,
  mainFrameEvent: { sender, senderFrame: mainFrame } as RendererIpcEvent,
  unknownEvent: { sender: unknownSender, senderFrame: mainFrame } as RendererIpcEvent
}
const window = mocks.window as unknown as BrowserWindow

describe('edit actions renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === sender ? window : null
    )
    mocks.searchFilesAndDir.mockResolvedValue([])
  })

  it('registers the image path IPC handler', () => {
    expect(mocks.listeners.has('mt::ask-for-image-auto-path')).toBe(true)
  })

  it('no-ops unknown senders and child frames before image path work', async() => {
    const handler = mocks.listeners.get('mt::ask-for-image-auto-path')!

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      handler(event, { pathname: path.join('docs', 'note.md'), src: 'image.png', id: 'request-1' })
    }

    await Promise.resolve()
    expect(mocks.searchFilesAndDir).not.toHaveBeenCalled()
    expect(mocks.window.webContents.send).not.toHaveBeenCalled()
  })

  it('preserves valid image path responses for the main frame', async() => {
    const handler = mocks.listeners.get('mt::ask-for-image-auto-path')!
    const pathname = path.join('docs', 'note.md')
    const src = path.join('images', 'logo.png')
    const files = [{ file: 'logo.png', type: 'image' }]
    mocks.searchFilesAndDir.mockResolvedValue(files)

    handler(events.mainFrameEvent, { pathname, src, id: 'request-2' })
    await Promise.resolve()
    await Promise.resolve()

    const fullPath = path.join(path.dirname(pathname), src)
    expect(mocks.searchFilesAndDir).toHaveBeenCalledWith(
      path.dirname(fullPath),
      path.basename(fullPath)
    )
    expect(mocks.window.webContents.send).toHaveBeenCalledWith(
      'mt::response-of-image-path-request-2',
      files
    )
  })
})
