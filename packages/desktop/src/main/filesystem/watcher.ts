import path from 'path'
import fsPromises from 'fs/promises'
import log from 'electron-log'
import chokidar, { type FSWatcher } from 'chokidar'
import { exists } from 'common/filesystem'
import { hasMarkdownExtension, checkPathExcludePattern } from 'common/filesystem/paths'
import { getUniqueId } from '../utils'
import { loadMarkdownFile } from '../filesystem/markdown'
import { isLinux, isOsx } from '../config'
import type { BrowserWindow } from 'electron'
import type { LineEnding } from '@shared/types/files'
import type Preference from '../preferences'

// TODO(refactor): Please see GH#1035.

export const WATCHER_STABILITY_THRESHOLD = 1000
export const WATCHER_STABILITY_POLL_INTERVAL = 150

const EVENT_NAME = {
  dir: 'mt::update-object-tree' as const,
  file: 'mt::update-file' as const
}

type WatchType = 'dir' | 'file'
type IsDisposed = () => boolean

const sendToWindow = (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  channel: string,
  ...args: unknown[]
): void => {
  if (isDisposed() || win.isDestroyed()) return

  try {
    win.webContents.send(channel, ...args)
  } catch (error) {
    log.error(`Failed to send watcher event on "${channel}":`, error)
  }
}

interface IgnoreEntry {
  windowId: number
  pathname: string
  duration: number
  start: Date
}

interface WatcherEntry {
  win: BrowserWindow
  watcher: FSWatcher
  pathname: string
  type: WatchType
  close: () => void
}

export interface TreeEntryMetadata {
  pathname: string
  name: string
  isDirectory: boolean
  isFile: boolean
  isMarkdown: boolean
  birthTime: Date
  mtimeMs: number
}

const readTreeEntryMetadata = async (
  pathname: string,
  isDirectory: boolean
): Promise<TreeEntryMetadata | null> => {
  try {
    const stats = await fsPromises.stat(pathname)
    return {
      pathname,
      name: path.basename(pathname),
      isDirectory,
      isFile: !isDirectory,
      isMarkdown: !isDirectory && hasMarkdownExtension(pathname),
      birthTime: stats.birthtime,
      mtimeMs: stats.mtimeMs
    }
  } catch {
    // A file or directory can be removed immediately after chokidar emits it.
    return null
  }
}

const add = async (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  pathname: string,
  type: WatchType,
  endOfLine: LineEnding,
  autoGuessEncoding: boolean,
  trimTrailingNewline: number,
  autoNormalizeLineEndings: boolean,
  options: { includeContent?: boolean } = {}
): Promise<void> => {
  const metadata = await readTreeEntryMetadata(pathname, false)
  if (!metadata || isDisposed()) return

  const { isMarkdown } = metadata
  const file: TreeEntryMetadata & {
    data?: Awaited<ReturnType<typeof loadMarkdownFile>>
  } = metadata

  if (isMarkdown) {
    if (options.includeContent !== false) {
      // HACK: But this should be removed completely in #1034/#1035.
      try {
        const data = await loadMarkdownFile(
          pathname,
          endOfLine,
          autoGuessEncoding,
          trimTrailingNewline,
          autoNormalizeLineEndings
        )
        file.data = data
      } catch (err) {
        // Only notify user about opened files.
        if (type === 'file') {
          sendToWindow(win, isDisposed, 'mt::show-notification', {
            title: 'Watcher I/O error',
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
          return
        }
      }
    }

    sendToWindow(win, isDisposed, EVENT_NAME[type], {
      type: 'add',
      change: file
    })
  }
}

const unlink = (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  pathname: string,
  type: WatchType
): void => {
  const file = { pathname }
  sendToWindow(win, isDisposed, EVENT_NAME[type], {
    type: 'unlink',
    change: file
  })
}

const change = async (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  pathname: string,
  type: WatchType,
  endOfLine: LineEnding,
  autoGuessEncoding: boolean,
  trimTrailingNewline: number,
  autoNormalizeLineEndings: boolean
): Promise<void> => {
  if (type === 'dir') {
    // Only send mtimeMs so the sidebar can re-sort; skip loading file content.
    try {
      const stats = await fsPromises.stat(pathname)
      sendToWindow(win, isDisposed, 'mt::update-object-tree', {
        type: 'change',
        change: { pathname, mtimeMs: stats.mtimeMs }
      })
    } catch {
      // File may have been deleted between the event and the stat; ignore.
    }
    return
  }

  const isMarkdown = hasMarkdownExtension(pathname)
  if (isMarkdown) {
    try {
      const [data, stats] = await Promise.all([
        loadMarkdownFile(
          pathname,
          endOfLine,
          autoGuessEncoding,
          trimTrailingNewline,
          autoNormalizeLineEndings
        ),
        fsPromises.stat(pathname)
      ])
      const file = { pathname, data, mtimeMs: stats.mtimeMs }
      sendToWindow(win, isDisposed, 'mt::update-file', {
        type: 'change',
        change: file
      })
    } catch (err) {
      if (type === 'file') {
        sendToWindow(win, isDisposed, 'mt::show-notification', {
          title: 'Watcher I/O error',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }
}

const addDir = (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  pathname: string,
  type: WatchType
): void => {
  if (type === 'file') return

  const directory = {
    pathname,
    name: path.basename(pathname),
    isCollapsed: true,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }

  sendToWindow(win, isDisposed, 'mt::update-object-tree', {
    type: 'addDir',
    change: directory
  })
}

const unlinkDir = (
  win: BrowserWindow,
  isDisposed: IsDisposed,
  pathname: string,
  type: WatchType
): void => {
  if (type === 'file') return

  const directory = { pathname }
  sendToWindow(win, isDisposed, 'mt::update-object-tree', {
    type: 'unlinkDir',
    change: directory
  })
}

class Watcher {
  private _preferences: Preference
  private _ignoreChangeEvents: IgnoreEntry[]
  watchers: Record<string, WatcherEntry>

  constructor(preferences: Preference) {
    this._preferences = preferences
    this._ignoreChangeEvents = []
    this.watchers = {}
  }

  watch(win: BrowserWindow, watchPath: string, type: WatchType = 'dir'): () => void {
    const usePolling = isOsx ? true : this._preferences.getItem<boolean>('watcherUsePolling')

    const id = getUniqueId()

    const watcher = chokidar.watch(watchPath, {
      ignored: (pathname: string, fileInfo?: { isDirectory: () => boolean }) => {
        if (!fileInfo) {
          return /(?:^|[/\\])(?:node_modules|(?:.+\.asar))/.test(pathname)
        }

        if (/(?:^|[/\\])(?:node_modules|(?:.+\.asar))/.test(pathname)) {
          return true
        }

        if (
          checkPathExcludePattern(
            pathname,
            this._preferences.getItem<readonly string[]>('treePathExcludePatterns')
          )
        ) {
          return true
        }
        if (fileInfo.isDirectory()) {
          return false
        }
        return !hasMarkdownExtension(pathname)
      },
      ignoreInitial: type === 'file',
      persistent: true,
      ignorePermissionErrors: true,

      depth: type === 'file' ? (isOsx ? 1 : 0) : undefined,

      // Defer events until writes settle only for the file watcher, which
      // reloads file CONTENT on change and would otherwise read a partial file
      // (GH#1043). The directory watcher just lists nodes and re-sorts by mtime,
      // so deferring its `add` events only made new files appear in the sidebar
      // ~1s late (GH#3955).
      ...(type === 'file'
        ? {
            awaitWriteFinish: {
              stabilityThreshold: WATCHER_STABILITY_THRESHOLD,
              pollInterval: WATCHER_STABILITY_POLL_INTERVAL
            }
          }
        : {}),

      usePolling
      // chokidar's `ignored` callback signature varies between versions; this options
      // bag works at runtime but defies the bundled type.
    } as unknown as Parameters<typeof chokidar.watch>[1])

    let disposed = false
    let enospcReached = false
    let renameTimer: NodeJS.Timeout | null = null
    const preferences = this._preferences

    // Initial directory discovery is batched. chokidar emits one add/addDir
    // event per entry before `ready`, so sending each entry individually made
    // project-open cost scale with node count. Collect metadata only (never
    // file content) and deliver a single snapshot once the scan has settled.
    const initialEntries: TreeEntryMetadata[] = []
    const pendingInitialReads = new Set<Promise<unknown>>()
    const deferredInitialEvents: Array<{
      type: 'unlink' | 'unlinkDir' | 'change'
      pathname: string
    }> = []
    let readyReceived = type === 'file'
    let initialScanComplete = type === 'file'

    function flushInitialSnapshot(): void {
      if (disposed || initialScanComplete || !readyReceived || pendingInitialReads.size > 0) {
        return
      }
      initialScanComplete = true
      // Send a copy: the collected array is truncated below, and IPC consumers
      // must never observe a buffer that is still being mutated.
      sendToWindow(win, () => disposed, 'mt::update-object-tree', {
        type: 'snapshot',
        change: { pathname: watchPath, entries: initialEntries.slice() }
      })
      initialEntries.length = 0
      const deferred = deferredInitialEvents.splice(0)
      for (const event of deferred) {
        if (event.type === 'unlink') {
          unlink(win, () => disposed, event.pathname, type)
        } else if (event.type === 'unlinkDir') {
          unlinkDir(win, () => disposed, event.pathname, type)
        } else {
          const {
            autoGuessEncoding = true,
            trimTrailingNewline = 2,
            autoNormalizeLineEndings = false
          } = preferences.getAll()
          void change(
            win,
            () => disposed,
            event.pathname,
            type,
            preferences.getPreferredEol() as LineEnding,
            autoGuessEncoding,
            trimTrailingNewline,
            autoNormalizeLineEndings
          ).catch((error: unknown) => {
            log.error('Watcher deferred change replay failed:', error)
          })
        }
      }
    }

    function collectInitialEntry(pathname: string, isDirectory: boolean): void {
      const task = readTreeEntryMetadata(pathname, isDirectory).then((metadata) => {
        if (metadata) initialEntries.push(metadata)
      })
      pendingInitialReads.add(task)
      void task
        .catch((error: unknown) => {
          log.error('Watcher initial scan callback failed:', error)
        })
        .finally(() => {
          pendingInitialReads.delete(task)
          flushInitialSnapshot()
        })
    }

    watcher
      .on('ready', () => {
        readyReceived = true
        flushInitialSnapshot()
      })
      .on('add', (pathname: string) => {
        if (!initialScanComplete) {
          collectInitialEntry(pathname, false)
          return
        }
        void (async () => {
          if (disposed) return
          if (!(await this._shouldIgnoreEvent(win.id, pathname, type, usePolling))) {
            const { _preferences } = this
            const eol = _preferences.getPreferredEol() as LineEnding
            const {
              autoGuessEncoding = true,
              trimTrailingNewline = 2,
              autoNormalizeLineEndings = false
            } = _preferences.getAll()
            await add(
              win,
              () => disposed,
              pathname,
              type,
              eol,
              autoGuessEncoding,
              trimTrailingNewline,
              autoNormalizeLineEndings
            )
          }
        })().catch((error: unknown) => {
          log.error('Watcher add callback failed:', error)
        })
      })
      .on('change', (pathname: string) => {
        if (!initialScanComplete) {
          deferredInitialEvents.push({ type: 'change', pathname })
          return
        }
        void (async () => {
          if (disposed) return
          if (!(await this._shouldIgnoreEvent(win.id, pathname, type, usePolling))) {
            const { _preferences } = this
            const eol = _preferences.getPreferredEol() as LineEnding
            const {
              autoGuessEncoding = true,
              trimTrailingNewline = 2,
              autoNormalizeLineEndings = false
            } = _preferences.getAll()
            await change(
              win,
              () => disposed,
              pathname,
              type,
              eol,
              autoGuessEncoding,
              trimTrailingNewline,
              autoNormalizeLineEndings
            )
          }
        })().catch((error: unknown) => {
          log.error('Watcher change callback failed:', error)
        })
      })
      .on('unlink', (pathname: string) => {
        if (!initialScanComplete) {
          deferredInitialEvents.push({ type: 'unlink', pathname })
          return
        }
        unlink(win, () => disposed, pathname, type)
      })
      .on('addDir', (pathname: string) => {
        if (!initialScanComplete) {
          collectInitialEntry(pathname, true)
          return
        }
        addDir(win, () => disposed, pathname, type)
      })
      .on('unlinkDir', (pathname: string) => {
        if (!initialScanComplete) {
          deferredInitialEvents.push({ type: 'unlinkDir', pathname })
          return
        }
        unlinkDir(win, () => disposed, pathname, type)
      })
      .on('raw', (event: string, subpath: string, details: unknown) => {
        if (globalThis.MARKTEXT_DEBUG_VERBOSE >= 3) {
          console.log('watcher: ', event, subpath, details)
        }

        // Fix atomic rename on Linux (chokidar#591).
        if (isLinux && type === 'file' && event === 'rename') {
          if (renameTimer) {
            clearTimeout(renameTimer)
          }
          renameTimer = setTimeout(() => {
            renameTimer = null
            void (async () => {
              if (disposed) return

              const fileExists = await exists(watchPath)
              if (disposed) return

              if (fileExists) {
                watcher.unwatch(watchPath)
                watcher.add(watchPath)
              }
            })().catch((error: unknown) => {
              log.error('Watcher rename repair failed:', error)
            })
          }, 150)
        }
      })
      .on('error', (error: unknown) => {
        const code = (error as NodeJS.ErrnoException)?.code
        if (code === 'ENOSPC') {
          if (!enospcReached) {
            enospcReached = true
            log.warn('inotify limit reached: Too many file descriptors are opened.')

            sendToWindow(win, () => disposed, 'mt::show-notification', {
              title: 'inotify limit reached',
              type: 'warning',
              message:
                'Cannot watch all files and file changes because too many file descriptors are opened.'
            })
          }
        } else {
          log.error('Error while watching files:', error)
        }
      })

    const closeFn = (): void => {
      if (disposed) return

      disposed = true
      if (this.watchers[id]) {
        delete this.watchers[id]
      }
      if (renameTimer) {
        clearTimeout(renameTimer)
        renameTimer = null
      }
      try {
        void Promise.resolve(watcher.close()).catch((error: unknown) => {
          log.error('Watcher close failed:', error)
        })
      } catch (error) {
        log.error('Watcher close failed:', error)
      }
    }

    this.watchers[id] = {
      win,
      watcher,
      pathname: watchPath,
      type,
      close: closeFn
    }

    return closeFn
  }

  unwatch(win: BrowserWindow, watchPath: string, type: WatchType = 'dir'): void {
    for (const id of Object.keys(this.watchers)) {
      const w = this.watchers[id]
      if (w.win === win && w.pathname === watchPath && w.type === type) {
        w.close()
        break
      }
    }
  }

  unwatchByWindowId(windowId: number): void {
    Object.values(this.watchers).forEach((w) => {
      if (w.win.id === windowId) {
        w.close()
      }
    })
  }

  close(): void {
    Object.keys(this.watchers).forEach((id) => this.watchers[id].close())
    this.watchers = {}
    this._ignoreChangeEvents = []
  }

  /**
   * Ignore the next changed event within a certain time for the current file
   * and window. Only valid for files and "add"/"change" events.
   */
  ignoreChangedEvent(
    windowId: number,
    pathname: string,
    duration: number = WATCHER_STABILITY_THRESHOLD + WATCHER_STABILITY_POLL_INTERVAL * 2
  ): void {
    this._ignoreChangeEvents.push({ windowId, pathname, duration, start: new Date() })
  }

  /**
   * Check whether we should ignore the current event because the file may be
   * changed from MarkText itself.
   */
  async _shouldIgnoreEvent(
    winId: number,
    pathname: string,
    type: WatchType,
    usePolling: boolean
  ): Promise<boolean> {
    if (type === 'file') {
      const { _ignoreChangeEvents } = this
      const currentTime = new Date()
      for (let i = 0; i < _ignoreChangeEvents.length; ++i) {
        const { windowId, pathname: pathToIgnore, start, duration } = _ignoreChangeEvents[i]
        if (windowId === winId && pathToIgnore === pathname) {
          _ignoreChangeEvents.splice(i, 1)
          --i

          // Modification origin is the editor and we should ignore the event.
          if (currentTime.getTime() - start.getTime() < duration) {
            return true
          }

          // Try to catch cloud drives that emit the change event not
          // immediately or re-sync the change (GH#3044).
          if (!usePolling) {
            try {
              const fileInfo = await fsPromises.stat(pathname)
              if (fileInfo.mtime.getTime() - start.getTime() < duration) {
                if (globalThis.MARKTEXT_DEBUG_VERBOSE >= 3) {
                  console.log(
                    `Ignoring file event after "stat": current="${currentTime.toISOString()}", start="${start.toISOString()}", file="${fileInfo.mtime.toISOString()}".`
                  )
                }
                return true
              }
            } catch (error) {
              console.error('Failed to "stat" file to determine modification time:', error)
            }
          }
        }
      }
    }
    return false
  }
}

export default Watcher
