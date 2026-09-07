import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RendererIpcEvent } from '../../../src/main/ipc/rendererSender'

type RegisteredHandler = (event: RendererIpcEvent, ...args: unknown[]) => unknown

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, RegisteredHandler>()
  const updateFormatMenu = vi.fn()
  const updateSidebarMenu = vi.fn()
  const updateSelectionMenus = vi.fn()
  const viewLayoutChanged = vi.fn()

  return {
    listeners,
    updateFormatMenu,
    updateSidebarMenu,
    updateSelectionMenus,
    viewLayoutChanged,
    fromWebContents: vi.fn(),
    ipcMain: {
      on: vi.fn((channel: string, handler: RegisteredHandler) => {
        listeners.set(channel, handler)
      })
    },
    configureMenu: vi.fn(),
    configSettingMenu: vi.fn(),
    onInternalChannel: vi.fn(),
    addRecentDocument: vi.fn(),
    clearRecentDocuments: vi.fn()
  }
})

vi.mock('electron', () => ({
  app: {
    addRecentDocument: mocks.addRecentDocument,
    clearRecentDocuments: mocks.clearRecentDocuments
  },
  BrowserWindow: { fromWebContents: mocks.fromWebContents },
  ipcMain: mocks.ipcMain,
  Menu: {
    buildFromTemplate: vi.fn(),
    getApplicationMenu: vi.fn(),
    setApplicationMenu: vi.fn()
  }
}))
vi.mock('electron-log', () => ({ default: { error: vi.fn(), info: vi.fn() } }))
vi.mock('common/filesystem', () => ({
  ensureDirSync: vi.fn(),
  isDirectory2: vi.fn(() => false),
  isFile2: vi.fn(() => false)
}))
vi.mock('main_renderer/config', () => ({ isLinux: false, isOsx: false, isWindows: false }))
vi.mock('main_renderer/menu/actions/edit', () => ({ updateSidebarMenu: mocks.updateSidebarMenu }))
vi.mock('main_renderer/menu/actions/format', () => ({ updateFormatMenu: mocks.updateFormatMenu }))
vi.mock('main_renderer/menu/actions/paragraph', () => ({
  updateSelectionMenus: mocks.updateSelectionMenus
}))
vi.mock('main_renderer/menu/actions/view', () => ({ viewLayoutChanged: mocks.viewLayoutChanged }))
vi.mock('main_renderer/utils/internalIpc', () => ({ onInternalChannel: mocks.onInternalChannel }))
vi.mock('main_renderer/menu/templates', () => ({
  default: mocks.configureMenu,
  configSettingMenu: mocks.configSettingMenu
}))
vi.mock('main_renderer/i18n.js', () => ({ setLanguage: vi.fn() }))

const { default: AppMenu } = await import('main_renderer/menu')

const mainFrame = {} as WebFrameMain
const childFrame = {} as WebFrameMain
const sender = { mainFrame } as WebContents
const unknownSender = { mainFrame } as WebContents
const window = { id: 42 } as BrowserWindow

const events = {
  childFrameEvent: { sender, senderFrame: childFrame } as RendererIpcEvent,
  mainFrameEvent: { sender, senderFrame: mainFrame } as RendererIpcEvent,
  unknownEvent: { sender: unknownSender, senderFrame: mainFrame } as RendererIpcEvent
}

const registerHandlers = () => {
  const menuItems = {
    paragraphMenuEntry: { submenu: { items: [{ enabled: true }] } },
    formatMenuItem: { submenu: { items: [{ enabled: true }] } }
  }
  const menu = {
    getMenuItemById: vi.fn((id: keyof typeof menuItems) => menuItems[id])
  }
  const target = {
    addRecentlyUsedDocument: vi.fn(),
    updateLineEndingMenu: vi.fn(),
    has: vi.fn((windowId: number) => windowId === window.id),
    getWindowMenuById: vi.fn((windowId: number) => {
      if (windowId !== window.id) throw new Error(`Unexpected window id: ${windowId}`)
      return menu
    }),
    clearRecentlyUsedDocuments: vi.fn(),
    updateAppMenu: vi.fn(),
    updateAutoSaveMenu: vi.fn()
  }

  Reflect.apply(AppMenu.prototype._listenForIpcMain, target, [])
  return { menu, menuItems, target }
}

describe('AppMenu renderer IPC sender guard', () => {
  beforeEach(() => {
    mocks.listeners.clear()
    mocks.ipcMain.on.mockClear()
    mocks.fromWebContents.mockReset()
    mocks.updateFormatMenu.mockClear()
    mocks.updateSidebarMenu.mockClear()
    mocks.updateSelectionMenus.mockClear()
    mocks.viewLayoutChanged.mockClear()
  })

  it('registers renderer-facing menu handlers and rejects unknown/child senders', () => {
    mocks.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === sender ? window : null
    )
    const { target } = registerHandlers()

    const invalidEvents = [events.unknownEvent, events.childFrameEvent]
    for (const event of invalidEvents) {
      mocks.listeners.get('mt::add-recently-used-document')!(event, '/tmp/note.md')
      mocks.listeners.get('mt::update-line-ending-menu')!(event, 999, 'lf')
      mocks.listeners.get('mt::update-format-menu')!(event, 999, { strong: true })
      mocks.listeners.get('mt::update-sidebar-menu')!(event, 999, true)
      mocks.listeners.get('mt::view-layout-changed')!(event, 999, { sourceCode: true })
      mocks.listeners.get('mt::editor-selection-changed')!(event, 999, { affiliation: {} })
      mocks.listeners.get('mt::set-editor-format-menus-enabled')!(event, 999, false)
    }

    expect(target.addRecentlyUsedDocument).not.toHaveBeenCalled()
    expect(target.updateLineEndingMenu).not.toHaveBeenCalled()
    expect(target.has).not.toHaveBeenCalled()
    expect(target.getWindowMenuById).not.toHaveBeenCalled()
    expect(mocks.updateFormatMenu).not.toHaveBeenCalled()
    expect(mocks.updateSidebarMenu).not.toHaveBeenCalled()
    expect(mocks.viewLayoutChanged).not.toHaveBeenCalled()
    expect(mocks.updateSelectionMenus).not.toHaveBeenCalled()
  })

  it('uses the trusted sender window instead of a renderer-supplied window id', () => {
    mocks.fromWebContents.mockImplementation((candidate: WebContents) =>
      candidate === sender ? window : null
    )
    const { menu, menuItems, target } = registerHandlers()
    const forgedWindowId = 999

    mocks.listeners.get('mt::add-recently-used-document')!(events.mainFrameEvent, '/tmp/note.md')
    mocks.listeners.get('mt::update-line-ending-menu')!(events.mainFrameEvent, forgedWindowId, 'crlf')
    mocks.listeners.get('mt::update-format-menu')!(events.mainFrameEvent, forgedWindowId, {
      strong: true
    })
    mocks.listeners.get('mt::update-sidebar-menu')!(events.mainFrameEvent, forgedWindowId, true)
    mocks.listeners.get('mt::view-layout-changed')!(events.mainFrameEvent, forgedWindowId, {
      sourceCode: true
    })
    mocks.listeners.get('mt::editor-selection-changed')!(
      events.mainFrameEvent,
      forgedWindowId,
      { affiliation: {} }
    )
    mocks.listeners.get('mt::set-editor-format-menus-enabled')!(
      events.mainFrameEvent,
      forgedWindowId,
      false
    )

    expect(target.addRecentlyUsedDocument).toHaveBeenCalledWith('/tmp/note.md')
    expect(target.updateLineEndingMenu).toHaveBeenCalledWith(window.id, 'crlf')
    expect(target.has).toHaveBeenCalled()
    expect(target.has.mock.calls.every(([windowId]) => windowId === window.id)).toBe(true)
    expect(target.getWindowMenuById).toHaveBeenCalledTimes(5)
    expect(target.getWindowMenuById).toHaveBeenCalledWith(window.id)
    expect(mocks.updateFormatMenu).toHaveBeenCalledWith(menu, { strong: true })
    expect(mocks.updateSidebarMenu).toHaveBeenCalledWith(menu, true)
    expect(mocks.viewLayoutChanged).toHaveBeenCalledWith(menu, { sourceCode: true })
    expect(mocks.updateSelectionMenus).toHaveBeenCalledWith(menu, { affiliation: {} })
    expect(menuItems.paragraphMenuEntry.submenu.items[0].enabled).toBe(false)
    expect(menuItems.formatMenuItem.submenu.items[0].enabled).toBe(false)
  })
})
