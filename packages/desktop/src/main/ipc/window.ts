import {
  BrowserWindow,
  Menu,
  MenuItem,
  ipcMain,
  type IpcMainEvent,
  type WebContents
} from 'electron'
import log from 'electron-log'
import type { MenuTemplate, MenuTemplateItem, MenuPopupPosition } from '@shared/types/menu'
import { createRendererSenderGuard } from './rendererSender'

const windowFromEvent = (event: IpcMainEvent): BrowserWindow | null =>
  BrowserWindow.fromWebContents(event.sender)

interface PopupEntry {
  sender: WebContents
}
const popups = new Map<number, PopupEntry>()

const rendererSenderGuard = createRendererSenderGuard((sender) =>
  BrowserWindow.fromWebContents(sender)
)

const buildMenu = (template: MenuTemplate | undefined, windowId: number): Menu => {
  const menu = new Menu()
  for (const item of template || []) {
    if (item.type === 'separator') {
      menu.append(new MenuItem({ type: 'separator' }))
      continue
    }
    const id = item.id
    menu.append(
      new MenuItem({
        label: item.label,
        type: item.type as 'normal' | 'submenu' | 'checkbox' | 'radio' | undefined,
        accelerator: item.accelerator,
        enabled: item.enabled !== false,
        checked: !!item.checked,
        click: () => {
          const sender = popups.get(windowId)?.sender
          try {
            sender?.send('mt::menu::click', { windowId, id })
          } catch {
            /* sender destroyed */
          }
        },
        submenu: item.submenu ? buildMenu(item.submenu as MenuTemplateItem[], windowId) : undefined
      })
    )
  }
  return menu
}

export const registerWindowHandlers = (): void => {
  ipcMain.on('mt::win::minimize', (event) => {
    rendererSenderGuard.getWindow(event)?.minimize()
  })
  ipcMain.on('mt::win::toggle-maximize', (event) => {
    const win = rendererSenderGuard.getWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on('mt::win::maximize', (event) => {
    rendererSenderGuard.getWindow(event)?.maximize()
  })
  ipcMain.on('mt::win::unmaximize', (event) => {
    rendererSenderGuard.getWindow(event)?.unmaximize()
  })
  ipcMain.on('mt::win::close', (event) => {
    rendererSenderGuard.getWindow(event)?.close()
  })
  ipcMain.on('mt::win::set-fullscreen', (event, flag: boolean) => {
    rendererSenderGuard.getWindow(event)?.setFullScreen(!!flag)
  })
  ipcMain.on('mt::win::toggle-fullscreen', (event) => {
    const win = rendererSenderGuard.getWindow(event)
    if (win) win.setFullScreen(!win.isFullScreen())
  })
  ipcMain.handle('mt::win::is-maximized', (event) => {
    const win = rendererSenderGuard.assertTrustedRenderer(event)
    return win.isMaximized()
  })
  ipcMain.handle('mt::win::is-fullscreen', (event) => {
    const win = rendererSenderGuard.assertTrustedRenderer(event)
    return win.isFullScreen()
  })

  ipcMain.on('mt::menu::popup', (event, template: MenuTemplate, position?: MenuPopupPosition) => {
    const win = windowFromEvent(event)
    if (!win) return
    // Stash sender BEFORE menu.popup so buildMenu click handlers can resolve
    // it, but make sure we still clean up the map entry if menu.popup throws
    // — otherwise the entry leaks and a later popup for the same window could
    // route clicks to a dead sender.
    popups.set(win.id, { sender: event.sender })
    try {
      const menu = buildMenu(template, win.id)
      menu.popup({
        window: win,
        x: position?.x,
        y: position?.y,
        callback: () => {
          popups.delete(win.id)
          try {
            event.sender.send('mt::menu::closed', { windowId: win.id })
          } catch {
            /* destroyed */
          }
        }
      })
    } catch (err) {
      popups.delete(win.id)
      log.error('menu popup failed:', err)
    }
  })

  ipcMain.on('mt::menu::popup-application', (event, position?: MenuPopupPosition) => {
    const win = windowFromEvent(event)
    if (!win) return
    try {
      const appMenu = Menu.getApplicationMenu()
      if (!appMenu) return
      appMenu.popup({ window: win, x: position?.x, y: position?.y })
    } catch (err) {
      log.error('application menu popup failed:', err)
    }
  })
}
