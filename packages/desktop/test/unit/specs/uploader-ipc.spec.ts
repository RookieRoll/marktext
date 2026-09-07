import path from 'path'
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
    },
    isImageFile: vi.fn(),
    commandExists: {
      sync: vi.fn()
    },
    exec: vi.fn(),
    execFile: vi.fn(),
    fs: {
      pathExistsSync: vi.fn(),
      writeFile: vi.fn(),
      unlink: vi.fn()
    }
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  ipcMain: mocks.ipcMain
}))
vi.mock('common/filesystem/paths', () => ({
  isImageFile: mocks.isImageFile
}))
vi.mock('command-exists', () => ({ default: mocks.commandExists }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const mockedChildProcess = {
    ...actual,
    exec: mocks.exec,
    execFile: mocks.execFile
  }
  return {
    ...mockedChildProcess,
    default: mockedChildProcess
  }
})
vi.mock('fs-extra', () => ({ default: mocks.fs }))

import { registerUploaderHandlers } from '../../../src/main/ipc/uploader'

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
registerUploaderHandlers()

describe('uploader IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  it('registers the uploader invoke handler', () => {
    expect(mocks.handles.has('mt::uploader::upload')).toBe(true)
  })

  it('rejects unknown senders and child frames before upload work', async () => {
    const request = {
      pathname: path.join('notes', 'note.md'),
      image: 'image.png',
      isPath: true,
      preferences: { currentUploader: 'cliScript', cliScript: 'upload-script' }
    }
    const handler = mocks.handles.get('mt::uploader::upload')

    expect(handler).toBeDefined()
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      await expect(Promise.resolve().then(() => handler!(event, request))).rejects.toThrow(
        'Rejected IPC sender'
      )
    }

    expect(mocks.isImageFile).not.toHaveBeenCalled()
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.fs.writeFile).not.toHaveBeenCalled()
    expect(mocks.BrowserWindow.fromWebContents).toHaveBeenCalled()
  })

  it('preserves request validation for a trusted renderer', async () => {
    const handler = mocks.handles.get('mt::uploader::upload')

    expect(handler).toBeDefined()
    await expect(
      Promise.resolve().then(() => handler!(events.mainFrameEvent, { pathname: 'note.md' }))
    ).rejects.toThrow('Invalid image upload request')

    expect(mocks.isImageFile).not.toHaveBeenCalled()
    expect(mocks.exec).not.toHaveBeenCalled()
    expect(mocks.execFile).not.toHaveBeenCalled()
  })

  it('preserves valid path upload behavior for the main frame', async () => {
    const request = {
      pathname: path.join('notes', 'note.md'),
      image: 'image.png',
      isPath: true,
      preferences: { currentUploader: 'cliScript', cliScript: 'upload-script' }
    }
    const imagePath = path.resolve(path.dirname(request.pathname), request.image)
    const handler = mocks.handles.get('mt::uploader::upload')

    mocks.isImageFile.mockReturnValue(true)
    mocks.execFile.mockImplementation((...args: unknown[]) => {
      const callback = args[args.length - 1] as (error: Error | null, data: string) => void
      callback(null, 'https://example.test/image.png\n')
    })

    await expect(handler!(events.mainFrameEvent, request)).resolves.toBe(
      'https://example.test/image.png'
    )

    expect(mocks.isImageFile).toHaveBeenCalledWith(imagePath)
    expect(mocks.execFile).toHaveBeenCalledWith(
      'upload-script',
      [imagePath],
      expect.objectContaining({ env: expect.any(Object) }),
      expect.any(Function)
    )
  })
})
