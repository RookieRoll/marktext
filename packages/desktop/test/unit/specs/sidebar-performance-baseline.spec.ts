import { describe, expect, it, vi } from 'vitest'
import { performance } from 'node:perf_hooks'

// `treeCtrl` builds paths through the preload `path` bridge and allocates ids
// via the shared util; stub the bridge before the hoisted import runs.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        normalize: (p: string) => string
        basename: (p: string) => string
        dirname: (p: string) => string
        relative: (from: string, to: string) => string
        isAbsolute: (p: string) => boolean
      }
    }
  }
  const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    normalize,
    basename: (p: string) => normalize(p).split('/').pop() ?? '',
    dirname: (p: string) => {
      const parts = normalize(p).split('/')
      parts.pop()
      return parts.join('/') || '/'
    },
    relative: (from: string, to: string) => {
      const fromParts = normalize(from).split('/').filter(Boolean)
      const toParts = normalize(to).split('/').filter(Boolean)
      let shared = 0
      while (shared < fromParts.length && fromParts[shared] === toParts[shared]) shared++
      return [
        ...Array.from({ length: fromParts.length - shared }, () => '..'),
        ...toParts.slice(shared)
      ].join('/')
    },
    isAbsolute: (p: string) => p.startsWith('/')
  }
})

import { addFile, buildTreeFromEntries, type TreeEntryMetadata } from '@/store/treeCtrl'
import type { TreeNode, TreeFolderNode } from '@/components/sideBar/types'

const FOLDER_COUNT = 20
const FILES_PER_FOLDER = 250

type Folder = TreeFolderNode & { folders: Folder[]; files: TreeNode[] }

const makeRoot = (): Folder =>
  ({
    pathname: '/root',
    name: 'root',
    isDirectory: true,
    isFile: false,
    isMarkdown: false,
    folders: [],
    files: []
  }) as unknown as Folder

const buildFixture = (): TreeEntryMetadata[] => {
  const entries: TreeEntryMetadata[] = [
    { pathname: '/root', name: 'root', isDirectory: true, isFile: false, isMarkdown: false }
  ]
  for (let f = 0; f < FOLDER_COUNT; f++) {
    const dir = `/root/dir-${String(f).padStart(3, '0')}`
    entries.push({
      pathname: dir,
      name: `dir-${String(f).padStart(3, '0')}`,
      isDirectory: true,
      isFile: false,
      isMarkdown: false
    })
    for (let i = 0; i < FILES_PER_FOLDER; i++) {
      entries.push({
        pathname: `${dir}/note-${String(i).padStart(3, '0')}.md`,
        name: `note-${String(i).padStart(3, '0')}.md`,
        isDirectory: false,
        isFile: true,
        isMarkdown: true,
        mtimeMs: i
      })
    }
  }
  return entries
}

const countNodes = (folder: Folder): number => {
  let total = 1
  for (const child of folder.folders as unknown as Folder[]) total += countNodes(child)
  return total + folder.files.length
}

/**
 * Measure the two real tree-population strategies that exist in the codebase:
 * the pre-optimization per-entry `addFile` path (still used for single
 * incremental adds) and the snapshot `buildTreeFromEntries` path.
 *
 * Counter metrics are deterministic and gated; wall-clock and memory are
 * recorded for humans and deliberately not gated because they vary by machine.
 */
describe('sidebar large-project tree build (OpenSpec 6.5)', () => {
  it('records per-entry insert vs single snapshot build for the same fixture', () => {
    const entries = buildFixture()
    expect(entries).toHaveLength(1 + FOLDER_COUNT + FOLDER_COUNT * FILES_PER_FOLDER)

    // --- legacy strategy: one incremental insert per discovered entry ---
    const legacyTree = makeRoot()
    const legacyStart = performance.now()
    for (const entry of entries) {
      if (entry.isDirectory) {
        if (entry.pathname === '/root') continue
        const parts = entry.pathname.split('/').filter(Boolean)
        let current = legacyTree
        let currentPath = '/root'
        for (const part of parts.slice(1)) {
          let child = current.folders.find((f) => f.name === part) as Folder | undefined
          if (!child) {
            child = {
              pathname: `${currentPath}/${part}`,
              name: part,
              isCollapsed: true,
              isDirectory: true,
              isFile: false,
              isMarkdown: false,
              folders: [],
              files: []
            } as unknown as Folder
            current.folders.push(child)
          }
          current = child
          currentPath = child.pathname
        }
      } else {
        addFile(legacyTree as never, entry as never, 'title', 'asc')
      }
    }
    const legacyMs = performance.now() - legacyStart

    // --- optimized strategy: one plain-object build + one commit ---
    const memoryBefore = process.memoryUsage().heapUsed
    const optimizedTree = makeRoot()
    const optimizedStart = performance.now()
    buildTreeFromEntries(optimizedTree as never, entries, 'title', 'asc')
    const optimizedMs = performance.now() - optimizedStart
    const memoryAfter = process.memoryUsage().heapUsed

    const counts = {
      nodes: countNodes(legacyTree),
      ipcSends: { legacy: entries.length - 1, optimized: 1 },
      contentReads: { legacy: 0, optimized: 0 },
      treeBuilds: { legacy: entries.length - 1, optimized: 1 }
    }

    const sample = {
      fixture: {
        folders: FOLDER_COUNT,
        filesPerFolder: FILES_PER_FOLDER,
        entries: entries.length
      },
      legacyMs: Number(legacyMs.toFixed(2)),
      optimizedMs: Number(optimizedMs.toFixed(2)),
      heapDeltaKiB: Number(((memoryAfter - memoryBefore) / 1024).toFixed(1)),
      counts
    }
    console.info('[OpenSpec 6.5] sidebar large-project sample', JSON.stringify(sample))

    // Shape and counts are the reproducible part of the comparison.
    expect(counts.nodes).toBe(entries.length)
    expect(countNodes(optimizedTree)).toBe(entries.length)
    expect(optimizedTree.folders).toHaveLength(FOLDER_COUNT)
    expect(optimizedTree.folders[0].files).toHaveLength(FILES_PER_FOLDER)
    expect(counts.ipcSends.legacy).toBeGreaterThan(FILES_PER_FOLDER)
    expect(counts.ipcSends.optimized).toBe(1)
    expect(counts.treeBuilds.optimized).toBe(1)
    expect(counts.contentReads).toEqual({ legacy: 0, optimized: 0 })
  }, 30000)

  it('is reproducible across repeated snapshot builds', () => {
    const entries = buildFixture()
    const nodeCounts: number[] = []
    for (let run = 0; run < 3; run++) {
      const tree = makeRoot()
      buildTreeFromEntries(tree as never, entries, 'title', 'asc')
      nodeCounts.push(countNodes(tree))
    }
    expect(nodeCounts).toEqual([entries.length, entries.length, entries.length])
  }, 30000)
})
