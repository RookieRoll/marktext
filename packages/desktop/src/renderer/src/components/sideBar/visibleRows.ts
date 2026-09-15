// Flatten the logical project tree into the ordered list of rows the sidebar
// actually shows.
//
// The previous renderer was recursive (tree.vue -> treeFolder.vue ->
// treeFile.vue), so every expanded node created one component, one DOM row and
// its own listeners; expanding a folder with thousands of children mounted
// thousands of rows. The tree container now derives this flat array instead and
// only renders the slice that intersects the viewport.
//
// Flattening is intentionally pure: expansion state and the active create
// target are passed in, so the row sequence can be unit tested without mounting
// anything.

import type { SidebarTreeNode, TreeFolderNode, TreeNode } from './types'

/** Fixed row height in px. The virtual list positions rows on this grid. */
export const TREE_ROW_HEIGHT = 30

export type TreeRowKind = 'folder' | 'file' | 'create-input'

export interface TreeRow {
  /**
   * Stable identity for the logical row. Vue reuses a mounted row only while
   * the key still maps to the same logical node, so scrolling can never
   * re-label a row with a different file.
   */
  key: string
  /** Logical node path. Routing (context menu, rename, create) uses this. */
  pathname: string
  /** Indentation level; root-level children are depth 0. */
  depth: number
  kind: TreeRowKind
  /** The folder/file this row represents; the owning folder for create rows. */
  node: SidebarTreeNode
  /** Only meaningful for `kind === 'folder'`. */
  isExpanded: boolean
}

export interface FlattenOptions {
  /** Whether a folder's children are currently shown. */
  isExpanded: (folder: TreeFolderNode) => boolean
  /**
   * Directory that currently owns the "new file/folder" input. The input
   * becomes its own row in the position the previous renderer used (before that
   * folder's files).
   */
  createDirname?: string
}

export const folderRowKey = (pathname: string): string => `folder:${pathname}`
export const fileRowKey = (pathname: string): string => `file:${pathname}`
export const createRowKey = (pathname: string): string => `create:${pathname}`

/**
 * Depth-first flattening that mirrors the previous recursive render order: root
 * children first, and for every expanded folder its create-input row (when it
 * owns the input) followed by sub-folders and files.
 *
 * Folders keep the "directories before files" order the tree store already
 * produced, so flattening never re-sorts.
 */
export const buildVisibleRows = (tree: TreeNode, options: FlattenOptions): TreeRow[] => {
  const rows: TreeRow[] = []

  const pushCreateRow = (folder: SidebarTreeNode, depth: number): void => {
    rows.push({
      key: createRowKey(folder.pathname),
      pathname: folder.pathname,
      depth,
      kind: 'create-input',
      node: folder,
      isExpanded: true
    })
  }

  const pushFolder = (folder: TreeFolderNode, depth: number): void => {
    const expanded = options.isExpanded(folder)
    rows.push({
      key: folderRowKey(folder.pathname),
      pathname: folder.pathname,
      depth,
      kind: 'folder',
      node: folder,
      isExpanded: expanded
    })
    if (!expanded) return

    if (options.createDirname === folder.pathname) pushCreateRow(folder, depth)
    for (const child of folder.folders) pushFolder(child, depth + 1)
    for (const file of folder.files) {
      rows.push({
        key: fileRowKey(file.pathname),
        pathname: file.pathname,
        depth: depth + 1,
        kind: 'file',
        node: file,
        isExpanded: false
      })
    }
  }

  // The project root is rendered as the section title, so only its children
  // become rows. Its create input sits at the top of the list, matching the
  // previous template order (input before root folders/files).
  if (options.createDirname === tree.pathname) pushCreateRow(tree, 0)
  for (const child of tree.folders) pushFolder(child, 0)
  for (const file of tree.files) {
    rows.push({
      key: fileRowKey(file.pathname),
      pathname: file.pathname,
      depth: 0,
      kind: 'file',
      node: file,
      isExpanded: false
    })
  }

  return rows
}

/**
 * Index of the row for a logical pathname, or -1.
 *
 * A collapsed folder contributes exactly one row, so callers that need to
 * reveal a descendant must expand its ancestors and flatten again first.
 */
export const findRowIndexByPathname = (
  rows: readonly TreeRow[],
  pathname: string,
  kind?: TreeRowKind
): number =>
  rows.findIndex((row) => row.pathname === pathname && (kind === undefined || row.kind === kind))

/**
 * Find a logical node (folder or file) by pathname.
 *
 * Row-based lookups only see currently visible rows, which is not enough to
 * decide whether a rename target is a folder: a folder nested in a collapsed
 * parent still needs its ancestors expanded before it can be focused.
 */
export const findNodeByPathname = (
  tree: TreeNode,
  pathname: string
): SidebarTreeNode | undefined => {
  if (!pathname) return undefined
  if (tree.pathname === pathname) return tree
  const stack: SidebarTreeNode[] = [...tree.folders, ...tree.files]
  while (stack.length > 0) {
    const node = stack.pop() as SidebarTreeNode
    if (node.pathname === pathname) return node
    if (node.isDirectory) {
      const folder = node as TreeFolderNode
      stack.push(...folder.folders, ...folder.files)
    }
  }
  return undefined
}
export interface VirtualRange {
  /** First mounted row index. */
  start: number
  /** One past the last mounted row index. */
  end: number
  /** Scroll offset of `start`, used to translate the rendered slice. */
  offsetY: number
  /** Spacer height covering every logical row. */
  totalHeight: number
}

/**
 * Rows to mount for a viewport, plus the spacer height that keeps the scrollbar
 * proportional to the full logical row count, so the thumb reaches the bottom
 * exactly when the last row does.
 */
export const getVirtualRange = (options: {
  scrollTop: number
  viewportHeight: number
  rowCount: number
  rowHeight?: number
  /** Extra rows mounted above/below the viewport to avoid blank flashes. */
  overscan?: number
}): VirtualRange => {
  const rowHeight = options.rowHeight ?? TREE_ROW_HEIGHT
  const overscan = options.overscan ?? 6
  const rowCount = Math.max(0, options.rowCount)
  const totalHeight = rowCount * rowHeight
  if (rowCount === 0) return { start: 0, end: 0, offsetY: 0, totalHeight: 0 }

  const maxScrollTop = Math.max(0, totalHeight - rowHeight)
  const scrollTop = Math.max(0, Math.min(options.scrollTop, maxScrollTop))
  const visibleCount = Math.max(1, Math.ceil(Math.max(0, options.viewportHeight) / rowHeight))
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(rowCount, start + visibleCount + overscan * 2)
  return { start, end, offsetY: start * rowHeight, totalHeight }
}

const hasPathPrefix = (pathname: string, root: string, separator: string): boolean => {
  if (!root) return false
  return (
    pathname.startsWith(`${root}${separator}`) ||
    pathname.startsWith(`${root}/`) ||
    pathname.startsWith(`${root}\\`)
  )
}

/**
 * Ancestor pathnames of `pathname` strictly below `rootPath`, outermost first.
 * The result never includes `pathname` itself, so it is safe to treat every
 * entry as a folder that must be expanded to reveal the target.
 */
export const ancestorPathnames = (
  rootPath: string,
  pathname: string,
  separator: string
): string[] => {
  if (!rootPath || !pathname) return []
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  if (pathname === normalizedRoot) return []
  if (!hasPathPrefix(pathname, normalizedRoot, separator)) return []

  const rest = pathname.slice(normalizedRoot.length).replace(/^[\\/]+/, '')
  if (!rest) return []

  const segments = rest.split(/[\\/]+/).slice(0, -1)
  const ancestors: string[] = []
  let current = normalizedRoot
  for (const segment of segments) {
    if (!segment) continue
    current = `${current}${separator}${segment}`
    ancestors.push(current)
  }
  return ancestors
}
