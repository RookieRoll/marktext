import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererIpcEvent } from '../../../src/main/ipc/rendererSender'

type RegisteredHandler = (...args: any[]) => any

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredHandler>()

  return {
    listeners,
    app: {
      quit: vi.fn()
    },
    BrowserWindow: {
      fromWebContents: vi.fn()
    },
    dialog: {
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn()
    },
    ipcMain: {
      on: vi.fn((channel: string, handler: RegisteredHandler) => {
        listeners.set(channel, handler)
      }),
      emit: vi.fn()
    },
    log: {
      error: vi.fn()
    },
    fsRename: vi.fn(),
    isDirectory: vi.fn(),
    isFile: vi.fn(() => true),
    exists: vi.fn(async() => false),
    isMarkdownFile: vi.fn(() => false),
    isDangerousExecutableFile: vi.fn(() => false),
    userSetting: vi.fn(),
    showTabBar: vi.fn(),
    normalizeAndResolvePath: vi.fn((pathname: string) => '/resolved' + pathname),
    writeFile: vi.fn(),
    writeMarkdownFile: vi.fn(),
    getPath: vi.fn(() => '/documents'),
    getRecommendTitleFromMarkdownString: vi.fn(() => ''),
    pandoc: Object.assign(vi.fn(), { exists: vi.fn(() => false) }),
    t: vi.fn((key: string) => key)
  }
})

vi.mock('electron', () => ({
  BrowserWindow: mocks.BrowserWindow,
  app: mocks.app,
  dialog: mocks.dialog,
  shell: mocks.shell,
  ipcMain: mocks.ipcMain
}))
vi.mock('electron-log', () => ({ default: mocks.log }))
vi.mock('fs-extra', () => ({ rename: mocks.fsRename }))
vi.mock('common/filesystem', () => ({
  isDirectory: mocks.isDirectory,
  isFile: mocks.isFile,
  exists: mocks.exists
}))
vi.mock('common/filesystem/paths', () => ({
  MARKDOWN_EXTENSIONS: ['md'],
  isDangerousExecutableFile: mocks.isDangerousExecutableFile,
  isMarkdownFile: mocks.isMarkdownFile
}))
vi.mock('../../../src/main/menu/actions/marktext', () => ({ userSetting: mocks.userSetting }))
vi.mock('../../../src/main/menu/actions/view', () => ({ showTabBar: mocks.showTabBar }))
vi.mock('../../../src/main/commands', () => ({
  COMMANDS: {
    FILE_CLOSE_TAB: 'file.close-tab',
    FILE_CLOSE_WINDOW: 'file.close-window',
    FILE_EXPORT_FILE: 'file.export-file',
    FILE_IMPORT_FILE: 'file.import-file',
    FILE_MOVE_FILE: 'file.move-file',
    FILE_NEW_FILE: 'file.new-window',
    FILE_NEW_TAB: 'file.new-tab',
    FILE_OPEN_FILE: 'file.open-file',
    FILE_OPEN_FOLDER: 'file.open-folder',
    FILE_PREFERENCES: 'file.preferences',
    FILE_PRINT: 'file.print',
    FILE_QUIT: 'file.quit',
    FILE_RENAME_FILE: 'file.rename-file',
    FILE_SAVE: 'file.save',
    FILE_SAVE_AS: 'file.save-as',
    FILE_EXPORT_FILE_PDF: 'file.export-file.pdf'
  }
}))
vi.mock('../../../src/main/config', () => ({
  EXTENSION_HASN: { styledHtml: '.html', pdf: '.pdf' },
  PANDOC_EXTENSIONS: ['html'],
  URL_REG: /^https?:\/\//i
}))
vi.mock('../../../src/main/filesystem', () => ({
  normalizeAndResolvePath: mocks.normalizeAndResolvePath,
  writeFile: mocks.writeFile
}))
vi.mock('../../../src/main/filesystem/markdown', () => ({
  writeMarkdownFile: mocks.writeMarkdownFile
}))
vi.mock('../../../src/main/utils', () => ({
  getPath: mocks.getPath,
  getRecommendTitleFromMarkdownString: mocks.getRecommendTitleFromMarkdownString
}))
vi.mock('../../../src/main/utils/pandoc', () => ({ default: mocks.pandoc }))
vi.mock('../../../src/main/i18n', () => ({ t: mocks.t }))

const createEvents = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = {
    mainFrame,
    send: vi.fn()
  } as unknown as WebContents
  const unknownSender = {
    mainFrame,
    send: vi.fn()
  } as unknown as WebContents
  const window = {
    id: 31,
    close: vi.fn(),
    webContents: {
      print: vi.fn(),
      printToPDF: vi.fn(),
      send: vi.fn()
    }
  } as unknown as BrowserWindow

  return {
    childFrameEvent: { sender, senderFrame: childFrame } as RendererIpcEvent,
    mainFrameEvent: { sender, senderFrame: mainFrame } as RendererIpcEvent,
    sender,
    unknownEvent: { sender: unknownSender, senderFrame: mainFrame } as RendererIpcEvent,
    window
  }
}

const unsavedFile = {
  id: 'tab-1',
  filename: 'note.md',
  markdown: '# note',
  options: {
    adjustLineEndingOnSave: false,
    lineEnding: 'lf',
    encoding: 'utf8'
  },
  pathname: '/tmp/note.md'
} as any

describe('file actions renderer sender guard', () => {
  let events: ReturnType<typeof createEvents>

  beforeEach(async() => {
    mocks.listeners.clear()
    events = createEvents()
    vi.resetModules()
    await import('../../../src/main/menu/actions/file')
    mocks.BrowserWindow.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === events.sender ? events.window : null
    )
    mocks.writeMarkdownFile.mockResolvedValue(undefined)
    mocks.fsRename.mockImplementation((_from: string, _to: string, callback: Function) => {
      callback(null)
    })
  })

  it('registers the high-risk renderer IPC handlers', () => {
    expect([...mocks.listeners.keys()]).toEqual(expect.arrayContaining([
      'mt::save-tabs',
      'mt::save-and-close-tabs',
      'mt::response-file-save-as',
      'mt::close-window-confirm',
      'mt::response-file-save',
      'mt::response-export',
      'mt::response-print',
      'mt::window::drop',
      'mt::rename',
      'mt::response-file-move-to',
      'mt::format-link-click',
      'mt::ask-for-open-project-in-sidebar',
      'mt::cmd-open-file',
      'mt::cmd-open-folder',
      'mt::cmd-close-window',
      'mt::cmd-import-file'
    ]))
  })

  it('no-ops unknown senders and child frames before high-risk side effects', async() => {
    const invalidEvents = [events.unknownEvent, events.childFrameEvent]

    for (const event of invalidEvents) {
      await mocks.listeners.get('mt::save-tabs')!(event, [unsavedFile])
      await mocks.listeners.get('mt::save-and-close-tabs')!(event, [unsavedFile])
      await mocks.listeners.get('mt::response-file-save-as')!(
        event,
        'tab-1',
        'note.md',
        '/tmp/note.md',
        '# note',
        unsavedFile.options
      )
      await mocks.listeners.get('mt::close-window-confirm')!(event, [unsavedFile])
      await mocks.listeners.get('mt::response-file-save')!(
        event,
        'tab-1',
        'note.md',
        '/tmp/note.md',
        '# note',
        unsavedFile.options
      )
      await mocks.listeners.get('mt::response-export')!(event, { type: 'pdf' })
      await mocks.listeners.get('mt::response-print')!(event)
      await mocks.listeners.get('mt::window::drop')!(event, ['/tmp/note.md'])
      await mocks.listeners.get('mt::rename')!(event, {
        id: 'tab-1',
        pathname: '/tmp/note.md',
        newPathname: '/tmp/renamed.md'
      })
      await mocks.listeners.get('mt::response-file-move-to')!(event, {
        id: 'tab-1',
        pathname: '/tmp/note.md'
      })
      await mocks.listeners.get('mt::format-link-click')!(event, {
        data: { href: 'https://example.com' }
      })
      await mocks.listeners.get('mt::cmd-open-file')!(event)
      await mocks.listeners.get('mt::cmd-open-folder')!(event)
      await mocks.listeners.get('mt::cmd-close-window')!(event)
      await mocks.listeners.get('mt::cmd-import-file')!(event)
    }

    expect(mocks.dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(mocks.dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(mocks.dialog.showMessageBox).not.toHaveBeenCalled()
    expect(mocks.writeMarkdownFile).not.toHaveBeenCalled()
    expect(mocks.writeFile).not.toHaveBeenCalled()
    expect(mocks.fsRename).not.toHaveBeenCalled()
    expect(events.window.webContents.print).not.toHaveBeenCalled()
    expect(events.window.webContents.printToPDF).not.toHaveBeenCalled()
    expect(events.window.webContents.send).not.toHaveBeenCalled()
    expect(events.sender.send).not.toHaveBeenCalled()
    expect(events.window.close).not.toHaveBeenCalled()
    expect(mocks.shell.openExternal).not.toHaveBeenCalled()
    expect(mocks.shell.openPath).not.toHaveBeenCalled()
    expect(mocks.ipcMain.emit).not.toHaveBeenCalled()
  })

  it('preserves valid main-frame save and close behavior', async() => {
    await mocks.listeners.get('mt::save-tabs')!(events.mainFrameEvent, [unsavedFile])
    expect(mocks.writeMarkdownFile).toHaveBeenCalledWith(
      expect.stringContaining('note.md'),
      '# note',
      unsavedFile.options
    )
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith('window-file-saved', 31, expect.any(String))
    expect(events.window.webContents.send).toHaveBeenCalledWith('mt::tab-saved', 'tab-1')

    mocks.dialog.showMessageBox.mockResolvedValue({ response: 1 })
    await mocks.listeners.get('mt::save-and-close-tabs')!(events.mainFrameEvent, [unsavedFile])
    expect(events.window.webContents.send).toHaveBeenCalledWith(
      'mt::force-close-tabs-by-id',
      ['tab-1']
    )

    await mocks.listeners.get('mt::close-window-confirm')!(events.mainFrameEvent, [unsavedFile])
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith('window-close-by-id', 31)
  })

  it('preserves valid main-frame rename and move-to behavior', async() => {
    await mocks.listeners.get('mt::rename')!(events.mainFrameEvent, {
      id: 'tab-1',
      pathname: '/tmp/note.md',
      newPathname: '/tmp/renamed.md'
    })
    expect(mocks.fsRename).toHaveBeenCalledWith(
      '/tmp/note.md',
      '/tmp/renamed.md',
      expect.any(Function)
    )
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith(
      'window-change-file-path',
      31,
      '/tmp/renamed.md',
      '/tmp/note.md'
    )
    expect(events.sender.send).toHaveBeenCalledWith('mt::set-pathname', {
      id: 'tab-1',
      pathname: '/tmp/renamed.md',
      filename: 'renamed.md'
    })

    mocks.dialog.showSaveDialog.mockResolvedValue({ filePath: '/tmp/moved.md', canceled: false })
    await mocks.listeners.get('mt::response-file-move-to')!(events.mainFrameEvent, {
      id: 'tab-1',
      pathname: '/tmp/note.md'
    })
    expect(mocks.fsRename).toHaveBeenCalledWith('/tmp/note.md', '/tmp/moved.md', expect.any(Function))
  })

  it('preserves valid main-frame link and drop behavior', async() => {
    await mocks.listeners.get('mt::format-link-click')!(events.mainFrameEvent, {
      data: { href: 'https://example.com' }
    })
    expect(mocks.shell.openExternal).toHaveBeenCalledWith('https://example.com')

    mocks.isMarkdownFile.mockReturnValueOnce(true)
    await mocks.listeners.get('mt::window::drop')!(events.mainFrameEvent, ['/tmp/note.md'])
    expect(mocks.ipcMain.emit).toHaveBeenCalledWith('app-open-file-by-id', 31, '/resolved/tmp/note.md')
  })

  it('preserves valid main-frame close command behavior', async() => {
    await mocks.listeners.get('mt::cmd-close-window')!(events.mainFrameEvent)
    expect(events.window.close).toHaveBeenCalledOnce()
  })
})
