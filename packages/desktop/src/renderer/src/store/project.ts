import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  addFile,
  buildTreeFromEntries,
  unlinkFile,
  addDirectory,
  unlinkDirectory,
  resortTree,
  updateFileMtime
} from './treeCtrl'
import { usePreferencesStore } from './preferences'
import bus from '../bus'
import { create, paste, rename, type FileCreateType, type PasteOptions } from '../util/fileSystem'
import { PATH_SEPARATOR } from '../config'
import notice from '../services/notification'
import { getFileStateFromData } from './help'
import { useLayoutStore } from './layout'
import { useEditorStore } from './editor'
import { debouncedSendBufferedState } from './bufferedState'
import type { TreeEntryMetadata } from './treeCtrl'
import type { TreeNode } from '../components/sideBar/types'
import type { FileChangeDetail } from '@shared/types/files'
import { getFileSystemBridge } from '@/platform/filesystem'
import { getPathBridge } from '@/platform/path'
import { getElectronBridge, getIpcRenderer, getShellBridge } from '@/platform/electron'

type ProjectTree = TreeNode
type TreeChange = FileChangeDetail

const normalizeProjectRoot = (pathname: string | null | undefined): string => {
  return pathname ? getPathBridge().normalize(pathname) : ''
}

const createProjectRoot = (pathname: string): ProjectTree | null => {
  const normalizedPathname = normalizeProjectRoot(pathname)
  if (!normalizedPathname) return null

  let name = getPathBridge().basename(normalizedPathname)
  if (!name) {
    // Root directory such as "/" or "C:\"
    name = normalizedPathname
  }

  return {
    pathname: normalizedPathname,
    name,
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }
}

interface BufferedProjectState {
  rootDirectory: string
}

const createBufferedProjectState = (state: unknown): BufferedProjectState => {
  const s = (state || {}) as { rootDirectory?: string; projectTree?: { pathname?: string } }
  return {
    rootDirectory: normalizeProjectRoot(s.rootDirectory || s.projectTree?.pathname)
  }
}

interface OpenProjectOptions {
  scheduleBufferUpdate?: boolean
}

interface CreateCacheEntry {
  dirname: string
  type: 'file' | 'directory' | string
}

interface ClipboardEntry {
  type: 'copy' | 'cut' | string
  src: string
  dest?: string
}

interface PendingEvent {
  type: string
  change: TreeChange
}

export const useProjectStore = defineStore('project', () => {
  // Heterogeneous UI state: assigned file nodes, folder nodes, and the empty
  // "no selection" object/null across sidebar components; a single non-`any`
  // union breaks both the assignments and the field reads, so it stays a hatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeItem = ref<any>({})
  const createCache = ref<CreateCacheEntry | Record<string, never>>({})
  const newFileNameCache = ref<string>('')
  const renameCache = ref<string | null>(null)
  const clipboard = ref<ClipboardEntry | null>(null)
  const projectTree = ref<ProjectTree | null>(null)
  const pendingTreeEvents = ref<PendingEvent[]>([])
  // A snapshot may arrive before the project root exists (restore race) or
  // before the layout commits. Hold it keyed by root so a late OPEN_PROJECT
  // can apply it, and so switching projects cannot apply a stale snapshot.
  const pendingSnapshots = new Map<string, TreeEntryMetadata[]>()
  const SNAPSHOT_CACHE_LIMIT = 4

  const preferencesStore = usePreferencesStore()

  watch(
    [() => preferencesStore.fileSortBy, () => preferencesStore.fileSortOrder],
    ([sortBy, sortOrder]) => {
      if (projectTree.value) {
        resortTree(projectTree.value, String(sortBy), String(sortOrder))
      }
    }
  )

  function OPEN_PROJECT(
    pathname: string,
    { scheduleBufferUpdate = true }: OpenProjectOptions = {}
  ): void {
    const layoutStore = useLayoutStore()
    const tree = createProjectRoot(pathname)
    if (!tree) return

    // A snapshot may already be queued when the project is restored. Build the
    // populated tree as a plain object and commit it once, so opening a large
    // project never walks the reactive proxy entry by entry.
    const snapshot = pendingSnapshots.get(tree.pathname)
    if (snapshot) {
      pendingSnapshots.delete(tree.pathname)
      buildTreeFromEntries(
        tree,
        snapshot,
        String(preferencesStore.fileSortBy),
        String(preferencesStore.fileSortOrder)
      )
    }

    projectTree.value = tree

    const layout = {
      rightColumn: 'files',
      showSideBar: true,
      showTabBar: true
    }
    layoutStore.SET_LAYOUT(layout, { scheduleBufferUpdate })
    layoutStore.DISPATCH_LAYOUT_MENU_ITEMS()

    // Replay events that arrived before projectTree was initialized. This runs
    // after the snapshot commit above, so a scan-time create/delete/change is
    // applied on top of the snapshot instead of being dropped with it.
    const buffered = pendingTreeEvents.value
    pendingTreeEvents.value = []
    for (const event of buffered) {
      _processTreeEvent(event.type, event.change)
    }

    if (scheduleBufferUpdate) {
      debouncedSendBufferedState()
    }
  }

  function CREATE_BUFFERED_STATE(): BufferedProjectState {
    return createBufferedProjectState({
      projectTree: projectTree.value
    })
  }

  function RESTORE_BUFFERED_STATE(state: unknown): void {
    const { rootDirectory } = createBufferedProjectState(state)
    if (rootDirectory) {
      if (projectTree.value?.pathname === rootDirectory) return
      OPEN_PROJECT(rootDirectory, { scheduleBufferUpdate: false })
    } else {
      projectTree.value = null
      pendingTreeEvents.value = []
      pendingSnapshots.clear()
    }
  }

  function LISTEN_FOR_LOAD_PROJECT(): void {
    getIpcRenderer().on('mt::open-directory', (_e, pathname) => {
      OPEN_PROJECT(String(pathname))
    })
  }

  function LISTEN_FOR_UPDATE_PROJECT(): void {
    getIpcRenderer().on('mt::update-object-tree', (_e, payload) => {
      const update = payload as
        | { type: string; change: TreeChange }
        | { type: 'snapshot'; change: { pathname: string; entries: TreeEntryMetadata[] } }
      if (!update || typeof update.type !== 'string') return

      if (update.type === 'snapshot') {
        const rootPath = normalizeProjectRoot(update.change?.pathname)
        const entries = Array.isArray(update.change?.entries) ? update.change.entries : []
        if (!rootPath) return
        if (projectTree.value?.pathname === rootPath) {
          _applySnapshot(rootPath, entries)
          // Incremental events that raced ahead of the snapshot must be applied
          // on top of it, otherwise scan-time changes vanish with the swap.
          const buffered = pendingTreeEvents.value
          pendingTreeEvents.value = []
          for (const event of buffered) {
            _processTreeEvent(event.type, event.change)
          }
        } else {
          _rememberSnapshot(rootPath, entries)
        }
        return
      }

      const { type, change } = update
      if (!projectTree.value) {
        pendingTreeEvents.value.push({ type, change })
        return
      }
      _processTreeEvent(type, change)
    })
  }

  /**
   * Build the tree from a flat snapshot off the reactive proxy and commit it
   * with a single assignment, instead of mutating the live tree once per entry.
   */
  function _applySnapshot(rootPath: string, entries: TreeEntryMetadata[]): void {
    const next = createProjectRoot(rootPath)
    if (!next) return
    buildTreeFromEntries(
      next,
      entries,
      String(preferencesStore.fileSortBy),
      String(preferencesStore.fileSortOrder)
    )
    projectTree.value = next
  }

  function _rememberSnapshot(rootPath: string, entries: TreeEntryMetadata[]): void {
    pendingSnapshots.set(rootPath, entries)
    // Project switching is user-driven and rare; keep the cache small so a long
    // session cannot retain an unbounded number of large snapshots.
    while (pendingSnapshots.size > SNAPSHOT_CACHE_LIMIT) {
      const oldest = pendingSnapshots.keys().next().value
      if (oldest === undefined) break
      pendingSnapshots.delete(oldest)
    }
  }

  function _processTreeEvent(type: string, change: TreeChange): void {
    const editorStore = useEditorStore()
    switch (type) {
      case 'add': {
        const { pathname, data, isMarkdown } = change
        addFile(
          projectTree.value!,
          change as Parameters<typeof addFile>[1],
          String(preferencesStore.fileSortBy),
          String(preferencesStore.fileSortOrder)
        )
        if (isMarkdown && newFileNameCache.value && pathname === newFileNameCache.value) {
          const fileState = getFileStateFromData(data as Record<string, unknown>)
          editorStore.UPDATE_CURRENT_FILE(fileState)
          newFileNameCache.value = ''
        }
        break
      }
      case 'unlink':
        unlinkFile(projectTree.value!, change)
        editorStore.SET_SAVE_STATUS_WHEN_REMOVE(change)
        break
      case 'addDir':
        addDirectory(projectTree.value!, change)
        break
      case 'unlinkDir':
        unlinkDirectory(projectTree.value!, change)
        break
      case 'change':
        if (change?.mtimeMs !== undefined) {
          updateFileMtime(
            projectTree.value!,
            change as Parameters<typeof updateFileMtime>[1],
            String(preferencesStore.fileSortBy),
            String(preferencesStore.fileSortOrder)
          )
        }
        break
      default:
        if (getElectronBridge().process?.env?.NODE_ENV === 'development') {
          console.log(`Unknown directory watch type: "${type}"`)
        }
        break
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CHANGE_ACTIVE_ITEM(item: any): void {
    activeItem.value = item
  }

  function CHANGE_CLIPBOARD(data: ClipboardEntry | null): void {
    clipboard.value = data
  }

  function ASK_FOR_OPEN_PROJECT(): void {
    getIpcRenderer().send('mt::ask-for-open-project-in-sidebar')
  }

  function LISTEN_FOR_SIDEBAR_CONTEXT_MENU(): void {
    bus.on('SIDEBAR::show-in-folder', () => {
      const { pathname } = activeItem.value
      getShellBridge().showItemInFolder(pathname)
    })
    bus.on('SIDEBAR::new', (type: unknown) => {
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : getPathBridge().dirname(pathname)
      createCache.value = { dirname, type: String(type) }
      bus.emit('SIDEBAR::show-new-input')
    })
    bus.on('SIDEBAR::remove', () => {
      const { pathname } = activeItem.value
      getIpcRenderer()
        .invoke('mt::fs-trash-item', pathname)
        .catch((err) => {
          notice.notify({
            title: 'Error while deleting',
            type: 'error',
            message: err instanceof Error ? err.message : String(err)
          })
        })
    })
    bus.on('SIDEBAR::copy-cut', (type: unknown) => {
      const { pathname: src } = activeItem.value
      clipboard.value = { type: String(type), src }
    })
    bus.on('SIDEBAR::paste', () => {
      const cb = clipboard.value
      const { pathname, isDirectory } = activeItem.value
      const dirname = isDirectory ? pathname : getPathBridge().dirname(pathname)
      if (cb && cb.src) {
        cb.dest = dirname + PATH_SEPARATOR + getPathBridge().basename(cb.src)

        if (getPathBridge().normalize(cb.src) === getPathBridge().normalize(cb.dest)) {
          notice.notify({
            title: 'Paste Forbidden',
            type: 'warning',
            message: 'Source and destination must not be the same.'
          })
          return
        }

        paste(cb as PasteOptions)
          .then(() => {
            clipboard.value = null
          })
          .catch((err) => {
            notice.notify({
              title: 'Error while pasting',
              type: 'error',
              message: err instanceof Error ? err.message : String(err)
            })
          })
      }
    })
    bus.on('SIDEBAR::rename', () => {
      const { pathname } = activeItem.value
      renameCache.value = pathname
      bus.emit('SIDEBAR::show-rename-input')
    })
  }

  async function CREATE_FILE_DIRECTORY(name: string): Promise<void> {
    const cache = createCache.value as CreateCacheEntry
    const { dirname, type } = cache

    if (type === 'file' && !getFileSystemBridge().hasMarkdownExtension(name)) {
      name += '.md'
    }

    const fullName = `${dirname}/${name}`

    // Creating over an existing path would silently overwrite it (outputFile
    // truncates). Refuse instead of destroying the existing file (#1946).
    if (await getFileSystemBridge().pathExists(fullName)) {
      createCache.value = {}
      notice.notify({
        title: 'Error in Side Bar',
        type: 'error',
        message: `A ${type} named "${name}" already exists in this folder.`
      })
      return
    }

    create(fullName, type as FileCreateType)
      .then(() => {
        createCache.value = {}
        if (type === 'file') {
          newFileNameCache.value = fullName
        }
      })
      .catch((err) => {
        notice.notify({
          title: 'Error in Side Bar',
          type: 'error',
          message: err instanceof Error ? err.message : String(err)
        })
      })
  }

  function RENAME_IN_SIDEBAR(name: string): void {
    const editorStore = useEditorStore()
    const src = renameCache.value
    if (!src) return
    const dirname = getPathBridge().dirname(src)
    const dest = dirname + PATH_SEPARATOR + name
    rename(src, dest).then(() => {
      editorStore.RENAME_IF_NEEDED({ src, dest })
    })
  }

  function OPEN_SETTING_WINDOW(): void {
    getIpcRenderer().send('mt::open-setting-window')
  }

  return {
    activeItem,
    createCache,
    newFileNameCache,
    renameCache,
    clipboard,
    projectTree,
    pendingTreeEvents,
    OPEN_PROJECT,
    CREATE_BUFFERED_STATE,
    RESTORE_BUFFERED_STATE,
    LISTEN_FOR_LOAD_PROJECT,
    LISTEN_FOR_UPDATE_PROJECT,
    CHANGE_ACTIVE_ITEM,
    CHANGE_CLIPBOARD,
    ASK_FOR_OPEN_PROJECT,
    LISTEN_FOR_SIDEBAR_CONTEXT_MENU,
    CREATE_FILE_DIRECTORY,
    RENAME_IN_SIDEBAR,
    OPEN_SETTING_WINDOW
  }
})
