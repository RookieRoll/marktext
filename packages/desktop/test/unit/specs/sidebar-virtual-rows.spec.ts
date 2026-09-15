import { describe, expect, it } from 'vitest'
import {
  TREE_ROW_HEIGHT,
  ancestorPathnames,
  buildVisibleRows,
  findNodeByPathname,
  findRowIndexByPathname,
  getVirtualRange,
  type TreeRow
} from '@/components/sideBar/visibleRows'
import type { TreeFileNode, TreeFolderNode, TreeNode } from '@/components/sideBar/types'

const file = (pathname: string): TreeFileNode => ({
  pathname,
  name: pathname.split('/').pop() as string,
  isDirectory: false,
  isFile: true,
  isMarkdown: pathname.endsWith('.md')
})

const folder = (
  pathname: string,
  children: { folders?: TreeFolderNode[]; files?: TreeFileNode[] } = {}
): TreeFolderNode => ({
  pathname,
  name: pathname.split('/').pop() as string,
  isCollapsed: true,
  isDirectory: true,
  isFile: false,
  isMarkdown: false,
  folders: children.folders ?? [],
  files: children.files ?? []
})

const root = (folders: TreeFolderNode[] = [], files: TreeFileNode[] = []): TreeNode => ({
  pathname: '/root',
  name: 'root',
  isDirectory: true,
  isFile: false,
  isMarkdown: false,
  folders,
  files
})

const expandAll = (expand: string[]) => (f: TreeFolderNode) => expand.includes(f.pathname)

const kinds = (rows: TreeRow[]): string[] => rows.map((r) => `${r.kind}:${r.pathname}`)

describe('buildVisibleRows', () => {
  it('emits one row per collapsed folder and its siblings, folders before files', () => {
    const tree = root(
      [folder('/root/a', { files: [file('/root/a/a1.md')] }), folder('/root/b')],
      [file('/root/z.md')]
    )

    expect(kinds(buildVisibleRows(tree, { isExpanded: () => false }))).toEqual([
      'folder:/root/a',
      'folder:/root/b',
      'file:/root/z.md'
    ])
  })

  it('expands a folder into its create row, child folders and files in order', () => {
    const tree = root(
      [
        folder('/root/a', {
          folders: [folder('/root/a/sub')],
          files: [file('/root/a/one.md'), file('/root/a/two.md')]
        })
      ],
      []
    )

    expect(
      kinds(
        buildVisibleRows(tree, {
          isExpanded: expandAll(['/root/a']),
          createDirname: '/root/a'
        })
      )
    ).toEqual([
      'folder:/root/a',
      'create-input:/root/a',
      'folder:/root/a/sub',
      'file:/root/a/one.md',
      'file:/root/a/two.md'
    ])
  })

  it('nests depth by level and keeps descendants hidden while collapsed', () => {
    const tree = root([
      folder('/root/a', {
        files: [file('/root/a/one.md')],
        folders: [folder('/root/a/sub', { files: [file('/root/a/sub/deep.md')] })]
      })
    ])

    const collapsed = buildVisibleRows(tree, { isExpanded: () => false })
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].depth).toBe(0)

    const expanded = buildVisibleRows(tree, { isExpanded: () => true })
    expect(expanded.map((r) => [r.pathname, r.depth])).toEqual([
      ['/root/a', 0],
      ['/root/a/sub', 1],
      ['/root/a/sub/deep.md', 2],
      ['/root/a/one.md', 1]
    ])
  })

  it('renders the project-root create input above every child row', () => {
    const tree = root([folder('/root/a')], [file('/root/z.md')])
    const rows = buildVisibleRows(tree, { isExpanded: () => false, createDirname: '/root' })
    expect(kinds(rows)).toEqual([
      'create-input:/root',
      'folder:/root/a',
      'file:/root/z.md'
    ])
    expect(rows[0].depth).toBe(0)
  })

  it('uses a stable key per logical row that survives reordering', () => {
    const a = folder('/root/a')
    const b = folder('/root/b')
    const before = buildVisibleRows(root([a, b]), { isExpanded: () => false })
    const after = buildVisibleRows(root([b, a]), { isExpanded: () => false })

    // Reordering the tree must not change any row's key: identity is the path.
    const keyOf = (rows: TreeRow[], pathname: string) =>
      rows.find((r) => r.pathname === pathname)?.key
    expect(keyOf(before, '/root/a')).toBe(keyOf(after, '/root/a'))
    expect(new Set(before.map((r) => r.key)).size).toBe(before.length)
  })
})

describe('findRowIndexByPathname / findNodeByPathname', () => {
  it('finds a visible row index and type', () => {
    const tree = root([folder('/root/a')], [file('/root/z.md')])
    const rows = buildVisibleRows(tree, { isExpanded: () => false })
    expect(findRowIndexByPathname(rows, '/root/a')).toBe(0)
    expect(findRowIndexByPathname(rows, '/root/a', 'file')).toBe(-1)
    expect(findRowIndexByPathname(rows, '/root/z.md', 'file')).toBe(1)
    expect(findRowIndexByPathname(rows, '/root/missing')).toBe(-1)
  })

  it('finds nodes that are hidden inside collapsed folders', () => {
    const tree = root([
      folder('/root/a', { folders: [folder('/root/a/sub', { files: [file('/root/a/sub/x.md')] })] })
    ])
    expect(findNodeByPathname(tree, '/root/a/sub/x.md')?.isFile).toBe(true)
    expect(findNodeByPathname(tree, '/root/a/sub')?.isDirectory).toBe(true)
    expect(findNodeByPathname(tree, '/root')).toBe(tree)
    expect(findNodeByPathname(tree, '/root/nope')).toBeUndefined()
  })
})

describe('getVirtualRange', () => {
  it('mounts only a window of rows plus overscan for a large list', () => {
    const range = getVirtualRange({
      scrollTop: 0,
      viewportHeight: 600,
      rowCount: 5000,
      overscan: 4
    })
    expect(range.start).toBe(0)
    // 600px viewport / 30px rows = 20 visible, plus 4 rows of overscan above
    // and below (the top edge cannot overscan above row 0).
    expect(range.end).toBe(28)
    expect(range.end - range.start).toBeLessThan(100)
    expect(range.totalHeight).toBe(5000 * TREE_ROW_HEIGHT)
  })

  it('clamps the window at the end of the list so all rows stay reachable', () => {
    const rowCount = 200
    const total = rowCount * TREE_ROW_HEIGHT
    const range = getVirtualRange({
      scrollTop: total,
      viewportHeight: 600,
      rowCount,
      overscan: 4
    })
    expect(range.end).toBe(rowCount)
    expect(range.start).toBeGreaterThan(0)
    expect(range.offsetY + range.totalHeight).toBeGreaterThanOrEqual(total)
  })

  it('reports an empty range and zero height when there are no rows', () => {
    expect(getVirtualRange({ scrollTop: 0, viewportHeight: 600, rowCount: 0 })).toEqual({
      start: 0,
      end: 0,
      offsetY: 0,
      totalHeight: 0
    })
  })

  it('never mounts more rows than exist, even with a huge overscan', () => {
    const range = getVirtualRange({
      scrollTop: 0,
      viewportHeight: 600,
      rowCount: 3,
      overscan: 50
    })
    expect(range.start).toBe(0)
    expect(range.end).toBe(3)
  })
})

describe('large project mounted-row bound', () => {
  // A fixture shaped like a real project: many folders, each with many files.
  const buildLargeTree = (folderCount: number, filesPerFolder: number): TreeNode =>
    root(
      Array.from({ length: folderCount }, (_, f) => {
        const dir = `/root/dir-${String(f).padStart(3, '0')}`
        return folder(
          dir,
          {
            files: Array.from({ length: filesPerFolder }, (_, i) =>
              file(`${dir}/note-${String(i).padStart(3, '0')}.md`)
            )
          }
        )
      })
    )

  it('mounts only a viewport-sized window even with thousands of visible rows', () => {
    const tree = buildLargeTree(20, 250)
    const rows = buildVisibleRows(tree, { isExpanded: () => true })
    expect(rows).toHaveLength(20 + 20 * 250)

    const range = getVirtualRange({
      scrollTop: 0,
      viewportHeight: 600,
      rowCount: rows.length
    })
    const mounted = range.end - range.start
    // 5020 logical rows collapse to well under 50 mounted rows.
    expect(mounted).toBeLessThan(50)
    expect(mounted / rows.length).toBeLessThan(0.01)
  })

  it('keeps mounted rows bounded at every scroll position', () => {
    const tree = buildLargeTree(20, 250)
    const rows = buildVisibleRows(tree, { isExpanded: () => true })
    const totalHeight = rows.length * TREE_ROW_HEIGHT

    for (let scrollTop = 0; scrollTop <= totalHeight; scrollTop += 977) {
      const range = getVirtualRange({ scrollTop, viewportHeight: 600, rowCount: rows.length })
      expect(range.end - range.start).toBeLessThan(50)
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeLessThanOrEqual(rows.length)
      // The mounted window must always overlap the visible viewport.
      expect(range.start * TREE_ROW_HEIGHT).toBeLessThanOrEqual(scrollTop)
      expect(range.end * TREE_ROW_HEIGHT).toBeGreaterThanOrEqual(
        Math.min(scrollTop + 600, totalHeight)
      )
    }
  })

  it('lets the scrollbar reach the last logical row exactly', () => {
    const tree = buildLargeTree(5, 100)
    const rows = buildVisibleRows(tree, { isExpanded: () => true })
    const totalHeight = rows.length * TREE_ROW_HEIGHT

    // Scrolled fully to the bottom (max scrollTop = totalHeight - rowHeight).
    const range = getVirtualRange({
      scrollTop: totalHeight - TREE_ROW_HEIGHT,
      viewportHeight: 600,
      rowCount: rows.length
    })
    expect(range.end).toBe(rows.length)
    expect(rows[range.end - 1].key).toBe(rows[rows.length - 1].key)
  })
})
describe('ancestorPathnames', () => {
  it('returns every folder between the root and the target, outermost first', () => {
    expect(ancestorPathnames('/root', '/root/a/b/c.md', '/')).toEqual([
      '/root/a',
      '/root/a/b'
    ])
  })

  it('returns nothing for the root itself or an unrelated path', () => {
    expect(ancestorPathnames('/root', '/root', '/')).toEqual([])
    expect(ancestorPathnames('/root', '/other/a.md', '/')).toEqual([])
  })
})
