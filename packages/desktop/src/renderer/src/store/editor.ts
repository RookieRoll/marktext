import { getCurrentWindowId } from '@/platform/window'
import { setDocumentDirectory } from '@/platform/runtime'
import equal from 'deep-equal'
import bus from '../bus'
import { getUniqueId, deepClone } from '../util'
import listToTree, { type ListItem, type TreeNode } from '../util/listToTree'
import {
  createDocumentState,
  getOptionsFromState,
  getBlankFileState,
  defaultFileState,
  calculateWordCount
} from './help'
import {
  createSaveAsPayload,
  createSaveSnapshot,
  createUnsavedFilePayload,
  getDefaultPath
} from './editor/documentPersistence'
import type { UnsavedFilePayload } from './editor/types'
import type { Cleanup } from './editor/ipcSynchronization'
import type { IpcMainEventChannels } from '@shared/types/ipc'
import { registerEditorIpcListeners } from './editor/ipcSynchronization'
import {
  buildUnsavedFilePayloads,
  createSaveCloseWorkflow,
  type SaveCloseEffects
} from './editor/saveCloseWorkflow'
import type { SaveCloseDecision } from './editor/saveCloseWorkflow'
import {
  buildTabIndex,
  cycleTabIndex,
  exchangeTabs,
  findTabByPath,
  selectTabAfterClose
} from './editor/tabLifecycle'
import notice from '../services/notification'
import {
  FileEncodingCommand,
  LineEndingCommand,
  QuickOpenCommand,
  TrailingNewlineCommand
} from '../commands'
import { defineStore } from 'pinia'
import { usePreferencesStore } from './preferences'
import { useProjectStore } from './project'
import { useLayoutStore } from './layout'
import { useMainStore } from '.'
import { t } from '../i18n'
import { debouncedSendBufferedState, sendBufferedState } from './bufferedState'
import type {
  IFileState,
  FileNotification,
  LineEnding,
  MarkdownDocument,
  PageOptions,
  TabOptions
} from '@shared/types/files'
import type {
  BufferedEditorState,
  BufferedRestoreWarning,
  BufferedTabState
} from '@shared/types/bufferedState'
import { getFileSystemBridge } from '@/platform/filesystem'
import { getPathBridge } from '@/platform/path'
import {
  getClipboardBridge,
  getIpcRenderer,
  getShellBridge,
  getWebFrameBridge
} from '@/platform/electron'

// ----------------------------------------------------------------------------
// Local helper types
// ----------------------------------------------------------------------------

interface TocItem extends ListItem {
  slug?: string
  githubSlug?: string
  content?: string
  lvl: number | null
}

type TocTreeNode = TreeNode<TocItem>

interface RestoreWarning {
  tabId?: string | null
  pathname?: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
}

interface PushTabNotificationPayload {
  tabId: string
  msg: string
  showConfirm?: boolean
  style?: string
  exclusiveType?: string
  action?: FileNotification['action']
}

interface FileChangePayload {
  pathname: string
  data: {
    isMixedLineEndings?: boolean
    lineEnding?: LineEnding | string
    adjustLineEndingOnSave?: boolean
    trimTrailingNewline?: number
    encoding?: IFileState['encoding']
    markdown: string
    filename: string
  }
}

interface FormatLinkClickPayload {
  // muya's getLinkInfo yields `href: null` when the rendered link carries no
  // usable href (e.g. an unsupported protocol stripped by sanitizeHyperlink).
  data: { href: string | null; [key: string]: unknown }
  dirname: string
}

interface ExportPayload {
  type: string
  content?: string
  pageOptions?: PageOptions
}

interface AutoSavePayload {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: ReturnType<typeof getOptionsFromState>
}

interface ContentChangePayload {
  id: string
  markdown: string
  wordCount?: IFileState['wordCount']
  cursor?: unknown
  muyaIndexCursor?: unknown
  history?: IFileState['history']
  toc?: TocItem[]
  blocks?: unknown
}

interface AffiliationEntry {
  type: string
  functionType?: string
  listType?: string
  listItemType?: string
  isLooseListItem?: boolean
  [key: string]: unknown
}

interface SelectionChange {
  start: {
    key: string
    offset: number
    block?: { text?: string; functionType?: string }
    type?: string
  }
  end: { key: string; offset: number; block?: { functionType?: string }; type?: string }
  affiliation?: AffiliationEntry[]
  hasFrontMatter?: boolean
}

interface SelectionFormat {
  type: string
  [key: string]: unknown
}

// ----------------------------------------------------------------------------
// State shape
// ----------------------------------------------------------------------------

export interface EditorState {
  currentFile: IFileState | null
  tabs: IFileState[]
  tabIdToIndex: Record<string, number>
  listToc: TocItem[]
  toc: TocTreeNode[]
}

const autoSaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const editorRuntimeTimers = new Set<ReturnType<typeof setTimeout>>()
const editorRuntimeCleanups = new Set<Cleanup>()

const scheduleEditorRuntimeTimer = (callback: () => void, delay: number): void => {
  const timer = setTimeout(() => {
    editorRuntimeTimers.delete(timer)
    callback()
  }, delay)
  editorRuntimeTimers.add(timer)
}

const registerEditorBusListener = (event: string, handler: (...args: any[]) => void): Cleanup => {
  bus.on(event, handler)
  const cleanup = () => bus.off(event, handler)
  editorRuntimeCleanups.add(cleanup)
  return cleanup
}

type SaveRequestChannel = 'mt::response-file-save' | 'mt::response-file-save-as'

const clearAutoSaveTimer = (id: string): void => {
  const timer = autoSaveTimers.get(id)
  if (timer) clearTimeout(timer)
  autoSaveTimers.delete(id)
}

/** Release renderer-window timers while preserving the durable recovery buffer. */
export const disposeEditorStoreRuntime = (): void => {
  for (const id of autoSaveTimers.keys()) clearAutoSaveTimer(id)
  for (const timer of editorRuntimeTimers) clearTimeout(timer)
  editorRuntimeTimers.clear()
  for (const cleanup of editorRuntimeCleanups) cleanup()
  editorRuntimeCleanups.clear()
}

const sendSaveSnapshot = (
  channel: SaveRequestChannel,
  snapshot: ReturnType<typeof createSaveSnapshot>
): void => {
  if (!snapshot.id) return

  getIpcRenderer().send(
    channel,
    snapshot.id,
    snapshot.filename,
    snapshot.pathname,
    snapshot.markdown,
    deepClone(snapshot.options),
    snapshot.defaultPath
  )
}

const getProjectDefaultPath = (): string => getDefaultPath(useProjectStore().projectTree)

const activateFileInEditor = (fileState: IFileState): void => {
  const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } = fileState
  setDocumentDirectory(pathname ? getPathBridge().dirname(pathname) : '')
  bus.emit('file-changed', {
    id,
    markdown,
    cursor,
    muyaIndexCursor,
    renderCursor: true,
    history,
    scrollTop,
    blocks
  })
}

const registerEditorIpc = <K extends keyof IpcMainEventChannels>(
  channel: K,
  handler: (event: unknown, ...args: IpcMainEventChannels[K]) => void
): Cleanup => {
  const registeredCleanup = getIpcRenderer().on(channel, handler)
  const cleanup: Cleanup =
    typeof registeredCleanup === 'function' ? registeredCleanup : () => undefined
  editorRuntimeCleanups.add(cleanup)
  return cleanup
}

const createSaveCloseEffects = (): SaveCloseEffects => {
  const store = useEditorStore()

  const readCurrentFile = (fileId: string) =>
    fileId === store.currentFile?.id
      ? store.currentFile
      : (store.tabs.find((tab) => tab.id === fileId) ?? null)

  const confirmClose = (files: readonly UnsavedFilePayload[]): SaveCloseDecision => {
    getIpcRenderer().send('mt::close-window-confirm', deepClone([...files]))
    return 'save'
  }

  return {
    flushActiveEditor: () => {
      store.flushActiveEditor()
    },
    readFile: readCurrentFile,
    requestSave: (snapshot) => {
      sendSaveSnapshot('mt::response-file-save', snapshot)
    },
    confirmClose,
    requestCloseTabs: (tabIds) => {
      store.CLOSE_TABS([...tabIds])
    },
    requestCloseWindow: () => {
      getIpcRenderer().send('mt::close-window')
    },
    scheduleBufferedState: () => {
      debouncedSendBufferedState()
    }
  }
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    currentFile: null,
    tabs: [],
    tabIdToIndex: {},
    listToc: [], // Used for equal check and for searching for the correct github-slug to jump to
    toc: []
  }),

  actions: {
    updateTabIdToIndex(): void {
      this.tabIdToIndex = buildTabIndex(this.tabs)
    },

    CREATE_BUFFERED_STATE(): ReturnType<typeof createBufferedEditorState> {
      return createBufferedEditorState(this.$state)
    },

    RESTORE_BUFFERED_STATE(state: unknown): void {
      const rawState = state as { editor?: unknown; project?: unknown; layout?: unknown } | null
      const editorInput = rawState?.editor ?? state
      const bufferedEditorState = createBufferedEditorState(editorInput)
      if (!bufferedEditorState) {
        console.error('RESTORE_BUFFERED_STATE: Invalid editor buffer state.')
        return
      }

      const oldIdToNewId: Record<string, string> = {}
      const tabs: IFileState[] = bufferedEditorState.tabs.map((tab) => {
        const fileState = createDocumentState(tab as unknown as Record<string, unknown>)
        oldIdToNewId[tab.id] = fileState.id
        return fileState
      })

      const currentFileId = bufferedEditorState.currentFileId
        ? oldIdToNewId[bufferedEditorState.currentFileId]
        : undefined
      const currentFile: IFileState | null = tabs.find((tab) => tab.id === currentFileId) ?? null

      const projectStore = useProjectStore()
      const layoutStore = useLayoutStore()

      projectStore.RESTORE_BUFFERED_STATE(rawState?.project)
      layoutStore.RESTORE_BUFFERED_STATE(rawState?.layout)
      this.$patch((s) => {
        s.tabs = tabs
        s.currentFile = currentFile
        s.tabIdToIndex = {}
        s.listToc = []
        s.toc = []
      })

      this.updateTabIdToIndex()
      setDocumentDirectory(
        currentFile?.pathname ? getPathBridge().dirname(currentFile.pathname) : ''
      )
      this.UPDATE_LINE_ENDING_MENU()

      for (const warning of bufferedEditorState.restoreWarnings) {
        const restoredTabId = warning.tabId ? oldIdToNewId[warning.tabId] : null
        const tab = restoredTabId
          ? this.tabs.find((t) => t.id === restoredTabId)
          : this.tabs.find((t) =>
              getFileSystemBridge().isSamePathSync(t.pathname, warning.pathname ?? '')
            )

        if (!tab) continue

        this.pushTabNotification({
          tabId: tab.id,
          msg: warning.msg,
          showConfirm: warning.showConfirm,
          style: warning.style,
          exclusiveType: warning.exclusiveType
        })
      }
    },

    /**
     * Copies the specified heading's github-slug to the clipboard.
     * @param key The heading-id to copy.
     */
    copyGithubSlug(key: string): void {
      const item = this.listToc.find((i) => i.slug === key)

      if (item) {
        getClipboardBridge().writeText(`#${item.githubSlug}`)
        notice.notify({
          title: t('store.editor.anchorLinkCopied'),
          type: 'primary',
          time: 2000,
          showConfirm: false
        })
      } else {
        console.warn(t('store.editor.tocItemNotFound', { key }))
      }
    },

    /**
     * Update scroll position for the currentFile
     */
    updateScrollPosition(id: string, scrollTop: number): void {
      if (!(id in this.tabIdToIndex)) {
        console.warn('updateScrollPosition: Cannot find tab index for id:', id)
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]]
      if (tab) {
        tab.scrollTop = scrollTop
      }
      debouncedSendBufferedState()
    },

    /**
     * Push a tab specific notification on stack that never disappears.
     */
    pushTabNotification(data: PushTabNotificationPayload): void {
      const defaultAction: FileNotification['action'] = () => {}
      const { tabId, msg } = data
      const action = data.action || defaultAction
      const showConfirm = data.showConfirm || false
      const style = data.style || 'info'
      // Whether only one notification should exist.
      const exclusiveType = data.exclusiveType || ''

      const tab = this.tabs.find((t) => t.id === tabId)
      if (!tab) {
        console.error(t('store.editor.tabNotFound'))
        return
      }

      const { notifications } = tab

      // Remove the old notification if only one should exist.
      if (exclusiveType) {
        const index = notifications.findIndex((n) => n.exclusiveType === exclusiveType)
        if (index >= 0) {
          // Reorder current notification
          notifications.splice(index, 1)
        }
      }

      // Push new notification on stack.
      notifications.push({
        msg,
        showConfirm,
        style,
        exclusiveType,
        action
      })
    },

    loadChange(change: FileChangePayload): void {
      const { tabs, currentFile } = this
      const { data, pathname } = change
      const {
        isMixedLineEndings,
        lineEnding,
        adjustLineEndingOnSave,
        trimTrailingNewline,
        encoding,
        markdown,
        filename
      } = data
      // Create a new document and update few entires later.
      const newFileState = createDocumentState({
        markdown,
        filename,
        pathname,
        encoding,
        lineEnding,
        adjustLineEndingOnSave,
        trimTrailingNewline
      })

      const tab = tabs.find((t) => getFileSystemBridge().isSamePathSync(t.pathname, pathname))
      if (!tab) {
        // The tab may be closed in the meanwhile.
        console.error('loadChange: Cannot find tab in tab list.')
        notice.notify({
          title: t('store.editor.errorLoadingTabTitle'),
          message: t('store.editor.errorLoadingTabMessage'),
          type: 'error',
          time: 20000,
          showConfirm: false
        })
        return
      }

      // Backup few entries that we need to restore later.
      const oldId = tab.id
      const oldNotifications = tab.notifications
      // Preserve scroll across external reload so the editor stays put.
      const oldScrollTop = tab.scrollTop
      let oldHistory: IFileState['history'] | null = null
      const histIndex = tab.history.index
      if (histIndex >= 0 && tab.history.stack.length >= 1) {
        const entry = tab.history.stack[histIndex]
        if (entry) {
          // Allow to restore the old document.
          oldHistory = {
            stack: [entry],
            index: 0
          }
        }

        // Free reference from array
        tab.history.index--
        tab.history.stack.pop()
      }

      // Update file content and restore some entries.
      Object.assign(tab, newFileState)
      tab.id = oldId
      tab.notifications = oldNotifications
      tab.scrollTop = oldScrollTop
      if (oldHistory) {
        tab.history = oldHistory
      }

      if (isMixedLineEndings && typeof lineEnding === 'string') {
        this.pushTabNotification({
          tabId: tab.id,
          msg: t('store.editor.mixedLineEndingsNormalized', {
            name: filename,
            lineEnding: lineEnding.toUpperCase()
          }),
          showConfirm: false,
          style: 'info',
          exclusiveType: ''
        })
      }

      // Reload the editor if the tab is currently opened.
      if (currentFile && pathname === currentFile.pathname) {
        // save current state first
        this.currentFile = tab
        const { id, cursor, history, scrollTop, muyaIndexCursor } = tab // Should not use blocks history as this is loaded from disk
        bus.emit('file-changed', {
          id,
          markdown,
          muyaIndexCursor,
          cursor,
          renderCursor: true,
          history,
          scrollTop,
          // External disk reload: the engine handler records the new content as a
          // single invertible undo boundary (replaceContent) instead of clearing
          // history (setContent), so the first undo restores the pre-reload doc.
          isReload: true
        })
      }
      debouncedSendBufferedState()
    },

    FORMAT_LINK_CLICK({ data, dirname }: FormatLinkClickPayload): void {
      // Check if the link starts with a #, that is a local anchor link.
      if (data.href && data.href[0] === '#') {
        const anchorSlug = data.href.substring(1)
        if (!anchorSlug) return

        // Find the block with the anchor slug from the TOC
        for (const item of this.listToc) {
          if (item.githubSlug === anchorSlug) {
            // Scroll to the corresponding element that matches this github-slug
            bus.emit('scroll-to-header', item.slug)
            return
          }
        }

        // Fall back to a non-heading target: a custom `<a id="...">` (or any
        // element with a matching id) rendered in the document.
        const anchorElement = document.getElementById(anchorSlug)
        if (anchorElement) {
          bus.emit('scroll-to-anchor-element', anchorElement)
        }

        return
      }

      getIpcRenderer().send('mt::format-link-click', { data, dirname })
    },

    LISTEN_SCREEN_SHOT(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::screenshot-captured': (_, filePath) => {
          bus.emit('screenshot-captured', filePath)
        }
      })
    },

    // image path auto complement
    ASK_FOR_IMAGE_AUTO_PATH(src: string): Promise<string[]> {
      if (!this.currentFile) return Promise.resolve([])
      const { pathname } = this.currentFile
      if (pathname) {
        let rs: (value: string[]) => void = () => {}
        const promise = new Promise<string[]>((resolve) => {
          rs = resolve
        })
        const id = getUniqueId()
        // Dynamic IPC channel — not part of the static IpcMainEventChannels contract.
        ;(
          getIpcRenderer().once as (
            channel: string,
            listener: (event: unknown, files: string[]) => void
          ) => void
        )(`mt::response-of-image-path-${id}`, (_: unknown, files: string[]) => {
          rs(files)
        })
        getIpcRenderer().send('mt::ask-for-image-auto-path', {
          pathname,
          src,
          id,
          currentFile: deepClone(this.currentFile)
        })
        return promise
      } else {
        return Promise.resolve([])
      }
    },

    SEARCH(value: IFileState['searchMatches']): void {
      if (!this.currentFile) return
      this.currentFile.searchMatches = deepClone(value) // deep clone to trigger state changes
    },

    SHOW_IMAGE_DELETION_URL(deletionUrl: string): void {
      notice
        .notify({
          title: t('store.editor.imageDeletionUrlTitle'),
          message: t('store.editor.imageDeletionUrlMessage', { url: deletionUrl }),
          showConfirm: true,
          time: 20000
        })
        .then(() => {
          getClipboardBridge().writeText(deletionUrl)
        })
    },

    // We need to update line endings menu when changing tabs.
    UPDATE_LINE_ENDING_MENU(): void {
      if (!this.currentFile) return
      const { lineEnding } = this.currentFile
      if (lineEnding) {
        const windowId = getCurrentWindowId() ?? -1
        getIpcRenderer().send('mt::update-line-ending-menu', windowId, lineEnding as LineEnding)
      }
    },

    // Flush any edit still queued in the engine's rAF batch into the active
    // tab's `currentFile` before its markdown is read to persist — otherwise an
    // edit made in the same frame as the read is silently dropped from the
    // written file (#3803), the way tab switching already guards (#2938). Safe
    // no-op when nothing is pending.
    flushActiveEditor(): void {
      bus.emit('flush-active-editor')
    },

    FILE_SAVE(): void {
      if (!this.currentFile) return
      void createSaveCloseWorkflow(createSaveCloseEffects()).saveCurrent({
        fileId: this.currentFile.id,
        defaultPath: getProjectDefaultPath()
      })
    },

    // need pass some data to main process when `save` menu item clicked
    LISTEN_FOR_SAVE(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::editor-ask-file-save': () => {
          this.FILE_SAVE()
        }
      })
      registerEditorBusListener('mt::editor-ask-file-save', () => {
        this.FILE_SAVE()
      })
    },

    FILE_SAVE_AS(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const snapshot = createSaveAsPayload(this.currentFile, getProjectDefaultPath())
      sendSaveSnapshot('mt::response-file-save-as', snapshot)
    },

    // need pass some data to main process when `save as` menu item clicked
    LISTEN_FOR_SAVE_AS(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::editor-ask-file-save-as': () => {
          this.FILE_SAVE_AS()
        }
      })
      registerEditorBusListener('mt::editor-ask-file-save-as', () => {
        this.FILE_SAVE_AS()
      })
    },

    LISTEN_FOR_SET_PATHNAME(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::set-pathname': (_, fileInfo) => {
          const { tabs } = this
          const { pathname, id } = fileInfo
          const tab = tabs.find((f) => f.id === id)
          if (!tab) {
            console.error('[ERROR] Cannot change file path from unknown tab.')
            return
          }

          // If a tab with the same file path already exists we need to close the tab.
          // The existing tab is overwritten by this tab.
          const existingTab = tabs.find(
            (t) => t.id !== id && getFileSystemBridge().isSamePathSync(t.pathname, pathname)
          )
          if (existingTab) {
            this.CLOSE_TAB(existingTab)
          }

          // SET_PATHNAME
          const { filename } = fileInfo
          if (id === this.currentFile?.id && pathname) {
            setDocumentDirectory(getPathBridge().dirname(pathname))
          }
          if (tab) {
            Object.assign(tab, { filename, pathname, isSaved: true })
            debouncedSendBufferedState()
          }
        }
      })

      registerEditorIpcListeners(registerEditorIpc, {
        'mt::tab-saved': (_, tabId) => {
          const tab = this.tabs.find((f) => f.id === tabId)
          if (tab) {
            const lastEditIndex = tab.history.lastEditIndex
            if (
              typeof lastEditIndex === 'number' &&
              lastEditIndex >= 0 &&
              lastEditIndex < tab.history.stack.length
            ) {
              const entry = tab.history.stack[lastEditIndex]
              if (entry && typeof entry.id === 'number') {
                tab.lastSavedHistoryId = entry.id
              }
            }
            tab.isSaved = true
            debouncedSendBufferedState()
          }
        }
      })

      registerEditorIpcListeners(registerEditorIpc, {
        'mt::tab-save-failure': (_, tabId, msg) => {
          const tab = this.tabs.find((t) => t.id === tabId)
          if (!tab) {
            notice.notify({
              title: t('dialog.saveFailure'),
              message: msg,
              type: 'error',
              time: 20000,
              showConfirm: false
            })
            return
          }

          tab.isSaved = false
          this.pushTabNotification({
            tabId,
            msg: t('store.editor.errorWhileSaving', { msg }),
            style: 'crit'
          })
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_CLOSE(): void {
      const projectStore = useProjectStore()
      const preferencesStore = usePreferencesStore()
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::ask-for-close': () => {
          void createSaveCloseWorkflow(createSaveCloseEffects())
            .closeWindow({
              unsavedFileIds: this.tabs.filter((file) => !file.isSaved).map((file) => file.id),
              defaultPath: getDefaultPath(projectStore.projectTree)
            })
            .catch((err) => {
              console.error('Failed to close editor window', err)
            })
        }
      })
    },

    LISTEN_FOR_SAVE_CLOSE(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::force-close-tabs-by-id': (_, tabIdList) => {
          if (Array.isArray(tabIdList) && tabIdList.length) {
            this.CLOSE_TABS(tabIdList)
          }
        }
      })
    },

    ASK_FOR_SAVE_ALL(closeTabs: boolean): void {
      const { tabs } = this
      this.flushActiveEditor()
      const unsavedFiles = buildUnsavedFilePayloads(
        tabs.filter((file) => !(file.isSaved && /[^\n]/.test(file.markdown))),
        getProjectDefaultPath()
      )

      if (closeTabs) {
        if (unsavedFiles.length) {
          this.CLOSE_TABS(tabs.filter((f) => f.isSaved).map((f) => f.id))
          getIpcRenderer().send('mt::save-and-close-tabs', deepClone(unsavedFiles))
        } else {
          this.CLOSE_TABS(tabs.map((f) => f.id))
        }
      } else {
        getIpcRenderer().send('mt::save-tabs', deepClone(unsavedFiles))
      }
    },

    MOVE_FILE_TO(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const snapshot = createSaveSnapshot(this.currentFile, getProjectDefaultPath())
      if (!snapshot.id) return
      if (!snapshot.pathname) {
        // if current file is a newly created file, just save it!
        sendSaveSnapshot('mt::response-file-save', snapshot)
      } else {
        // if not, move to a new(maybe) folder
        getIpcRenderer().send('mt::response-file-move-to', {
          id: snapshot.id,
          pathname: snapshot.pathname
        })
      }
    },

    LISTEN_FOR_MOVE_TO(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::editor-move-file': () => {
          this.MOVE_FILE_TO()
        }
      })
      registerEditorBusListener('mt::editor-move-file', () => {
        this.MOVE_FILE_TO()
      })
    },

    LISTEN_FOR_RENAME(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::editor-rename-file': () => {
          this.RESPONSE_FOR_RENAME()
        }
      })
      registerEditorBusListener('mt::editor-rename-file', () => {
        this.RESPONSE_FOR_RENAME()
      })
    },

    RESPONSE_FOR_RENAME(): void {
      if (!this.currentFile) return
      this.flushActiveEditor()
      const snapshot = createSaveSnapshot(this.currentFile, getProjectDefaultPath())
      if (!snapshot.id) return
      if (!snapshot.pathname) {
        // if current file is a newly created file, just save it!
        sendSaveSnapshot('mt::response-file-save', snapshot)
      } else {
        bus.emit('rename')
      }
    },

    // ask for main process to rename this file to a new name `newFilename`
    RENAME(newFilename: string): void {
      if (!this.currentFile) return
      const { id, pathname, filename } = this.currentFile
      if (typeof filename === 'string' && filename !== newFilename) {
        const newPathname = getPathBridge().join(getPathBridge().dirname(pathname), newFilename)
        getIpcRenderer().send('mt::rename', {
          id,
          pathname,
          newPathname,
          currentFile: deepClone(this.currentFile)
        })
      }
    },

    /**
     * Update the pathname/filename of any tab whose pathname matches `src`.
     * Invoked from the sidebar rename flow (project.ts:RENAME_IN_SIDEBAR).
     */
    RENAME_IF_NEEDED({ src, dest }: { src: string; dest: string }): void {
      this.tabs.forEach((tab) => {
        if (tab.pathname === src) {
          tab.pathname = dest
          tab.filename = getPathBridge().basename(dest)
        }
      })
      // Keep DIRNAME in sync when the active tab is the one being renamed,
      // so link resolution / dirname-based lookups don't keep using the old
      // folder until the user switches tabs.
      if (this.currentFile != null && this.currentFile.pathname === dest) {
        setDocumentDirectory(getPathBridge().dirname(dest))
      }
      debouncedSendBufferedState()
    },

    UPDATE_CURRENT_FILE(currentFile: IFileState): void {
      const oldCurrentFile = this.currentFile
      let didUpdateCurrentFile = false
      if (oldCurrentFile == null || oldCurrentFile.id !== currentFile.id) {
        const { id, markdown, cursor, history, pathname, scrollTop, blocks, muyaIndexCursor } =
          currentFile
        // Must run while `currentFile` still points at the outgoing tab, so its
        // flushed edit is attributed to that tab and not lost on switch (#2938).
        if (oldCurrentFile) {
          this.flushActiveEditor()
        }
        this.currentFile = currentFile
        didUpdateCurrentFile = true

        if (!this.tabs.some((file) => file.id === currentFile.id)) {
          this.tabs.push(currentFile)
          this.updateTabIdToIndex()
        }

        activateFileInEditor(currentFile)
      }

      this.UPDATE_LINE_ENDING_MENU()
      if (didUpdateCurrentFile) {
        debouncedSendBufferedState()
      }
    },

    // This events are only used during window creation.
    LISTEN_FOR_BOOTSTRAP_WINDOW(): void {
      const preferencesStore = usePreferencesStore()
      const layoutStore = useLayoutStore()
      const projectStore = useProjectStore()
      const mainStore = useMainStore()

      // Delay load runtime commands and initialize commands.
      scheduleEditorRuntimeTimer(() => {
        bus.emit('cmd::register-command', new FileEncodingCommand(this))
        bus.emit(
          'cmd::register-command',
          new QuickOpenCommand({
            editor: this,
            preferences: preferencesStore,
            project: projectStore
          })
        )
        bus.emit('cmd::register-command', new LineEndingCommand(this))
        bus.emit('cmd::register-command', new TrailingNewlineCommand(this))

        scheduleEditorRuntimeTimer(() => {
          getIpcRenderer().send('mt::request-keybindings')
          bus.emit('cmd::sort-commands')
        }, 100)
      }, 400)

      registerEditorIpcListeners(registerEditorIpc, {
        'mt::bootstrap-editor': (_, config) => {
          const {
            addBlankTab,
            markdownList,
            lineEnding,
            sideBarVisibility,
            tabBarVisibility,
            sourceCodeModeEnabled
          } = config

          getIpcRenderer().send('mt::window-initialized')
          mainStore.SET_INITIALIZED()
          preferencesStore.SET_USER_PREFERENCE({ endOfLine: lineEnding })
          layoutStore.SET_LAYOUT({
            rightColumn: 'files',
            showSideBar: !!sideBarVisibility,
            showTabBar: !!tabBarVisibility
          })
          layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
          preferencesStore.SET_MODE({
            type: 'sourceCode',
            checked: !!sourceCodeModeEnabled
          })

          if (addBlankTab) {
            this.NEW_UNTITLED_TAB({ selected: true })
          } else if (markdownList.length) {
            let isFirst = true
            for (const md of markdownList) {
              this.NEW_UNTITLED_TAB({
                markdown: md,
                selected: isFirst
              })
              isFirst = false
            }
          }
        }
      })
    },

    // Open a new tab, optionally with content.
    LISTEN_FOR_NEW_TAB(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::open-new-tab': (_, markdownDocument, options = {}, selected = true) => {
          if (markdownDocument) {
            // Create tab with content.
            this.NEW_TAB_WITH_CONTENT({ markdownDocument, options, selected })
          } else {
            // Fallback: create a blank tab and always select it
            this.NEW_UNTITLED_TAB({})
          }
        },
        'mt::new-untitled-tab': (_, selected = true, markdown = '') => {
          // Create a blank tab
          this.NEW_UNTITLED_TAB({ markdown, selected })
        }
      })
      registerEditorBusListener('mt::new-untitled-tab', (payload) => {
        const { selected = true, markdown = '' } =
          (payload as { selected?: boolean; markdown?: string } | undefined) ?? {}
        this.NEW_UNTITLED_TAB({ markdown, selected })
      })
    },

    CLOSE_TAB(file: IFileState | null = null): void {
      const target = file ?? this.currentFile
      if (target === null) return

      if (target.isSaved) {
        this.FORCE_CLOSE_TAB(target)
      } else {
        this.CLOSE_UNSAVED_TAB(target)
      }
    },

    LISTEN_FOR_CLOSE_TAB(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::editor-close-tab': () => {
          this.CLOSE_TAB()
        }
      })
      registerEditorBusListener('mt::editor-close-tab', () => {
        this.CLOSE_TAB()
      })
    },

    LISTEN_FOR_TAB_CYCLE(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::tabs-cycle-left': () => {
          this.CYCLE_TABS(false)
        },
        'mt::tabs-cycle-right': () => {
          this.CYCLE_TABS(true)
        }
      })
      registerEditorBusListener('mt::tabs-cycle-left', () => {
        this.CYCLE_TABS(false)
      })
      registerEditorBusListener('mt::tabs-cycle-right', () => {
        this.CYCLE_TABS(true)
      })
    },

    LISTEN_FOR_SWITCH_TABS(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::switch-tab-by-index': (_, index) => {
          this.SWITCH_TAB_BY_INDEX(index)
        },
        'mt::switch-tab-by-file_path': (_, filePath) => {
          this.SWITCH_TAB_BY_FILEPATH(filePath)
        }
      })
    },

    FORCE_CLOSE_TAB(file: IFileState): void {
      const { tabs, currentFile } = this
      const index = tabs.findIndex((t) => t.id === file.id)
      if (index > -1) {
        tabs.splice(index, 1)
        this.updateTabIdToIndex()
      }

      if (file.id) {
        clearAutoSaveTimer(file.id)
      }

      this.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

      if (currentFile && file.id === currentFile.id) {
        const fileState: IFileState | null = selectTabAfterClose(this.tabs, index)
        this.currentFile = fileState
        if (fileState && typeof fileState.markdown === 'string') {
          activateFileInEditor(fileState)
        } else {
          setDocumentDirectory('')
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }

      const { pathname } = file
      if (pathname) {
        getIpcRenderer().send('mt::window-tab-closed', pathname)
      }
      debouncedSendBufferedState()
    },

    CLOSE_UNSAVED_TAB(file: IFileState): void {
      const payload = createUnsavedFilePayload(file, getProjectDefaultPath())
      getIpcRenderer().send('mt::save-and-close-tabs', [deepClone(payload)])
    },

    CLOSE_OTHER_TABS(file: IFileState): void {
      this.tabs
        .filter((f) => f.id !== file.id)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_SAVED_TABS(): void {
      this.tabs
        .filter((f) => f.isSaved)
        .forEach((tab) => {
          this.CLOSE_TAB(tab)
        })
    },

    CLOSE_ALL_TABS(): void {
      this.tabs.slice().forEach((tab) => {
        this.CLOSE_TAB(tab)
      })
    },

    CLOSE_TABS(tabIdList: string[]): void {
      if (!tabIdList || tabIdList.length === 0) return

      let tabIndex = 0
      tabIdList.forEach((id) => {
        const index = this.tabs.findIndex((f) => f.id === id)
        if (index === -1) return

        const closed = this.tabs[index]
        const { pathname } = closed ?? { pathname: '' }
        clearAutoSaveTimer(id)

        if (pathname) {
          getIpcRenderer().send('mt::window-tab-closed', pathname)
        }

        this.tabs.splice(index, 1)
        if (this.currentFile?.id === id) {
          this.currentFile = null
          setDocumentDirectory('')
          if (tabIdList.length === 1) {
            tabIndex = index
          }
        }
      })

      this.updateTabIdToIndex() // Update before sending it out to prevent stale mappings.

      if (this.currentFile == null && this.tabs.length > 0) {
        this.currentFile = this.tabs[tabIndex] ?? this.tabs[tabIndex - 1] ?? this.tabs[0] ?? null
        if (this.currentFile && typeof this.currentFile.markdown === 'string') {
          activateFileInEditor(this.currentFile)
        }
      }

      if (this.tabs.length === 0) {
        this.listToc = []
        this.toc = []
      }
      debouncedSendBufferedState()
    },

    EXCHANGE_TABS_BY_ID(tabIDs: { fromId: string; toId: string | null }): void {
      const { fromId, toId } = tabIDs
      const { tabs } = this
      const fromIndex = tabs.findIndex((t) => t.id === fromId)
      if (fromIndex === -1) return
      if (toId && tabs.findIndex((t) => t.id === toId) === -1) return

      this.tabs = exchangeTabs(tabs, tabIDs)
      this.updateTabIdToIndex()
      debouncedSendBufferedState()
    },

    RENAME_FILE(file: IFileState): void {
      this.UPDATE_CURRENT_FILE(file)
      bus.emit('rename')
    },

    // Direction is a boolean where false is left and true right.
    CYCLE_TABS(direction: boolean): void {
      const { tabs, currentFile } = this
      if (tabs.length <= 1) {
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('CYCLE_TABS: Cannot find current tab index.')
        return
      }

      const nextTabIndex = cycleTabIndex(tabs.length, currentIndex, direction)
      if (nextTabIndex === null) return

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`CYCLE_TABS: Cannot find next tab (index="${nextTabIndex}").`)
        return
      }

      this.UPDATE_CURRENT_FILE(nextTab)
    },

    SWITCH_TAB_BY_FILEPATH(filePath: string): void {
      const { tabs } = this

      if (!filePath) {
        console.warn('Invalid file path:', filePath)
        return
      }

      const next = findTabByPath(tabs, filePath)
      if (!next) {
        console.error('Cannot find tab with pathname:', filePath)
        return
      }
      this.UPDATE_CURRENT_FILE(next)
    },

    SWITCH_TAB_BY_INDEX(nextTabIndex: number): void {
      const { tabs, currentFile } = this
      if (nextTabIndex < 0 || nextTabIndex >= tabs.length) {
        console.warn('Invalid tab index:', nextTabIndex)
        return
      }

      const currentIndex = tabs.findIndex((t) => t.id === currentFile?.id)
      if (currentIndex === -1) {
        console.error('Cannot find current tab index.')
        return
      }

      const nextTab = tabs[nextTabIndex]
      if (!nextTab || !nextTab.id) {
        console.error(`Cannot find tab by index="${nextTabIndex}".`)
        return
      }
      this.UPDATE_CURRENT_FILE(nextTab)
    },

    /**
     * Create a new untitled tab, optionally seeded with markdown content.
     */
    NEW_UNTITLED_TAB({
      markdown: markdownString,
      selected
    }: {
      markdown?: string
      selected?: boolean
    }): void {
      if (selected == null) {
        selected = true
      }

      this.SHOW_TAB_VIEW(false)

      const preferencesStore = usePreferencesStore()
      const { defaultEncoding, endOfLine } = preferencesStore
      const fileState = getBlankFileState(
        this.tabs,
        defaultEncoding,
        endOfLine,
        markdownString ?? null
      )

      if (selected) {
        const { id, markdown } = fileState
        this.UPDATE_CURRENT_FILE(fileState)
        bus.emit('file-loaded', { id, markdown })
      } else {
        this.tabs.push(fileState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }
    },

    /**
     * Create a new tab from the given markdown document.
     */
    NEW_TAB_WITH_CONTENT({
      markdownDocument,
      options = {},
      selected
    }: {
      markdownDocument: MarkdownDocument | null | undefined
      options?: TabOptions
      selected?: boolean
    }): void {
      if (!markdownDocument) {
        console.warn('Cannot create a file tab without a markdown document!')
        this.NEW_UNTITLED_TAB({})
        return
      }

      if (typeof selected === 'undefined') {
        selected = true
      }

      const { currentFile, tabs } = this
      const { pathname } = markdownDocument
      const existingTab = tabs.find((t) =>
        getFileSystemBridge().isSamePathSync(t.pathname, pathname ?? '')
      )
      if (existingTab) {
        this.UPDATE_CURRENT_FILE(existingTab)
        return
      }

      let keepTabBarState = false
      if (currentFile) {
        const { isSaved, pathname: cfPath } = currentFile
        if (isSaved && !cfPath) {
          keepTabBarState = true
          this.FORCE_CLOSE_TAB(currentFile)
        }
      }

      if (!keepTabBarState) {
        this.SHOW_TAB_VIEW(false)
      }

      const { markdown, isMixedLineEndings } = markdownDocument
      const docState = createDocumentState(
        Object.assign(
          {},
          markdownDocument as unknown as Record<string, unknown>,
          options as Record<string, unknown>
        )
      )
      const { id, cursor } = docState

      if (selected) {
        this.UPDATE_CURRENT_FILE(docState)
        bus.emit('file-loaded', { id, markdown, cursor })
      } else {
        this.tabs.push(docState)
        this.updateTabIdToIndex()
        debouncedSendBufferedState()
      }

      if (isMixedLineEndings) {
        const { filename, lineEnding } = markdownDocument
        if (typeof lineEnding === 'string') {
          this.pushTabNotification({
            tabId: id,
            msg: t('store.editor.mixedLineEndingsNormalized', {
              name: filename,
              lineEnding: lineEnding.toUpperCase()
            })
          })
        }
      }
    },

    SHOW_TAB_VIEW(always: boolean): void {
      const { tabs } = this
      const layoutStore = useLayoutStore()
      if (always || tabs.length === 1) {
        layoutStore.SET_LAYOUT({ showTabBar: true })
        layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()
      }
    },

    SET_SAVE_STATUS_WHEN_REMOVE({ pathname }: { pathname: string }): void {
      let didUpdateSaveStatus = false
      this.tabs.forEach((f) => {
        if (f.pathname === pathname) {
          f.isSaved = false
          didUpdateSaveStatus = true
        }
      })
      if (didUpdateSaveStatus) {
        debouncedSendBufferedState()
      }
    },

    /**
     * Replaces the table of contents with a fresh snapshot from the engine.
     *
     * Used on file load and tab switch, where the engine fires no `json-change`
     * event (so `LISTEN_FOR_CONTENT_CHANGE` never runs and the TOC would
     * otherwise stay empty until the first edit). Assigns unconditionally: this
     * is a re-seed on load/switch, so there is no `equal` guard to short-circuit
     * — the incoming snapshot always wins, even if it happens to deep-equal the
     * current TOC.
     * @param toc Flat list of headings returned by `muya.getTOC()`.
     */
    UPDATE_TOC(toc: TocItem[]): void {
      this.listToc = toc ?? []
      this.toc = listToTree<TocItem>(toc ?? [])
    },

    // Content change from realtime preview editor and source code editor
    // There is a chance that this event is fired AFTER the tab is switched.
    LISTEN_FOR_CONTENT_CHANGE({
      id,
      markdown,
      wordCount,
      cursor,
      muyaIndexCursor,
      history,
      toc,
      blocks
    }: ContentChangePayload): void {
      const preferencesStore = usePreferencesStore()
      const { autoSave } = preferencesStore
      if (!id) {
        throw new Error('Listen for document change but id was not set!')
      } else if (this.tabs.length === 0) {
        return
      } else if (!(id in this.tabIdToIndex)) {
        // This only happens when the sourceCode tries to write a stale id via prepareTabSwitch() but the tab
        // has already been closed. In this case we can safely ignore the update.
        return
      }

      const tab = this.tabs[this.tabIdToIndex[id]!]
      if (!tab) return

      const { filename, pathname, markdown: oldMarkdown, trimTrailingNewline } = tab

      const incomingMarkdown = markdown
      markdown = adjustTrailingNewlines(markdown, trimTrailingNewline)
      tab.markdown = markdown

      // Reuse the caller's count on the hot edit path. Recalculate only when
      // the payload omits it or trailing-newline normalization changed the text.
      tab.wordCount =
        wordCount !== undefined && incomingMarkdown === markdown
          ? wordCount
          : calculateWordCount(markdown)

      // Keep the empty-document newline sentinel out of dirty/history updates,
      // but do not skip the derived counter for the new character.
      if (oldMarkdown.length === 0 && markdown.length === 1 && markdown[0] === '\n') {
        debouncedSendBufferedState()
        return
      }

      if (cursor) tab.cursor = cursor
      if (muyaIndexCursor) tab.muyaIndexCursor = muyaIndexCursor
      if (history) tab.history = history
      if (blocks) tab.blocks = blocks

      // Only update TOC if it's the current file
      if (id === this.currentFile?.id && toc && !equal(toc, this.listToc)) {
        this.listToc = toc
        this.toc = listToTree<TocItem>(toc)
      }

      const lastEditIndex = tab.history.lastEditIndex
      const editEntry =
        typeof lastEditIndex === 'number' && lastEditIndex >= 0
          ? tab.history.stack[lastEditIndex]
          : undefined
      const historyMarksDirty =
        (typeof lastEditIndex === 'number' &&
          lastEditIndex >= 0 &&
          editEntry !== undefined &&
          editEntry.id !== tab.lastSavedHistoryId) ||
        (lastEditIndex === -1 &&
          tab.lastSavedHistoryId !== -1 &&
          tab.lastSavedHistoryId !== tab.history.lastInitIndex) // Edge Case: Undo to original content (lastEditIndex === -1) after saving means we cant use the lastEditIndex. Compare it against the lastInitIndex instead.
      const isDirty = history === undefined ? markdown !== oldMarkdown : historyMarksDirty
      if (isDirty) {
        tab.isSaved = false
        if (pathname && autoSave) {
          const options = getOptionsFromState(tab)
          this.HANDLE_AUTO_SAVE({
            id,
            filename,
            pathname,
            markdown,
            options
          })
        }
      } else if (history !== undefined && tab.lastSavedHistoryId !== -1) {
        // Check here is to prevent it from overriding a restored .isSaved state
        tab.isSaved = true // An undo can trigger this
      }
      debouncedSendBufferedState()
    },

    HANDLE_AUTO_SAVE({ id, filename, pathname, markdown, options }: AutoSavePayload): void {
      if (!id || !pathname) {
        throw new Error('HANDLE_AUTO_SAVE: Invalid tab.')
      }

      const preferencesStore = usePreferencesStore()
      const { autoSaveDelay } = preferencesStore

      clearAutoSaveTimer(id)

      const timer = setTimeout(() => {
        autoSaveTimers.delete(id)

        const tab = this.tabs.find((t) => t.id === id)
        if (tab && !tab.isSaved) {
          const snapshot = createSaveSnapshot(
            { id, filename, pathname, markdown, ...options },
            getProjectDefaultPath()
          )
          sendSaveSnapshot('mt::response-file-save', snapshot)
        }
      }, autoSaveDelay)
      autoSaveTimers.set(id, timer)
    },

    SELECTION_CHANGE(changes: SelectionChange): void {
      const { start, end } = changes
      if (this.currentFile && start.key === end.key && start.block?.text) {
        const value = start.block.text.substring(start.offset, end.offset)
        this.currentFile.searchMatches = {
          matches: [],
          index: -1,
          value
        }
      }

      const windowId = getCurrentWindowId() ?? -1
      getIpcRenderer().send(
        'mt::editor-selection-changed',
        windowId,
        createApplicationMenuState(changes)
      )
    },

    // Persist the caret for a tab without the heavy content-change pipeline. A
    // pure caret move (click / arrow key) fires `selection-change` but NOT
    // `json-change`, so `tab.cursor` — the position replayed when the tab is
    // re-activated — would otherwise only ever track the last EDIT, losing a
    // click-moved caret across an in-session tab switch. Lightweight by design:
    // it only stores the serialized caret, skipping markdown/blocks/TOC re-derivation
    // and the save/dirty bookkeeping LISTEN_FOR_CONTENT_CHANGE performs.
    PERSIST_CURSOR(id: string, cursor: unknown): void {
      if (!id || !cursor) return
      const index = this.tabIdToIndex[id]
      if (index == null) return
      const tab = this.tabs[index]
      if (tab) tab.cursor = cursor
    },

    SELECTION_FORMATS(formats: SelectionFormat[]): void {
      const windowId = getCurrentWindowId() ?? -1
      getIpcRenderer().send('mt::update-format-menu', windowId, createSelectionFormatState(formats))
    },

    EXPORT({ type, content, pageOptions }: ExportPayload): void {
      if (this.currentFile === null) return

      let title = ''
      const { listToc } = this
      if (listToc && listToc.length > 0) {
        let headerRef: TocItem | undefined = listToc[0]
        const len = Math.min(listToc.length, 6)
        for (let i = 1; i < len; ++i) {
          if (headerRef?.lvl === 1) break
          const header = listToc[i]
          if (header && headerRef && (headerRef.lvl ?? 0) > (header.lvl ?? 0)) {
            headerRef = header
          }
        }
        title = headerRef?.content ?? ''
      }

      const { filename, pathname } = this.currentFile
      getIpcRenderer().send('mt::response-export', {
        type: type as ExportPayload['type'] as never,
        title,
        content: content ?? '',
        filename,
        pathname,
        pageOptions: pageOptions ?? {}
      })
    },

    LISTEN_FOR_EXPORT_SUCCESS(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::export-success': (_, payload) => {
          const filePath = payload?.filePath ?? ''
          notice
            .notify({
              title: t('store.editor.exportSuccessTitle'),
              message: t('store.editor.exportSuccessMessage', {
                name: getPathBridge().basename(filePath)
              }),
              showConfirm: true
            })
            .then(() => {
              getShellBridge().showItemInFolder(filePath)
            })
        }
      })
    },

    PRINT_RESPONSE(): void {
      getIpcRenderer().send('mt::response-print')
    },

    LISTEN_FOR_PRINT_SERVICE_CLEARUP(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::print-service-clearup': () => {
          bus.emit('print-service-clearup')
        }
      })
    },

    SET_LINE_ENDING(lineEnding: LineEnding | string): void {
      if (!this.currentFile) return
      const { lineEnding: oldLineEnding } = this.currentFile
      if (lineEnding !== oldLineEnding) {
        this.currentFile.lineEnding = lineEnding
        this.currentFile.adjustLineEndingOnSave = lineEnding !== 'lf'
        this.currentFile.isSaved = true
        this.UPDATE_LINE_ENDING_MENU()
        debouncedSendBufferedState()
      }
    },

    LISTEN_FOR_SET_LINE_ENDING(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::set-line-ending': (_, lineEnding) => {
          this.SET_LINE_ENDING(lineEnding)
        }
      })
      registerEditorBusListener('mt::set-line-ending', (lineEnding) => {
        this.SET_LINE_ENDING(lineEnding as LineEnding)
      })
    },

    LISTEN_FOR_SET_ENCODING(): void {
      registerEditorBusListener('mt::set-file-encoding', (encodingName) => {
        if (!this.currentFile) return
        const { encoding } = this.currentFile.encoding
        if (encoding !== encodingName) {
          this.currentFile.encoding.encoding = encodingName as string
          this.currentFile.encoding.isBom = false
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_SET_FINAL_NEWLINE(): void {
      registerEditorBusListener('mt::set-final-newline', (value) => {
        if (!this.currentFile) return
        const { trimTrailingNewline } = this.currentFile
        if (trimTrailingNewline !== value) {
          this.currentFile.trimTrailingNewline = value as number
          this.currentFile.isSaved = true
          debouncedSendBufferedState()
        }
      })
    },

    LISTEN_FOR_FILE_CHANGE(): void {
      const preferencesStore = usePreferencesStore()
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::update-file': (_, payload) => {
          const { type, change } = payload
          const { tabs } = this
          const { pathname } = change
          const tab = tabs.find((t) => getFileSystemBridge().isSamePathSync(t.pathname, pathname))
          if (tab) {
            const { id, isSaved, filename } = tab
            switch (type) {
              case 'unlink': {
                tab.isSaved = false
                this.pushTabNotification({
                  tabId: id,
                  msg: t('store.editor.fileRemovedOnDisk', { name: filename }),
                  style: 'warn',
                  showConfirm: false,
                  exclusiveType: 'file_changed'
                })
                debouncedSendBufferedState()
                break
              }
              case 'add':
              case 'change': {
                // Only the file's metadata changed on disk (e.g. a git checkout
                // that left the content byte-identical) — there is nothing to
                // reload and no reason to warn the user (#1861).
                const newMarkdown = (change as unknown as FileChangePayload).data?.markdown
                if (typeof newMarkdown === 'string' && newMarkdown === tab.markdown) {
                  break
                }

                const { autoSave } = preferencesStore
                if (autoSave) {
                  if (autoSaveTimers.has(id)) {
                    const timer = autoSaveTimers.get(id)
                    if (timer) clearTimeout(timer)
                    autoSaveTimers.delete(id)
                  }

                  if (isSaved) {
                    this.loadChange(change as unknown as FileChangePayload)
                    return
                  }
                }

                tab.isSaved = false
                this.pushTabNotification({
                  tabId: id,
                  msg: t('store.editor.fileChangedOnDisk', { name: filename }),
                  showConfirm: true,
                  exclusiveType: 'file_changed',
                  action: (status) => {
                    if (status) {
                      this.loadChange(change as unknown as FileChangePayload)
                    }
                  }
                })
                debouncedSendBufferedState()
                break
              }
              default:
                console.error(`LISTEN_FOR_FILE_CHANGE: Invalid type "${type}"`)
            }
          } else {
            console.error(`LISTEN_FOR_FILE_CHANGE: Cannot find tab for path "${pathname}".`)
          }
        }
      })
    },

    ASK_FOR_IMAGE_PATH(): Promise<string[]> {
      return getIpcRenderer().invoke('mt::ask-for-image-path')
    },

    EDIT_ZOOM(zoomFactor: number): void {
      const preferencesStore = usePreferencesStore()
      zoomFactor = Number.parseFloat(zoomFactor.toFixed(3))
      const { zoom } = preferencesStore
      if (zoom !== zoomFactor) {
        preferencesStore.SET_SINGLE_PREFERENCE({ type: 'zoom', value: zoomFactor })
      }
      getWebFrameBridge().setZoomFactor(zoomFactor)
    },

    LISTEN_WINDOW_ZOOM(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::window-zoom': (_, zoomFactor) => {
          this.EDIT_ZOOM(zoomFactor)
        }
      })
      registerEditorBusListener('mt::window-zoom', (zoomFactor) => {
        this.EDIT_ZOOM(zoomFactor as number)
      })
    },

    LISTEN_FOR_RELOAD_IMAGES(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::invalidate-image-cache': () => {
          bus.emit('invalidate-image-cache')
        }
      })
    },

    LISTEN_FOR_CONTEXT_MENU(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        // General context menu
        'mt::cm-copy-as-rich': () => {
          bus.emit('copyAsRich', 'copyAsRich')
        },
        'mt::cm-copy-as-html': () => {
          bus.emit('copyAsHtml', 'copyAsHtml')
        },
        'mt::cm-paste-as-plain-text': () => {
          bus.emit('pasteAsPlainText', 'pasteAsPlainText')
        },
        'mt::cm-insert-paragraph': (_, location) => {
          bus.emit('insertParagraph', location)
        },

        // Spelling
        'mt::spelling-replace-misspelling': (_, info) => {
          bus.emit('replace-misspelling', info)
        },
        'mt::spelling-show-switch-language': () => {
          bus.emit('open-command-spellchecker-switch-language')
        }
      })
    },

    LISTEN_FOR_STATE_REPLACE(): void {
      registerEditorIpcListeners(registerEditorIpc, {
        'mt::load-state': (_, state) => {
          this.RESTORE_BUFFERED_STATE(state)
        }
      })
    }
  }
})

// ----------------------------------------------------------------------------

/**
 * Trim the final newlines according `trimTrailingNewlineOption`.
 *
 * @param markdown The text to trim.
 * @param trimTrailingNewlineOption The option how we should trim the final newlines.
 */
const adjustTrailingNewlines = (markdown: string, trimTrailingNewlineOption: number): string => {
  if (!markdown) {
    return ''
  }

  switch (trimTrailingNewlineOption) {
    // Trim trailing newlines.
    case 0: {
      return trimTrailingNewlines(markdown)
    }
    // Ensure single trailing newline.
    case 1: {
      // Muya will always add a final new line to the markdown text. Check first whether
      // only one newline exist to prevent copying the string.
      const lastIndex = markdown.length - 1
      if (markdown[lastIndex] === '\n') {
        if (markdown.length === 1) {
          // Just return nothing because adding a final new line makes no sense.
          return ''
        } else if (markdown[lastIndex - 1] !== '\n') {
          return markdown
        }
      }

      // Otherwise trim trailing newlines and add one.
      markdown = trimTrailingNewlines(markdown)
      if (markdown.length === 0) {
        // Just return nothing because adding a final new line makes no sense.
        return ''
      }
      return markdown + '\n'
    }
    // Disabled, use text as it is.
    default:
      return markdown
  }
}

/**
 * Trim trailing newlines from `text`.
 *
 * @param {string} text The text to trim.
 */
const trimTrailingNewlines = (text: string): string => {
  return text.replace(/[\r?\n]+$/, '')
}

interface ApplicationMenuState {
  isDisabled: boolean
  isMultiline: boolean
  isLooseListItem: boolean
  isTaskList: boolean
  isCodeFences: boolean
  isCodeContent: boolean
  isTable: boolean
  hasFrontMatter: boolean
  affiliation: Record<string, boolean>
}

/**
 * Creates a object that contains the application menu state.
 *
 * @param {*} selection The selection.
 * @returns A object that represents the application menu state.
 */
const createApplicationMenuState = ({
  start,
  end,
  affiliation,
  hasFrontMatter
}: SelectionChange): ApplicationMenuState => {
  const state: ApplicationMenuState = {
    isDisabled: false,
    // Whether multiple lines are selected.
    isMultiline: start.key !== end.key,
    // List information - a list must be selected.
    isLooseListItem: false,
    isTaskList: false,
    // Whether the selection is code block like (math, html or code block).
    isCodeFences: false,
    // Whether a code block line is selected.
    isCodeContent: false,
    // Whether the selection contains a table.
    isTable: false,
    hasFrontMatter: !!hasFrontMatter,
    // Contains keys about the selection type(s) (string, boolean) like "ul: true".
    affiliation: {}
  }
  const { isMultiline } = state
  const aff: AffiliationEntry[] = affiliation ?? []
  const startBlock: { text?: string; functionType?: string } = start.block ?? {}
  const endBlock: { functionType?: string } = end.block ?? {}

  // Get code block information from selection.
  if (
    (startBlock.functionType === 'cellContent' && endBlock.functionType === 'cellContent') ||
    (start.type === 'span' && startBlock.functionType === 'codeContent') ||
    (end.type === 'span' && endBlock.functionType === 'codeContent')
  ) {
    // A code block like block is selected (code, math, ...).
    state.isCodeFences = true

    // A code block line is selected.
    if (startBlock.functionType === 'codeContent' || endBlock.functionType === 'codeContent') {
      state.isCodeContent = true
    }
  }

  // Check every list level in the affiliation chain — nested lists show all
  // levels (e.g. a ul wrapping an ol checks both). Scanning the full chain (not
  // just the depth-3 loop below) keeps a deeply nested inner list checked. The
  // loose/task flags come from the INNERMOST list (the one the cursor is in);
  // the chain is outermost-first, so that is the last ul/ol entry.
  const listEntries = aff.filter((b) => b.type === 'ul' || b.type === 'ol')
  for (const entry of listEntries) {
    // Task and bullet lists are both `type: 'ul'`; distinguish by listType so a
    // chain with several kinds (e.g. ol > task > ul) checks each list menu item.
    const kind = entry.type === 'ol' ? 'ol' : entry.listType === 'task' ? 'task' : 'ul'
    state.affiliation[kind] = true
  }
  const innerList = listEntries[listEntries.length - 1]
  if (innerList) {
    // The engine's affiliation entry carries the loose flag on the list block
    // itself (derived from `meta.loose`), not via a `children` chain.
    state.isLooseListItem = !!innerList.isLooseListItem
    state.isTaskList = innerList.listType === 'task'
  }

  // Search with block depth 3 (e.g. "ul -> li -> p" where p is the actually paragraph inside the list (item)).
  for (const b of aff.slice(0, 3)) {
    if (b.type === 'pre' && b.functionType) {
      if (/frontmatter|html|multiplemath|code$/.test(b.functionType)) {
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (b.type === 'figure' && b.functionType) {
      if (b.functionType === 'table') {
        state.isTable = true
        state.isDisabled = true
        state.affiliation[b.type] = true
      } else if (b.functionType === 'diagram') {
        // Diagrams are atomic, non-formattable blocks: disable the whole
        // paragraph + format menus like a code fence, but they are not tables.
        state.isCodeFences = true
        state.affiliation[b.functionType] = true
      }
      break
    } else if (isMultiline && /^h{1,6}$/.test(b.type)) {
      // Multiple block elements are selected.
      state.affiliation = {}
      break
    } else if (b.type !== 'ul' && b.type !== 'ol') {
      // Lists are handled above (innermost only); the depth-limited scan must
      // not re-add an outer list type and check two list kinds at once.
      if (!state.affiliation[b.type]) {
        state.affiliation[b.type] = true
      }
    }
  }

  if (Object.getOwnPropertyNames(state.affiliation).length >= 2 && state.affiliation.p) {
    delete state.affiliation.p
  }
  if ((state.affiliation.ul || state.affiliation.ol) && state.affiliation.li) {
    delete state.affiliation.li
  }
  return state
}

/**
 * Creates a object that contains the formats selection state.
 */
export const createSelectionFormatState = (formats: SelectionFormat[]): Record<string, boolean> => {
  const state: Record<string, boolean> = {}
  for (const item of formats) {
    // Underline/superscript/subscript/highlight are carried as `html_tag`
    // tokens whose `tag` (u/sup/sub/mark) is the real format key the menu
    // map keys off — the bare `type` would only ever yield `html_tag`.
    const key = item.type === 'html_tag' ? (item.tag as string) : item.type
    if (key) state[key] = true
  }
  return state
}

/*
 * Convert a Pinia Proxy Object to a serializable value by applying JSON stringify and parse.
 */
function toSerializableValue<T>(value: T | null | undefined, fallback: T): T
function toSerializableValue<T>(value: T | null | undefined, fallback: null): T | null
function toSerializableValue<T>(value: T | null | undefined, fallback: T | null = null): T | null {
  if (value == null) return fallback

  try {
    return deepClone(value) as T
  } catch (err) {
    console.warn('Unable to serialize editor buffer value:', err)
    return fallback
  }
}

const createBufferedTabState = (tab: Partial<IFileState> & { id: string }): BufferedTabState => {
  return {
    id: tab.id,
    pathname: tab.pathname ?? defaultFileState.pathname,
    filename: tab.filename ?? defaultFileState.filename,
    markdown: typeof tab.markdown === 'string' ? tab.markdown : defaultFileState.markdown,
    isSaved: tab.isSaved ?? defaultFileState.isSaved,
    encoding: toSerializableValue(tab.encoding, defaultFileState.encoding),
    lineEnding: tab.lineEnding ?? defaultFileState.lineEnding,
    trimTrailingNewline:
      typeof tab.trimTrailingNewline === 'number'
        ? tab.trimTrailingNewline
        : defaultFileState.trimTrailingNewline,
    adjustLineEndingOnSave: tab.adjustLineEndingOnSave ?? defaultFileState.adjustLineEndingOnSave,
    cursor: toSerializableValue(tab.cursor, defaultFileState.cursor),
    wordCount: toSerializableValue(tab.wordCount, defaultFileState.wordCount),
    muyaIndexCursor: toSerializableValue(tab.muyaIndexCursor, defaultFileState.muyaIndexCursor),
    scrollTop: tab.scrollTop ?? defaultFileState.scrollTop
  }
}

const createBufferedRestoreWarning = (
  warning: RestoreWarning | null | undefined
): BufferedRestoreWarning | null => {
  if (!warning) return null

  const { tabId, pathname, msg, showConfirm, style, exclusiveType } = warning
  if (!tabId && !pathname) return null
  if (!msg) return null

  return {
    tabId: tabId || null,
    pathname: pathname || '',
    msg,
    showConfirm: !!showConfirm,
    style: style || 'info',
    exclusiveType: exclusiveType || ''
  }
}

const createBufferedEditorState = (state: unknown): BufferedEditorState | null => {
  const s = state as
    | {
        tabs?: unknown
        currentFileId?: string
        currentFile?: { id?: string } | null
        restoreWarnings?: unknown
      }
    | null
    | undefined
  if (!s || !Array.isArray(s.tabs)) {
    return null
  }

  return {
    currentFileId: s.currentFileId || s.currentFile?.id || null,
    tabs: (s.tabs as Array<Partial<IFileState> & { id: string }>).map(createBufferedTabState),
    restoreWarnings: Array.isArray(s.restoreWarnings)
      ? (s.restoreWarnings as RestoreWarning[])
          .map(createBufferedRestoreWarning)
          .filter((w): w is BufferedRestoreWarning => w !== null)
      : []
  }
}
