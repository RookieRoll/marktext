import path from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { BrowserWindowConstructorOptions } from 'electron'
import log from 'electron-log'
import windowStateKeeper from 'electron-window-state'
import { isChildOfDirectory, isSamePathSync } from 'common/filesystem/paths'
import BaseWindow, { WindowLifecycle, WindowType } from './base'
import type Accessor from '../app/accessor'
import { ensureWindowPosition, zoomIn, zoomOut } from './utils'
import { TITLE_BAR_HEIGHT, editorWinOptions, isLinux, isOsx } from '../config'
import { showEditorContextMenu } from '../contextMenu/editor'
import { loadMarkdownFile } from '../filesystem/markdown'
import { switchLanguage } from '../spellchecker'
import fs from 'fs'
import {
  registerAllowedLocalResourceRoot,
  unregisterAllowedLocalResourceRoot
} from '../app/localProtocol'
import { normalizeBufferedState } from '@shared/types/bufferedState'
import type { BootstrapEditorConfig } from '@shared/types/files'

type RawMarkdownDocument = Awaited<ReturnType<typeof loadMarkdownFile>>

// The deferred file/markdown to open before the window finishes loading.
interface PendingFile {
  doc: RawMarkdownDocument
  options: Record<string, unknown>
  selected: boolean
}

interface BufferStoreInfo {
  id: string
  filePath: string | null
}

interface CandidateScore {
  id: number | null
  score: number
}

class EditorWindow extends BaseWindow {
  // Root directory and file list to open when the window is ready.
  private _directoryToOpen: string | null
  private _filesToOpen: PendingFile[] | null
  private _markdownToOpen: string[] | null
  // Root directory and file list that are currently opened. These lists are
  // used to find the best window to open new files in.
  private _openedRootDirectory: string | null
  private _openedFiles: string[] | null

  public bufferStoreInfo: BufferStoreInfo | null
  private _pendingOpenTimer: ReturnType<typeof setTimeout> | null
  private _windowResourcesCleaned: boolean
  // The editor page is a lazily loaded route chunk, so it mounts after
  // `did-finish-load`. Startup payloads are held back until the renderer
  // reports that its editor listeners are registered.
  private _rendererReady: boolean
  private _startupPayloadSent: boolean
  private _bootstrapConfig: BootstrapEditorConfig | null

  /**
   * @param accessor The application accessor for application instances.
   */
  constructor(accessor: Accessor) {
    super(accessor)
    this.type = WindowType.EDITOR

    // Root directory and file list to open when the window is ready.
    this._directoryToOpen = null
    this._filesToOpen = [] // {doc: IMarkdownDocumentRaw, options: any, selected: boolean}
    this._markdownToOpen = [] // List of markdown strings or an empty string will open a new untitled tab

    // Root directory and file list that are currently opened. These lists are
    // used to find the best window to open new files in.
    this._openedRootDirectory = ''
    this._openedFiles = []

    this.bufferStoreInfo = null
    this._pendingOpenTimer = null
    this._windowResourcesCleaned = false
    this._rendererReady = false
    this._startupPayloadSent = false
    this._bootstrapConfig = null
  }

  /**
   * Creates a new editor window.
   */
  createWindow(
    rootDirectory: string | null = null,
    fileList: string[] = [],
    markdownList: string[] = [],
    options: Partial<BrowserWindowConstructorOptions> = {},
    bufferStoreInfo: BufferStoreInfo | null = null
  ): BrowserWindow {
    const { menu: appMenu, env, preferences, editorBufferStore } = this._accessor
    const addBlankTab =
      !bufferStoreInfo && !rootDirectory && fileList.length === 0 && markdownList.length === 0

    const mainWindowState = windowStateKeeper({
      defaultWidth: 1200,
      defaultHeight: 800
    })

    const { x, y, width, height } = ensureWindowPosition(mainWindowState)
    const winOptions: BrowserWindowConstructorOptions = Object.assign(
      { x, y, width, height },
      editorWinOptions,
      options
    )
    if (isLinux) {
      winOptions.icon = path.join(process.cwd(), 'static', 'logo-96px.png')
    }

    const {
      titleBarStyle,
      theme,
      sideBarVisibility,
      restoreLayoutState,
      tabBarVisibility,
      sourceCodeModeEnabled,
      spellcheckerEnabled,
      spellcheckerLanguage
    } = preferences.getStartupPreferences()
    const resolvedSideBarVisibility = restoreLayoutState ? !!sideBarVisibility : false

    // Enable native or custom/frameless window and titlebar
    if (!isOsx) {
      winOptions.titleBarStyle = 'default'
      if (titleBarStyle === 'native') {
        winOptions.frame = true
      }
    }

    winOptions.backgroundColor = this._getPreferredBackgroundColor(theme)
    if (env.disableSpellcheck) {
      // winOptions.webPreferences is set by editorWinOptions spread above
      ;(winOptions.webPreferences as { spellcheck: boolean }).spellcheck = false
    }

    this._windowResourcesCleaned = false
    let win: BrowserWindow | null = (this.browserWindow = new BrowserWindow(winOptions))

    // Give every editor window a stable id for session buffer persistence.
    // We cant use win.id as it might collide with same IDs from closed windows
    this.bufferStoreInfo = {
      id: bufferStoreInfo ? bufferStoreInfo.id : editorBufferStore.getUnUsedBufferUUID(),
      filePath: bufferStoreInfo ? bufferStoreInfo.filePath : null
    }
    ;(win as unknown as { restoreBufferId: string }).restoreBufferId = this.bufferStoreInfo.id

    this.id = win.id

    if (spellcheckerEnabled && !isOsx) {
      try {
        switchLanguage(win, spellcheckerLanguage as string)
      } catch (error) {
        log.error('Unable to set spell checker language on startup:', error)
      }
    }

    // Create a menu for the current window
    appMenu.addEditorMenu(win, { sourceCodeModeEnabled: sourceCodeModeEnabled as boolean })

    win.webContents.on('context-menu', (event, params) => {
      if (!this._isWindowUsable(win)) return
      showEditorContextMenu(win, event, params, preferences.getItem('spellcheckerEnabled'))
    })

    // `did-finish-load` only proves the entry bundle parsed. The editor page is
    // a lazily loaded route chunk, so its startup IPC listeners register later.
    // Sending the bootstrap payload here would drop the sidebar layout and the
    // documents to open. _maybeFlushStartupPayload runs once the renderer
    // reports that its listeners are registered.
    win.webContents.once('did-finish-load', () => {
      if (!this._isWindowUsable(win)) return

      this.lifecycle = WindowLifecycle.READY
      this.emit('window-ready')

      // A ready listener may synchronously close the window. Do not continue
      // touching the BrowserWindow after that lifecycle transition.
      if (!this._isWindowUsable(win)) return

      // Restore and focus window
      this.bringToFront()

      const lineEnding = preferences.getPreferredEol()
      appMenu.updateLineEndingMenu(this.id!, lineEnding)
      this._bootstrapConfig = {
        addBlankTab,
        // Replaced at flush time so markdown queued between did-finish-load and
        // the renderer-ready signal is not dropped.
        markdownList: [],
        lineEnding,
        sideBarVisibility: resolvedSideBarVisibility,
        tabBarVisibility,
        sourceCodeModeEnabled
      }
      this._maybeFlushStartupPayload()

      // Listen on default system mouse zoom event (e.g. Ctrl+MouseWheel on Linux/Windows).
      win.webContents.on('zoom-changed', (_event, zoomDirection) => {
        if (!this._isWindowUsable(win)) return
        if (zoomDirection === 'in') {
          zoomIn(win)
        } else if (zoomDirection === 'out') {
          zoomOut(win)
        }
      })
    })

    win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, url) => {
      log.error(
        `The window failed to load or was cancelled: ${errorCode}; ${errorDescription}; @ ${url}`
      )
    })

    win.webContents.once('render-process-gone', async (_event, { reason }) => {
      if (reason === 'clean-exit') {
        return
      }

      const msg = `The renderer process has crashed unexpected or is killed (${reason}).`
      log.error(msg)

      if (reason === 'abnormal-exit' || !this._isWindowUsable(win)) {
        return
      }

      const crashedWindow = win
      const { response } = await dialog.showMessageBox(crashedWindow, {
        type: 'warning',
        buttons: ['Close', 'Reload', 'Keep It Open'],
        message: 'MarkText has crashed',
        detail: msg
      })

      if (!this._isWindowUsable(crashedWindow)) return
      switch (response) {
        case 0:
          return this.destroy()
        case 1:
          return this.reload()
      }
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
    ;(['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const).forEach(
      (channel) => {
        // Electron's BrowserWindow.on() is heavily overloaded — the union of
        // event names can't be satisfied by a single overload, so we widen.
        ;(win as { on(event: string, listener: () => void): void }).on(channel, () => {
          if (this._isWindowUsable(win)) {
            win.webContents.send(`mt::window-${channel}`)
          }
        })
      }
    )

    // Before closed. We cancel the action and ask the editor further instructions.
    win.on('close', (event) => {
      if (!this._isWindowUsable(win)) return
      this.emit('window-close')

      if (!this._isWindowUsable(win)) return
      event.preventDefault()
      win.webContents.send('mt::ask-for-close')

      // TODO: Close all watchers etc. Should we do this manually or listen to 'quit' event?
    })

    // The window is now destroyed. Clear the wrapper reference before emitting
    // so WindowManager callbacks cannot resolve a destroyed BrowserWindow.
    win.on('closed', () => {
      const closedWindow = win
      win = null
      this._finalizeWindowClosed(closedWindow)
    })

    this.lifecycle = WindowLifecycle.LOADING
    win.loadURL(this._buildUrlString(this.id, env, preferences))
    win.setSheetOffset(TITLE_BAR_HEIGHT)

    mainWindowState.manage(win)

    // Disable application menu shortcuts because we want to handle key bindings ourself.
    win.webContents.setIgnoreMenuShortcuts(true)

    // Delay load files and directories after the current control flow.
    this._pendingOpenTimer = setTimeout(() => {
      this._pendingOpenTimer = null
      if (!this._isWindowUsable()) return
      if (rootDirectory) {
        this.openFolder(rootDirectory)
      }
      if (fileList.length) {
        this.openTabsFromPaths(fileList)
      }
    }, 0)

    return win
  }

  /**
   * Mark the controller as closed and release its owned references before the
   * BrowserWindow is destroyed. WindowManager observes this event while the
   * watcher still owns the live BrowserWindow, so it can stop file events
   * without resolving the wrapper after destruction.
   */
  private _finalizeWindowClosed(closedWindow: BrowserWindow | null): void {
    if (this._windowResourcesCleaned) return

    this._windowResourcesCleaned = true
    if (this._pendingOpenTimer) {
      clearTimeout(this._pendingOpenTimer)
      this._pendingOpenTimer = null
    }

    this._unregisterAllowedLocalResourceRoots()
    this.lifecycle = WindowLifecycle.QUITTED
    if (this.browserWindow === closedWindow) {
      this.browserWindow = null
    }
    this.emit('window-closed')
    this.removeAllListeners()

    this._directoryToOpen = null
    this._filesToOpen = null
    this._rendererReady = false
    this._startupPayloadSent = false
    this._bootstrapConfig = null
    this._markdownToOpen = null
    this._openedRootDirectory = null
    this._openedFiles = null
    this.bufferStoreInfo = null
    this.id = null
  }

  /**
   * Record that the renderer finished registering its startup IPC listeners.
   * The editor page is a lazy route chunk, so this can arrive after
   * `did-finish-load`; flush the held-back bootstrap payload once both sides
   * are ready. Idempotent: a reload re-arms `_rendererReady` before reuse.
   */
  notifyRendererReady(): void {
    if (!this._isWindowUsable()) return
    // Record readiness unconditionally: if this somehow arrives before
    // `did-finish-load`, the bootstrap config is still null here and the
    // did-finish-load handler will flush instead.
    this._rendererReady = true
    this._maybeFlushStartupPayload()
  }

  /**
   * Send the bootstrap payload and the pending documents exactly once, and only
   * after the renderer confirms its listeners exist. Sending earlier drops the
   * sidebar layout and file-open events into a renderer that is not listening.
   */
  private _maybeFlushStartupPayload(): void {
    const { browserWindow } = this
    if (
      !this._bootstrapConfig ||
      !this._rendererReady ||
      this._startupPayloadSent ||
      this.lifecycle !== WindowLifecycle.READY ||
      !this._isWindowUsable(browserWindow)
    ) {
      return
    }

    this._startupPayloadSent = true
    this._bootstrapConfig.markdownList = this.bufferStoreInfo?.filePath
      ? []
      : (this._markdownToOpen ?? [])
    browserWindow.webContents.send('mt::bootstrap-editor', this._bootstrapConfig)

    if (this.bufferStoreInfo?.filePath) {
      this._restoreAllState()
    } else {
      this._doOpenFilesToOpen()
      if (this._markdownToOpen) this._markdownToOpen.length = 0
    }
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

  override destroy(): void {
    const browserWindow = this.browserWindow
    this._finalizeWindowClosed(browserWindow)
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.destroy()
    }
  }

  /**
   * Open a new tab from a markdown file.
   */
  openTab(filePath: string, options: Record<string, unknown> = {}, selected: boolean = true): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return
    this.openTabs([{ filePath, options, selected }])
  }

  /**
   * Open new tabs from the given file paths.
   */
  openTabsFromPaths(filePaths: string[]): void {
    if (!filePaths || filePaths.length === 0) return

    const fileList = filePaths.map((p) => ({ filePath: p, options: {}, selected: false }))
    fileList[0].selected = true
    this.openTabs(fileList)
  }

  /**
   * Open new tabs from markdown files with options for editor window.
   */
  openTabs(
    fileList: { filePath: string; selected: boolean; options: Record<string, unknown> }[]
  ): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    const { browserWindow } = this
    if (!this._isWindowUsable(browserWindow)) return

    const { preferences } = this._accessor
    const eol = preferences.getPreferredEol()
    const { autoGuessEncoding, trimTrailingNewline, autoNormalizeLineEndings } =
      preferences.getAll()

    for (const { filePath, options, selected } of fileList) {
      if (this._openedFiles!.includes(filePath)) {
        // File is already opened - avoid opening it again so we dont have duplicate watchers
        browserWindow!.webContents.send('mt::switch-tab-by-file_path', filePath)
        continue
      }
      loadMarkdownFile(
        filePath,
        eol,
        autoGuessEncoding,
        trimTrailingNewline,
        autoNormalizeLineEndings
      )
        .then((rawDocument) => {
          if (!this._isWindowUsable(browserWindow)) return
          // Queue until the lazily loaded editor page has registered its
          // listeners; sending earlier would drop the document.
          if (this.lifecycle === WindowLifecycle.READY && this._rendererReady) {
            this._doOpenTab(rawDocument, options, selected)
          } else if (this._filesToOpen) {
            this._filesToOpen.push({ doc: rawDocument, options, selected })
          }
        })
        .catch((err: Error) => {
          const { message, stack } = err
          log.error(`[ERROR] Cannot open file or directory: ${message}\n\n${stack}`)
          if (this._isWindowUsable(browserWindow)) {
            browserWindow.webContents.send('mt::show-notification', {
              title: 'Cannot open tab',
              type: 'error',
              message: err.message
            })
          }
        })
    }
  }

  /**
   * Open a new untitled tab optional with a markdown string.
   */
  openUntitledTab(selected: boolean = true, markdown: string = ''): void {
    // TODO: Don't allow new files if quitting.
    if (this.lifecycle === WindowLifecycle.QUITTED) return

    if (this.lifecycle === WindowLifecycle.READY && this._rendererReady) {
      const { browserWindow } = this
      if (this._isWindowUsable(browserWindow)) {
        browserWindow.webContents.send('mt::new-untitled-tab', selected, markdown)
      }
    } else if (this._markdownToOpen) {
      this._markdownToOpen.push(markdown)
    }
  }

  /**
   * Open a (new) directory and replaces the old one.
   */
  openFolder(pathname: string): void {
    // TODO: Don't allow new files if quitting.
    if (
      !pathname ||
      this.lifecycle === WindowLifecycle.QUITTED ||
      isSamePathSync(pathname, this._openedRootDirectory ?? '')
    ) {
      return
    }

    if (this.lifecycle === WindowLifecycle.READY && this._rendererReady) {
      const { browserWindow } = this
      if (!this._isWindowUsable(browserWindow)) return
      const { menu: appMenu, preferences } = this._accessor

      if (this._openedRootDirectory) {
        ipcMain.emit('watcher-unwatch-directory', browserWindow, this._openedRootDirectory)
        unregisterAllowedLocalResourceRoot(this._openedRootDirectory)
      }

      preferences.setItems({ lastOpenedFolder: pathname })
      appMenu.addRecentlyUsedDocument(pathname)
      this._openedRootDirectory = pathname
      registerAllowedLocalResourceRoot(pathname)
      ipcMain.emit('watcher-watch-directory', browserWindow, pathname)
      browserWindow!.webContents.send('mt::open-directory', pathname)
    } else {
      this._directoryToOpen = pathname
    }
  }

  /**
   * Add a new path to the file list and watch the given path.
   */
  addToOpenedFiles(filePath: string): void {
    const { _openedFiles, browserWindow } = this
    if (!this._isWindowUsable(browserWindow) || !_openedFiles) return
    _openedFiles.push(filePath)
    registerAllowedLocalResourceRoot(path.dirname(filePath))
    ipcMain.emit('watcher-watch-file', browserWindow, filePath)
  }

  /**
   * Change a path in the opened file list and update the watcher.
   */
  changeOpenedFilePath(pathname: string, oldPathname: string): void {
    const { _openedFiles, browserWindow } = this
    if (!this._isWindowUsable(browserWindow) || !_openedFiles) return
    const index = _openedFiles.findIndex((p) => p === oldPathname)
    if (index === -1) {
      // The old path was not found but add the new one.
      _openedFiles.push(pathname)
    } else {
      unregisterAllowedLocalResourceRoot(path.dirname(oldPathname))
      _openedFiles[index] = pathname
    }
    registerAllowedLocalResourceRoot(path.dirname(pathname))
    ipcMain.emit('watcher-unwatch-file', browserWindow, oldPathname)
    ipcMain.emit('watcher-watch-file', browserWindow, pathname)
  }

  /**
   * Remove a path from the opened file list and stop watching the path.
   */
  removeFromOpenedFiles(pathname: string): void {
    const { _openedFiles, browserWindow } = this
    if (!this._isWindowUsable(browserWindow) || !_openedFiles) return
    const index = _openedFiles.findIndex((p) => p === pathname)
    if (index !== -1) {
      _openedFiles.splice(index, 1)
      unregisterAllowedLocalResourceRoot(path.dirname(pathname))
    }
    ipcMain.emit('watcher-unwatch-file', browserWindow, pathname)
  }

  /**
   * Returns a score list for a given file list.
   */
  getCandidateScores(fileList: string[]): CandidateScore[] {
    const { _openedFiles, _openedRootDirectory, id } = this
    const buf: CandidateScore[] = []
    for (const pathname of fileList) {
      let score = 0
      if (_openedFiles!.some((p) => p === pathname)) {
        score = -1
      } else {
        if (isChildOfDirectory(_openedRootDirectory ?? '', pathname)) {
          score += 5
        }
        for (const item of _openedFiles!) {
          if (isChildOfDirectory(path.dirname(item), pathname)) {
            score += 1
          }
        }
      }
      buf.push({ id, score })
    }
    return buf
  }

  override reload(): void {
    const { id, browserWindow } = this
    if (!this._isWindowUsable(browserWindow)) return
    this._unregisterAllowedLocalResourceRoots()

    // Close watchers
    ipcMain.emit('watcher-unwatch-all-by-id', id)

    // Reset saved state
    this._directoryToOpen = ''
    this._filesToOpen = []
    this._markdownToOpen = []
    this._openedRootDirectory = ''
    this._openedFiles = []

    // A reload starts a fresh renderer: re-arm the handshake so the bootstrap
    // payload is not delivered before the lazily loaded editor page listens.
    this._rendererReady = false
    this._startupPayloadSent = false
    this._bootstrapConfig = null

    browserWindow!.webContents.once('did-finish-load', () => {
      if (!this._isWindowUsable(browserWindow)) return
      this.lifecycle = WindowLifecycle.READY
      const { preferences } = this._accessor
      const { sideBarVisibility, restoreLayoutState, tabBarVisibility, sourceCodeModeEnabled } =
        preferences.getAll()
      const resolvedSideBarVisibility = restoreLayoutState ? !!sideBarVisibility : false
      const lineEnding = preferences.getPreferredEol()
      this._bootstrapConfig = {
        addBlankTab: true,
        markdownList: [],
        lineEnding,
        sideBarVisibility: resolvedSideBarVisibility,
        // `getAll()` mirrors the open preference schema, so these two are
        // `unknown`; coerce to the boolean contract the renderer expects.
        tabBarVisibility: !!tabBarVisibility,
        sourceCodeModeEnabled: !!sourceCodeModeEnabled
      }
      this._maybeFlushStartupPayload()
    })

    this.lifecycle = WindowLifecycle.LOADING
    super.reload()
  }

  get openedRootDirectory(): string | null {
    return this._openedRootDirectory
  }

  private _unregisterAllowedLocalResourceRoots(): void {
    if (this._openedRootDirectory) {
      unregisterAllowedLocalResourceRoot(this._openedRootDirectory)
    }
    for (const pathname of this._openedFiles ?? []) {
      unregisterAllowedLocalResourceRoot(path.dirname(pathname))
    }
  }

  // --- private ---------------------------------

  /**
   * Open a new new tab from the markdown document.
   */
  private _doOpenTab(
    rawDocument: RawMarkdownDocument,
    options: Record<string, unknown>,
    selected: boolean
  ): void {
    const { _accessor, _openedFiles, browserWindow } = this
    const { menu: appMenu } = _accessor
    const { pathname } = rawDocument

    // Async file reads can finish after the close event. Do not retain the
    // document payload or send IPC through a destroyed renderer in that case.
    if (!this._isWindowUsable(browserWindow) || !_openedFiles || !pathname) return

    // Listen for file changed.
    ipcMain.emit('watcher-watch-file', browserWindow, pathname)

    appMenu.addRecentlyUsedDocument(pathname)
    _openedFiles!.push(pathname)
    registerAllowedLocalResourceRoot(path.dirname(pathname))
    browserWindow!.webContents.send('mt::open-new-tab', rawDocument, options, selected)
  }

  private _doOpenFilesToOpen(): void {
    if (this.lifecycle !== WindowLifecycle.READY || !this._isWindowUsable()) {
      throw new Error('Invalid state.')
    }

    if (this._directoryToOpen) {
      this.openFolder(this._directoryToOpen)
    }
    this._directoryToOpen = null

    for (const { doc, options, selected } of this._filesToOpen ?? []) {
      if (!this._isWindowUsable()) break
      this._doOpenTab(doc, options, selected)
    }
    this._filesToOpen?.splice(0)
  }

  private _restoreAllState(): void {
    if (this.lifecycle !== WindowLifecycle.READY) {
      throw new Error('Invalid state.')
    }
    const { browserWindow, bufferStoreInfo, _accessor } = this
    const { menu: appMenu, preferences } = _accessor

    try {
      const bufferState = normalizeBufferedState(
        JSON.parse(fs.readFileSync(bufferStoreInfo!.filePath!, 'utf-8'))
      )
      if (!bufferState) {
        throw new Error('Invalid editor buffer state.')
      }
      const rootDirectory = bufferState.project?.rootDirectory
      if (rootDirectory) {
        this.openFolder(rootDirectory)
      }

      // We still need to load the files of all opened tabs and check for errors/changed files
      const eol = preferences.getPreferredEol()
      const { autoGuessEncoding, trimTrailingNewline, autoNormalizeLineEndings } =
        preferences.getAll()

      const fileOpenRequests: Promise<void>[] = []
      for (const tab of bufferState.tabs) {
        if (!tab.pathname) {
          continue
        }

        fileOpenRequests.push(
          loadMarkdownFile(
            tab.pathname,
            eol,
            autoGuessEncoding,
            trimTrailingNewline,
            autoNormalizeLineEndings
          )
            .then((rawDocument) => {
              if (!this._isWindowUsable(browserWindow)) return
              if (rawDocument.markdown !== tab.markdown) {
                // File has changed since it was last opened, if it is not saved, we should NOT override the buffer
                if (tab.isSaved) {
                  tab.markdown = rawDocument.markdown
                }
              }

              if (!this._openedFiles!.includes(tab.pathname)) {
                this.addToOpenedFiles(tab.pathname)
                appMenu.addRecentlyUsedDocument(tab.pathname)
              }
            })
            .catch((err: Error) => {
              const { message, stack } = err
              if (!this._isWindowUsable(browserWindow)) return
              tab.isSaved = false // Set to false as base file could not be found, needs saving
              log.error(`[ERROR] Cannot open file: ${message}\n\n${stack}`)
              browserWindow.webContents.send('mt::show-notification', {
                title: `Could not find file ${tab.filename} on disk, please save your work.`,
                type: 'error',
                message: err.message
              })
            })
        )
      }

      Promise.all(fileOpenRequests)
        .then(() => {
          // After all files are loaded, send the state only while this window is
          // still live. Closing during restore must not resurrect a renderer
          // reference or deliver stale tabs to another window.
          if (!this._isWindowUsable(browserWindow)) return
          browserWindow.webContents.send('mt::load-state', bufferState)
        })
        .catch((err: Error) => {
          if (!this._isWindowUsable(browserWindow)) return
          log.error('Failed to load files for restoring editor state:', err)
          browserWindow.webContents.send('mt::show-notification', {
            title: 'Failed to restore buffered state',
            type: 'error',
            message: err.message
          })
        })
    } catch (e) {
      log.error('Failed to restore editor state:', e)
    }
  }
}

export default EditorWindow
