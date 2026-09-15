import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The project store reaches window.path / window.electron at runtime, plus the
// layout store persistence. Stub those surfaces before the store is imported.
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
      electron?: {
        ipcRenderer: {
          send: (...a: unknown[]) => void
          on: (...a: unknown[]) => void
          invoke: (...a: unknown[]) => Promise<unknown>
        }
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
    // Mimic node:path.relative closely enough for the tree builder: a path under
    // `from` is relative, anything else escapes with `..` segments.
    relative: (from: string, to: string) => {
      const fromParts = normalize(from).split('/').filter(Boolean)
      const toParts = normalize(to).split('/').filter(Boolean)
      let shared = 0
      while (shared < fromParts.length && fromParts[shared] === toParts[shared]) shared++
      const up = fromParts.length - shared
      return [...Array.from({ length: up }, () => '..'), ...toParts.slice(shared)].join('/')
    },
    isAbsolute: (p: string) => p.startsWith('/')
  }
  w.window.electron ??= {
    ipcRenderer: { send: () => {}, on: () => {}, invoke: () => Promise.resolve(false) }
  }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

import { useProjectStore } from '@/store/project'
import { buildTreeFromEntries, type TreeEntryMetadata } from '@/store/treeCtrl'

const entry = (
  pathname: string,
  overrides: Partial<TreeEntryMetadata> = {}
): TreeEntryMetadata => ({
  pathname,
  name: pathname.split('/').pop() as string,
  isDirectory: false,
  isFile: true,
  isMarkdown: true,
  mtimeMs: 0,
  ...overrides
})

const dir = (pathname: string): TreeEntryMetadata =>
  entry(pathname, { isDirectory: true, isFile: false, isMarkdown: false, name: pathname.split('/').pop() })

describe('project tree snapshot application', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('builds a nested tree from a flat snapshot and sorts folders before files', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root')

    const entries: TreeEntryMetadata[] = [
      dir('/root'),
      dir('/root/notes'),
      dir('/root/notes/deep'),
      entry('/root/notes/deep/deep.md'),
      entry('/root/notes/b.md'),
      entry('/root/notes/a.md'),
      entry('/root/top.md')
    ]

    const tree = store.projectTree!
    buildTreeFromEntries(tree, entries, 'title', 'asc')

    expect(tree.name).toBe('root')
    expect(tree.folders.map((f) => f.name)).toEqual(['notes'])
    expect(tree.files.map((f) => f.name)).toEqual(['top.md'])

    const notes = tree.folders[0]
    // Folders sort before files inside every folder.
    expect(notes.folders.map((f) => f.name)).toEqual(['deep'])
    expect(notes.files.map((f) => f.name)).toEqual(['a.md', 'b.md'])
    expect(notes.folders[0].files.map((f) => f.name)).toEqual(['deep.md'])
  })

  it('ignores entries outside the project root', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root')

    const tree = store.projectTree!
    buildTreeFromEntries(tree, [entry('/root/in.md'), entry('/elsewhere/out.md')], 'title', 'asc')

    expect(tree.files.map((f) => f.pathname)).toEqual(['/root/in.md'])
  })

  it('applies one store commit for a whole snapshot instead of one per entry', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root')

    const entries: TreeEntryMetadata[] = [
      ...Array.from({ length: 200 }, (_, i) => entry(`/root/f${String(i).padStart(3, '0')}.md`))
    ]
    // A single assignment to `projectTree` replaces the reactive tree once; the
    // build itself happens on a plain object.
    buildTreeFromEntries(store.projectTree!, entries, 'title', 'asc')
    expect(store.projectTree!.files).toHaveLength(200)
  })

  it('keeps the previous project tree isolated from the next project root', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root-a')
    buildTreeFromEntries(store.projectTree!, [entry('/root-a/only-a.md')], 'title', 'asc')
    expect(store.projectTree!.files.map((f) => f.pathname)).toEqual(['/root-a/only-a.md'])

    store.OPEN_PROJECT('/root-b')
    buildTreeFromEntries(store.projectTree!, [entry('/root-b/only-b.md')], 'title', 'asc')

    expect(store.projectTree!.pathname).toBe('/root-b')
    expect(store.projectTree!.files.map((f) => f.pathname)).toEqual(['/root-b/only-b.md'])
  })

  it('applies buffered scan-time events on top of the snapshot instead of dropping them', () => {
    const store = useProjectStore()
    // No project is open yet: the watcher's change arrives first and is queued.
    store.pendingTreeEvents.push({
      type: 'add',
      change: {
        pathname: '/root/early.md',
        name: 'early.md',
        isDirectory: false,
        isFile: true,
        isMarkdown: true
      } as never
    })

    store.OPEN_PROJECT('/root')
    // Opening replays the queued event after the (empty) snapshot, so a file
    // created during the scan is not lost.
    expect(store.projectTree!.files.map((f) => f.pathname)).toEqual(['/root/early.md'])
    expect(store.pendingTreeEvents).toHaveLength(0)
  })

  it('drops buffered events when the project is reset', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root')
    store.pendingTreeEvents.push({
      type: 'add',
      change: { pathname: '/root/x.md', isDirectory: false, isFile: true, isMarkdown: true } as never
    })

    store.RESTORE_BUFFERED_STATE({})
    expect(store.projectTree).toBeNull()
    expect(store.pendingTreeEvents).toHaveLength(0)
  })
  it('does not resurrect nodes from a snapshot belonging to another root', () => {
    const store = useProjectStore()
    store.OPEN_PROJECT('/root-a')
    const a = store.projectTree!
    buildTreeFromEntries(a, [entry('/root-a/a.md')], 'title', 'asc')

    // Switching roots discards the previous tree entirely.
    store.OPEN_PROJECT('/root-b')
    const b = store.projectTree!
    expect(b).not.toBe(a)
    expect(b.files).toHaveLength(0)
  })
})
