import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IMAGE_EXTENSIONS } from 'common/filesystem/paths'

type RegisteredHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, RegisteredHandler>()
  const listeners = new Map<string, RegisteredHandler>()
  return {
    handlers,
    listeners,
    showOpenDialog: vi.fn(),
    fromWebContents: vi.fn(),
    ipcMain: {
      handle: vi.fn((channel: string, listener: RegisteredHandler) => {
        handlers.set(channel, listener)
      }),
      on: vi.fn((channel: string, listener: RegisteredHandler) => {
        listeners.set(channel, listener)
      }),
      emit: vi.fn()
    },
    window: {
      id: 1,
      webContents: { send: vi.fn() }
    }
  }
})

vi.mock('electron', () => ({
  ipcMain: mocks.ipcMain,
  dialog: { showOpenDialog: mocks.showOpenDialog },
  BrowserWindow: { fromWebContents: mocks.fromWebContents }
}))

vi.mock('keytar', () => ({ default: { getPassword: vi.fn(), setPassword: vi.fn() } }))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('common/filesystem', () => ({ ensureDirSync: vi.fn() }))

vi.mock('electron-store', () => ({
  default: class {
    private data: Record<string, unknown> = {}
    get(key: string) {
      return this.data[key]
    }

    set(key: string | Record<string, unknown>, value?: unknown) {
      if (typeof key === 'string') this.data[key] = value
      else Object.assign(this.data, key)
    }

    get store() {
      return this.data
    }
  }
}))

const { default: DataCenter } = await import('main_renderer/dataCenter')

const invokeChannels = ['mt::ask-for-image-path'] as const
const sendChannels = [
  'set-image-folder-path',
  'mt::ask-for-user-data',
  'mt::ask-for-modify-image-folder-path',
  'mt::set-user-data'
] as const

const mainFrame = {} as WebFrameMain
const childFrame = {} as WebFrameMain
const sender = { mainFrame } as WebContents
const unknownSender = { mainFrame } as WebContents
const events = {
  mainFrameEvent: { sender, senderFrame: mainFrame },
  childFrameEvent: { sender, senderFrame: childFrame },
  unknownEvent: { sender: unknownSender, senderFrame: mainFrame }
}
const window = mocks.window as unknown as BrowserWindow

function createDataCenter() {
  // Instantiating DataCenter registers all dataCenter IPC handlers.
  // eslint-disable-next-line no-new
  const dataCenter = new DataCenter({ dataCenterPath: '/tmp/mt-dc', userDataPath: '/tmp/mt-ud' })
  dataCenter.getAll = vi.fn(async() => ({ theme: 'dark' }))
  dataCenter.setItem = vi.fn()
  dataCenter.setItems = vi.fn()
  return dataCenter
}

describe('dataCenter IPC renderer sender guard', () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.listeners.clear()
    vi.clearAllMocks()
    mocks.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === sender ? window : null
    )
  })

  it('registers the targeted invoke and send handlers', () => {
    createDataCenter()

    expect([...mocks.handlers.keys()]).toEqual(expect.arrayContaining([...invokeChannels]))
    expect([...mocks.listeners.keys()]).toEqual(expect.arrayContaining([...sendChannels]))
    expect(mocks.handlers).toHaveProperty('size', invokeChannels.length)
    expect(mocks.listeners).toHaveProperty('size', sendChannels.length)
  })

  it('rejects invoke senders and no-ops send senders before dataCenter work', async() => {
    const dataCenter = createDataCenter()
    const askImagePath = mocks.handlers.get('mt::ask-for-image-path')!

    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      await expect(Promise.resolve().then(() => askImagePath(event))).rejects.toThrow(
        'Rejected IPC sender'
      )

      for (const channel of sendChannels) {
        const listener = mocks.listeners.get(channel)
        expect(listener).toBeDefined()
        await listener!(event, '/images/selected', { theme: 'light' })
      }
    }

    expect(dataCenter.getAll).not.toHaveBeenCalled()
    expect(dataCenter.setItem).not.toHaveBeenCalled()
    expect(dataCenter.setItems).not.toHaveBeenCalled()
    expect(mocks.showOpenDialog).not.toHaveBeenCalled()
    expect(mocks.window.webContents.send).not.toHaveBeenCalled()
  })

  it('preserves valid dataCenter behavior and dialog protocols', async() => {
    const dataCenter = createDataCenter()
    mocks.showOpenDialog
      .mockResolvedValueOnce({ filePaths: ['/images/from-dialog'], canceled: false })
      .mockResolvedValueOnce({ filePaths: ['/images/picked.png'], canceled: false })

    await mocks.listeners.get('set-image-folder-path')!(events.mainFrameEvent, '/images/direct')
    await mocks.listeners.get('mt::ask-for-user-data')!(events.mainFrameEvent)
    await mocks.listeners.get('mt::ask-for-modify-image-folder-path')!(events.mainFrameEvent)
    await mocks.listeners.get('mt::ask-for-modify-image-folder-path')!(
      events.mainFrameEvent,
      '/images/direct-modification'
    )
    await mocks.listeners.get('mt::set-user-data')!(events.mainFrameEvent, { theme: 'light' })

    const result = await mocks.handlers.get('mt::ask-for-image-path')!(events.mainFrameEvent)

    expect(dataCenter.setItem).toHaveBeenNthCalledWith(1, 'imageFolderPath', '/images/direct')
    expect(dataCenter.setItem).toHaveBeenNthCalledWith(2, 'imageFolderPath', '/images/from-dialog')
    expect(dataCenter.setItem).toHaveBeenNthCalledWith(
      3,
      'imageFolderPath',
      '/images/direct-modification'
    )
    expect(dataCenter.setItems).toHaveBeenCalledWith({ theme: 'light' })
    expect(mocks.window.webContents.send).toHaveBeenCalledWith('mt::user-preference', {
      theme: 'dark'
    })
    expect(mocks.showOpenDialog).toHaveBeenNthCalledWith(
      1,
      window,
      expect.objectContaining({ properties: ['openDirectory', 'createDirectory'] })
    )
    expect(mocks.showOpenDialog).toHaveBeenNthCalledWith(
      2,
      window,
      expect.objectContaining({
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: [...IMAGE_EXTENSIONS] }]
      })
    )
    expect(result).toBe('/images/picked.png')
  })
})
