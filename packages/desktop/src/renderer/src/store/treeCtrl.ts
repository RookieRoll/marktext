import { getUniqueId } from '../util'
import { PATH_SEPARATOR } from '../config'
import { getPathBridge } from '@/platform/path'

// Helper module (NOT a Pinia store): file-tree mutation helpers.

const naturalCompare = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

interface TreeFolder {
  id?: string
  pathname: string
  name: string
  isCollapsed?: boolean
  isDirectory: true
  isFile: false
  isMarkdown: false
  folders: TreeFolder[]
  files: TreeFile[]
}

interface TreeFile {
  id?: string
  pathname: string
  name: string
  birthTime?: number | Date
  mtimeMs?: number
  isDirectory: false
  isFile: true
  isMarkdown: boolean
}

type AddFileInput = Omit<TreeFile, 'id'>

const safeTime = (v: number | undefined): number => (v !== undefined && isFinite(v) ? v : 0)

const makeFileComparator = (sortBy: string, sortOrder: string) =>
  (a: TreeFile, b: TreeFile): number => {
    let result: number
    if (sortBy === 'created') {
      const aTime = a.birthTime instanceof Date ? a.birthTime.getTime() : safeTime(Number(a.birthTime))
      const bTime = b.birthTime instanceof Date ? b.birthTime.getTime() : safeTime(Number(b.birthTime))
      result = aTime - bTime
    } else if (sortBy === 'modified') {
      result = safeTime(a.mtimeMs) - safeTime(b.mtimeMs)
    } else {
      result = naturalCompare(a.name, b.name)
    }
    const ordered = sortOrder === 'desc' ? -result : result
    if (ordered !== 0) return ordered
    // Stable tie-breaker: natural name, then full pathname
    const byName = naturalCompare(a.name, b.name)
    return byName !== 0 ? byName : a.pathname.localeCompare(b.pathname)
  }

/**
 * Return all sub-directories relative to the root directory.
 */
const getSubdirectoriesFromRoot = (rootPath: string, pathname: string): string[] => {
  if (!getPathBridge().isAbsolute(pathname)) {
    throw new Error('Invalid path!')
  }
  const relativePath = getPathBridge().relative(rootPath, pathname)
  return relativePath ? relativePath.split(PATH_SEPARATOR) : []
}

/**
 * Metadata for one entry in a batched initial directory snapshot.
 * Mirrors `TreeEntryMetadata` in the main-process watcher.
 */
export interface TreeEntryMetadata {
  pathname: string
  name: string
  isDirectory: boolean
  isFile: boolean
  isMarkdown: boolean
  birthTime?: number | Date
  mtimeMs?: number
}

const normalizeTreePath = (pathname: string): string => getPathBridge().normalize(pathname)

const isPathInsideRoot = (rootPath: string, pathname: string): boolean => {
  const relative = getPathBridge().relative(rootPath, pathname)
  return relative === '' || (!relative.startsWith('..') && !getPathBridge().isAbsolute(relative))
}

/**
 * Build a project tree from a flat metadata snapshot in a single pass.
 *
 * Opening a large project used to apply one `add`/`addDir` event per entry,
 * each of which re-walked and re-sorted the reactive tree. This builds plain
 * folders through a pathname index and sorts once, so the cost is linear in
 * the number of entries and the store commits the result exactly once.
 */
export const buildTreeFromEntries = (
  tree: TreeFolder,
  entries: readonly TreeEntryMetadata[],
  sortBy: string = 'title',
  sortOrder: string = 'asc'
): void => {
  const rootPath = normalizeTreePath(tree.pathname)
  const folders = new Map<string, TreeFolder>()
  folders.set(rootPath, tree)

  const ensureFolder = (pathname: string): TreeFolder | null => {
    const key = normalizeTreePath(pathname)
    if (!isPathInsideRoot(rootPath, key)) return null

    const existing = folders.get(key)
    if (existing) return existing
    if (key === rootPath) return tree

    const parent = ensureFolder(getPathBridge().dirname(key))
    if (!parent) return null

    const folder: TreeFolder = {
      id: getUniqueId(),
      pathname: key,
      name: getPathBridge().basename(key) || key,
      isCollapsed: true,
      isDirectory: true,
      isFile: false,
      isMarkdown: false,
      folders: [],
      files: []
    }
    parent.folders.push(folder)
    folders.set(key, folder)
    return folder
  }

  for (const entry of entries) {
    const key = normalizeTreePath(entry.pathname)
    if (!isPathInsideRoot(rootPath, key) || key === rootPath) continue

    if (entry.isDirectory) {
      const folder = ensureFolder(key)
      if (folder) folder.name = entry.name || folder.name
    }
  }

  for (const entry of entries) {
    const key = normalizeTreePath(entry.pathname)
    if (!isPathInsideRoot(rootPath, key) || key === rootPath || entry.isDirectory) continue

    const parent = ensureFolder(getPathBridge().dirname(key))
    if (!parent) continue

    parent.files.push({
      id: getUniqueId(),
      birthTime: entry.birthTime,
      mtimeMs: entry.mtimeMs,
      isDirectory: false,
      isFile: true,
      isMarkdown: entry.isMarkdown,
      name: entry.name || getPathBridge().basename(key),
      pathname: key
    })
  }

  resortTree(tree, sortBy, sortOrder)
}

export const addFile = (tree: TreeFolder, file: AddFileInput, sortBy: string = 'title', sortOrder: string = 'asc'): void => {
  const { pathname, name } = file
  const dirname = getPathBridge().dirname(pathname)
  const subDirectories = getSubdirectoriesFromRoot(tree.pathname, dirname)

  let currentPath = tree.pathname
  let currentFolder: TreeFolder = tree
  let currentSubFolders: TreeFolder[] = tree.folders
  for (const directoryName of subDirectories) {
    let childFolder = currentSubFolders.find((f) => f.name === directoryName)
    if (!childFolder) {
      childFolder = {
        id: getUniqueId(),
        pathname: `${currentPath}${PATH_SEPARATOR}${directoryName}`,
        name: directoryName,
        isCollapsed: true,
        isDirectory: true,
        isFile: false,
        isMarkdown: false,
        folders: [],
        files: []
      }
      const idx = currentSubFolders.findIndex((f) => naturalCompare(f.name, directoryName) > 0)
      if (idx !== -1) {
        currentSubFolders.splice(idx, 0, childFolder)
      } else {
        currentSubFolders.push(childFolder)
      }
    }

    currentPath = `${currentPath}${PATH_SEPARATOR}${directoryName}`
    currentFolder = childFolder
    currentSubFolders = childFolder.folders
  }

  // Add file to related directory.
  if (!currentFolder.files.find((f) => f.name === name)) {
    // Remove file content from object.
    const fileCopy: TreeFile = {
      id: getUniqueId(),
      birthTime: file.birthTime,
      mtimeMs: file.mtimeMs,
      isDirectory: file.isDirectory,
      isFile: file.isFile,
      isMarkdown: file.isMarkdown,
      name: file.name,
      pathname: file.pathname
    }

    const comparator = makeFileComparator(sortBy, sortOrder)
    const idx = currentFolder.files.findIndex((f) => comparator(f, fileCopy) > 0)
    if (idx !== -1) {
      currentFolder.files.splice(idx, 0, fileCopy)
    } else {
      currentFolder.files.push(fileCopy)
    }
  }
}

/**
 * Add a new directory to the tree list.
 */
export const addDirectory = (tree: TreeFolder, dir: { pathname: string }): void => {
  const subDirectories = getSubdirectoriesFromRoot(tree.pathname, dir.pathname)

  let currentPath = tree.pathname
  let currentSubFolders: TreeFolder[] = tree.folders
  for (const directoryName of subDirectories) {
    let childFolder = currentSubFolders.find((f) => f.name === directoryName)
    if (!childFolder) {
      childFolder = {
        id: getUniqueId(),
        pathname: `${currentPath}${PATH_SEPARATOR}${directoryName}`,
        name: directoryName,
        isCollapsed: true,
        isDirectory: true,
        isFile: false,
        isMarkdown: false,
        folders: [],
        files: []
      }
      const idx = currentSubFolders.findIndex((f) => naturalCompare(f.name, directoryName) > 0)
      if (idx !== -1) {
        currentSubFolders.splice(idx, 0, childFolder)
      } else {
        currentSubFolders.push(childFolder)
      }
    }

    currentPath = `${currentPath}${PATH_SEPARATOR}${directoryName}`
    currentSubFolders = childFolder.folders
  }
}

/**
 * Update a file's mtimeMs and re-insert it at the correct sorted position.
 * Called when a file-change event arrives so modified-time sort stays live.
 */
export const updateFileMtime = (
  tree: TreeFolder,
  file: { pathname: string; mtimeMs: number },
  sortBy: string,
  sortOrder: string
): void => {
  const dirname = getPathBridge().dirname(file.pathname)
  const subDirectories = getSubdirectoriesFromRoot(tree.pathname, dirname)

  let currentFolder: TreeFolder = tree
  let currentSubFolders: TreeFolder[] = tree.folders
  for (const directoryName of subDirectories) {
    const childFolder = currentSubFolders.find((f) => f.name === directoryName)
    if (!childFolder) return
    currentFolder = childFolder
    currentSubFolders = childFolder.folders
  }

  const index = currentFolder.files.findIndex((f) => f.pathname === file.pathname)
  if (index === -1) return

  const entry = currentFolder.files[index]
  entry.mtimeMs = file.mtimeMs

  // Re-insert only if sorting by modified time — avoids unnecessary churn otherwise.
  if (sortBy === 'modified') {
    currentFolder.files.splice(index, 1)
    const comparator = makeFileComparator(sortBy, sortOrder)
    const idx = currentFolder.files.findIndex((f) => comparator(f, entry) > 0)
    if (idx !== -1) {
      currentFolder.files.splice(idx, 0, entry)
    } else {
      currentFolder.files.push(entry)
    }
  }
}

/**
 * Re-sort an already-populated tree in place when the sort preference changes.
 */
export const resortTree = (tree: TreeFolder, sortBy: string, sortOrder: string): void => {
  tree.files.sort(makeFileComparator(sortBy, sortOrder))
  tree.folders.sort((a, b) => naturalCompare(a.name, b.name))
  for (const folder of tree.folders) {
    resortTree(folder, sortBy, sortOrder)
  }
}

/**
 * Remove the given file from the tree list.
 */
export const unlinkFile = (tree: TreeFolder, file: { pathname: string }): void => {
  const { pathname } = file
  const dirname = getPathBridge().dirname(pathname)
  const subDirectories = getSubdirectoriesFromRoot(tree.pathname, dirname)

  let currentFolder: TreeFolder = tree
  let currentSubFolders: TreeFolder[] = tree.folders
  for (const directoryName of subDirectories) {
    const childFolder = currentSubFolders.find((f) => f.name === directoryName)
    if (!childFolder) return
    currentFolder = childFolder
    currentSubFolders = childFolder.folders
  }

  const index = currentFolder.files.findIndex((f) => f.pathname === pathname)
  if (index !== -1) {
    currentFolder.files.splice(index, 1)
  }
}

/**
 * Remove the given directory from the tree list.
 */
export const unlinkDirectory = (tree: TreeFolder, dir: { pathname: string }): void => {
  const { pathname } = dir
  const subDirectories = getSubdirectoriesFromRoot(tree.pathname, pathname)

  subDirectories.pop()
  let currentFolder: TreeFolder[] = tree.folders
  for (const directoryName of subDirectories) {
    const childFolder = currentFolder.find((f) => f.name === directoryName)
    if (!childFolder) return
    currentFolder = childFolder.folders
  }

  const index = currentFolder.findIndex((f) => f.pathname === pathname)
  if (index !== -1) {
    currentFolder.splice(index, 1)
  }
}
