import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RegisteredHandler = (...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const handles = new Map<string, RegisteredHandler>()
  const fs = {
    emptyDir: vi.fn(),
    copy: vi.fn(),
    ensureDir: vi.fn(),
    outputFile: vi.fn(),
    move: vi.fn(),
    stat: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    pathExists: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn()
  }
  return {
    handles,
    fs,
    commonIsFile: vi.fn(),
    commonIsDirectory: vi.fn(),
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
vi.mock('fs-extra', () => ({ default: mocks.fs }))
vi.mock('common/filesystem', () => ({
  isFile: mocks.commonIsFile,
  isDirectory: mocks.commonIsDirectory
}))

import { registerFsHandlers } from '../../../src/main/ipc/fs'

const channels = [
  'mt::fs::is-file',
  'mt::fs::is-directory',
  'mt::fs::empty-dir',
  'mt::fs::copy',
  'mt::fs::ensure-dir',
  'mt::fs::output-file',
  'mt::fs::move',
  'mt::fs::stat',
  'mt::fs::write-file',
  'mt::fs::read-file',
  'mt::fs::path-exists',
  'mt::fs::unlink',
  'mt::fs::readdir',
  'mt::fs::is-executable'
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
registerFsHandlers()

describe('filesystem IPC renderer sender guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
  })

  it('registers every filesystem invoke handler', () => {
    expect([...mocks.handles.keys()]).toEqual(expect.arrayContaining([...channels]))
    expect(mocks.handles).toHaveProperty('size', channels.length)
  })

  it('rejects unknown senders and child frames before filesystem work', async() => {
    for (const event of [events.unknownEvent, events.childFrameEvent]) {
      for (const channel of channels) {
        const handler = mocks.handles.get(channel)
        expect(handler).toBeDefined()
        await expect(
          Promise.resolve().then(() => handler!(event, 'source', 'destination'))
        ).rejects.toThrow('Rejected IPC sender')
      }
    }

    expect(mocks.commonIsFile).not.toHaveBeenCalled()
    expect(mocks.commonIsDirectory).not.toHaveBeenCalled()
    expect(mocks.fs.outputFile).not.toHaveBeenCalled()
    expect(mocks.fs.readFile).not.toHaveBeenCalled()
    expect(mocks.BrowserWindow.fromWebContents).toHaveBeenCalled()
  })

  it('preserves valid renderer filesystem behavior and payload conversion', async() => {
    mocks.commonIsFile.mockReturnValue(true)
    mocks.fs.outputFile.mockResolvedValue(undefined)

    await expect(
      mocks.handles.get('mt::fs::is-file')!(events.mainFrameEvent, 'note.md')
    ).toBe(true)
    await mocks.handles.get('mt::fs::output-file')!(events.mainFrameEvent, 'note.md', new Uint8Array([1, 2]))

    expect(mocks.commonIsFile).toHaveBeenCalledWith('note.md')
    expect(mocks.fs.outputFile).toHaveBeenCalledWith('note.md', Buffer.from([1, 2]))
  })
})
