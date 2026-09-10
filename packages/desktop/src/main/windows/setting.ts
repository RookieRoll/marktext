import path from 'path'
import { BrowserWindow, ipcMain } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import { electronLocalshortcut } from '@hfelix/electron-localshortcut'
import BaseWindow, { WindowLifecycle, WindowType, type EnvLike, type PreferenceLike } from './base'
import type Accessor from '../app/accessor'
import { centerWindowOptions } from './utils'
import { TITLE_BAR_HEIGHT, preferencesWinOptions, isLinux, isOsx } from '../config'
import log from 'electron-log'

class SettingWindow extends BaseWindow {
  private _registeredDevToolsAccelerator: string | null
  private _windowResourcesCleaned: boolean

  /**
   * @param accessor The application accessor for application instances.
   */
  constructor(accessor: Accessor) {
    super(accessor)
    this.type = WindowType.SETTINGS
    this._registeredDevToolsAccelerator = null
    this._windowResourcesCleaned = false
  }

  /**
   * Creates a new setting window.
   *
   * @param category The settings category tab name.
   */
  createWindow(category: string | null = null): BrowserWindow {
    const { menu: appMenu, env, keybindings, preferences } = this._accessor
    const winOptions: BrowserWindowConstructorOptions = Object.assign({}, preferencesWinOptions)
    centerWindowOptions(
      winOptions as BrowserWindowConstructorOptions & {
        width: number
        height: number
        x?: number
        y?: number
      }
    )
    if (isLinux) {
      winOptions.icon = path.join(
        (global as unknown as { __static: string }).__static,
        'logo-96px.png'
      )
    }

    // WORKAROUND: Electron has issues with different DPI per monitor when
    // setting a fixed window size.
    winOptions.resizable = true

    // Enable native or custom/frameless window and titlebar
    const { titleBarStyle, theme } = preferences.getStartupPreferences()
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }

    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme)
    this._registeredDevToolsAccelerator = null
    this._windowResourcesCleaned = false
    let win: BrowserWindow | null = (this.browserWindow = new BrowserWindow(winOptions))

    win.webContents.on('did-fail-load', (_event, code, desc, url) => {
      log.error(`did-fail-load ${code} ${desc} @ ${url}`)
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error(`render-process-gone: ${details.reason} (${details.exitCode})`)
    })

    this.id = win.id

    // Create a menu for the current window
    appMenu.addSettingMenu(win)

    win.once('ready-to-show', () => {
      if (!this._isWindowUsable(win)) return
      this.lifecycle = WindowLifecycle.READY
      this.emit('window-ready')
    })

    win.on('focus', () => {
      if (!this._isWindowUsable(win)) return
      this.emit('window-focus')
      if (this._isWindowUsable(win)) {
        win.webContents.send('mt::window-active-status', { status: true })
      }
    })

    // Lost focus
    win.on('blur', () => {
      if (!this._isWindowUsable(win)) return
      this.emit('window-blur')
      if (this._isWindowUsable(win)) {
        win.webContents.send('mt::window-active-status', { status: false })
      }
    })

    win.on('close', (event) => {
      if (!this._isWindowUsable(win)) return
      this.emit('window-close')

      if (!this._isWindowUsable(win)) return
      event.preventDefault()
      ipcMain.emit('window-close-by-id', win.id)
    })

    // The window is now destroyed. Clear the wrapper reference before
    // notifying WindowManager so no later lifecycle callback can resolve the
    // destroyed BrowserWindow.
    win.on('closed', () => {
      const closedWindow = win
      win = null
      this._finalizeWindowClosed(closedWindow)
    })

    this.lifecycle = WindowLifecycle.LOADING
    win.loadURL(this._buildUrlString(this.id, env, preferences, category))
    win.setSheetOffset(TITLE_BAR_HEIGHT)

    const devToolsAccelerator = keybindings.getAccelerator('view.toggle-dev-tools')
    if (env.debug && devToolsAccelerator) {
      this._registeredDevToolsAccelerator = devToolsAccelerator
      electronLocalshortcut.register(win, devToolsAccelerator, () => {
        if (this._isWindowUsable(win)) {
          win.webContents.toggleDevTools()
        }
      })
    }
    return win
  }

  private _isWindowUsable(
    window: BrowserWindow | null = this.browserWindow
  ): window is BrowserWindow {
    return (
      this.lifecycle !== WindowLifecycle.QUITTED &&
      !!window &&
      window === this.browserWindow &&
      !window.isDestroyed()
    )
  }

  private _finalizeWindowClosed(closedWindow: BrowserWindow | null): void {
    if (this._windowResourcesCleaned) return

    this._windowResourcesCleaned = true
    if (this._registeredDevToolsAccelerator && closedWindow && !closedWindow.isDestroyed()) {
      electronLocalshortcut.unregister(closedWindow, this._registeredDevToolsAccelerator)
    }
    this._registeredDevToolsAccelerator = null

    this.lifecycle = WindowLifecycle.QUITTED
    if (this.browserWindow === closedWindow) {
      this.browserWindow = null
    }
    this.id = null
    this.emit('window-closed')
    this.removeAllListeners()
  }

  override destroy(): void {
    const browserWindow = this.browserWindow
    this._finalizeWindowClosed(browserWindow)
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.destroy()
    }
  }

  protected override _buildUrlString(
    windowId: number | null,
    env: EnvLike,
    userPreference: PreferenceLike,
    category?: string | null
  ): string {
    const url = this._buildUrlWithSettings(windowId, env, userPreference)
    if (category) {
      // Overwrite type to add category name
      url.searchParams.set('type', `${WindowType.SETTINGS}/${category}`)
    }
    return url.toString()
  }
}

export default SettingWindow
