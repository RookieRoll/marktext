import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Initial project-tree discovery must not read Markdown content. The directory
// watcher used to call `loadMarkdownFile` for every file chokidar reported,
// which made opening a large project an O(files) disk + IPC cost. These tests
// pin the metadata-only, single-snapshot contract.

type EventHandler = (...args: unknown[]) => unknown

type FakeWatcher = {
  on: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  unwatch: ReturnType<typeof vi.fn>
  add: ReturnType<typeof vi.fn>
  emit: (event: string, ...args: unknown[]) => unknown
}

const watchMock = vi.fn()
const fakeWatchers: FakeWatcher[] = []
const loadMarkdownFileMock = vi.hoisted(() => vi.fn())

function createFakeWatcher(): FakeWatcher {
  const handlers = new Map<string, EventHandler[]>()
  const fakeWatcher: FakeWatcher = {
    on: vi.fn((event: string, handler: EventHandler) => {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return fakeWatcher
    }),
    close: vi.fn(() => Promise.resolve()),
    unwatch: vi.fn(() => fakeWatcher),
    add: vi.fn(() => fakeWatcher),
    emit: (event: string, ...args: unknown[]) => {
      const list = handlers.get(event) ?? []
      return list.map((handler) => handler(...args))
    }
  }
  return fakeWatcher
}

vi.mock('chokidar', () => ({
  default: {
    watch: (...args: unknown[]) => {
      watchMock(...args)
      const watcher = createFakeWatcher()
      fakeWatchers.push(watcher)
      return watcher
    }
  }
}))

vi.mock('main_renderer/filesystem/markdown', () => ({
  loadMarkdownFile: loadMarkdownFileMock
}))

vi.mock('ced', () => ({ default: () => 'UTF-8' }))
vi.mock('main_renderer/config', () => ({ isLinux: false, isOsx: false }))

import Watcher from 'main_renderer/filesystem/watcher'

const flush = async(): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * The snapshot is emitted only after every pending metadata `stat` settles, so
 * waiting a fixed number of ticks is racy under parallel test load. Poll until
 * the batch the test expects has been delivered.
 */
const waitForSnapshot = async(send: { mock: { calls: unknown[][] } }): Promise<void> => {
  const hasSnapshot = (): boolean =>
    send.mock.calls.some((call) => (call[1] as { type?: string } | undefined)?.type === 'snapshot')
  for (let i = 0; i < 400; i++) {
    if (hasSnapshot()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the initial project-tree snapshot')
}

/**
 * Generate a large, deterministic project fixture: `folders` directories at the
 * root, each holding `files` Markdown files. Returns paths in a fixed order so
 * counts, depth and sort inputs are reproducible across runs.
 */
const buildLargeFixture = async(
  root: string,
  folders: number,
  filesPerFolder: number
): Promise<{ filePaths: string[]; folderPaths: string[] }> => {
  const filePaths: string[] = []
  const folderPaths: string[] = []
  for (let f = 0; f < folders; f++) {
    const dir = path.join(root, `dir-${String(f).padStart(3, '0')}`)
    await mkdir(dir, { recursive: true })
    folderPaths.push(dir)
    for (let i = 0; i < filesPerFolder; i++) {
      const filePath = path.join(dir, `note-${String(i).padStart(3, '0')}.md`)
      await writeFile(filePath, `# note ${i}`)
      filePaths.push(filePath)
    }
  }
  return { filePaths, folderPaths }
}

describe('directory watcher initial snapshot', () => {
  const send = vi.fn()
  const win = {
    id: 1,
    isDestroyed: vi.fn(() => false),
    webContents: { send }
  }
  const preferences = {
    getItem: vi.fn((key: string) => (key === 'watcherUsePolling' ? false : [])),
    getPreferredEol: vi.fn(() => 'lf'),
    getAll: vi.fn(() => ({
      autoGuessEncoding: true,
      trimTrailingNewline: 2,
      autoNormalizeLineEndings: false
    }))
  }
  let watcher: Watcher
  let tempDirectory: string

  beforeEach(async() => {
    vi.useRealTimers()
    fakeWatchers.length = 0
    watchMock.mockClear()
    send.mockClear()
    loadMarkdownFileMock.mockClear()
    loadMarkdownFileMock.mockResolvedValue({ markdown: '# loaded' })
    watcher = new Watcher(preferences as never)
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'marktext-snapshot-'))
  })

  afterEach(async() => {
    watcher.close()
    // Windows reports ENOTEMPTY/EBUSY while handles from the large-fixture
    // writes are still closing; maxRetries is node's built-in handling.
    await rm(tempDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    vi.useRealTimers()
  })

  it('does not read Markdown content while discovering the initial tree', async() => {
    const a = path.join(tempDirectory, 'a.md')
    const b = path.join(tempDirectory, 'b.md')
    await writeFile(a, '# a')
    await writeFile(b, '# b')

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', a)
    fakeWatcher.emit('add', b)
    fakeWatcher.emit('addDir', tempDirectory)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    expect(loadMarkdownFileMock).not.toHaveBeenCalled()
  })

  it('delivers the discovered entries as a single snapshot', async() => {
    const a = path.join(tempDirectory, 'a.md')
    const b = path.join(tempDirectory, 'b.md')
    await writeFile(a, '# a')
    await writeFile(b, '# b')

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', a)
    fakeWatcher.emit('add', b)
    fakeWatcher.emit('addDir', tempDirectory)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    const snapshotCalls = send.mock.calls.filter((call) => {
      const payload = call[1] as { type?: string; change?: { pathname?: string; entries?: unknown[] } }
      return payload?.type === 'snapshot'
    })
    expect(snapshotCalls).toHaveLength(1)

    const entries = (snapshotCalls[0][1] as { change: { entries: Array<{ pathname: string; isMarkdown: boolean }> } })
      .change.entries
    const markdownEntries = entries.filter((entry) => entry.isMarkdown).map((entry) => entry.pathname)
    expect(markdownEntries.sort()).toEqual([a, b].sort())
    expect(entries.some((entry) => entry.pathname === tempDirectory)).toBe(true)
    // One snapshot, not one IPC message per discovered node.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends metadata only and omits file content from the snapshot', async() => {
    const a = path.join(tempDirectory, 'a.md')
    await writeFile(a, '# a')
    await mkdir(path.join(tempDirectory, 'nested'), { recursive: true })

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', a)
    fakeWatcher.emit('addDir', path.join(tempDirectory, 'nested'))
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    const payload = send.mock.calls[0][1] as {
      change: { entries: Array<Record<string, unknown>> }
    }
    for (const entry of payload.change.entries) {
      expect(entry).not.toHaveProperty('data')
      expect(typeof entry.pathname).toBe('string')
      expect(typeof entry.name).toBe('string')
      expect(typeof entry.isDirectory).toBe('boolean')
      expect(typeof entry.isFile).toBe('boolean')
      expect(typeof entry.isMarkdown).toBe('boolean')
      expect(typeof entry.mtimeMs).toBe('number')
    }
  })

  it('replays scan-time removals after the snapshot', async() => {
    const removed = path.join(tempDirectory, 'gone.md')
    await writeFile(removed, '# gone')

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', removed)
    fakeWatcher.emit('unlink', removed)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    const types = send.mock.calls.map((call) => (call[1] as { type: string }).type)
    expect(types[0]).toBe('snapshot')
    expect(types).toContain('unlink')
  })

  it('delivers a large fixture as one snapshot without reading any content', async() => {
    // Keep the fixture big enough to be meaningful (hundreds of nodes) while
    // staying well inside the per-test timeout on a slow CI disk.
    const { filePaths, folderPaths } = await buildLargeFixture(tempDirectory, 10, 25)
    expect(filePaths).toHaveLength(250)
    expect(folderPaths).toHaveLength(10)

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('addDir', tempDirectory)
    for (const dir of folderPaths) fakeWatcher.emit('addDir', dir)
    for (const filePath of filePaths) fakeWatcher.emit('add', filePath)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    const snapshotCalls = send.mock.calls.filter(
      (call) => (call[1] as { type?: string })?.type === 'snapshot'
    )
    // One IPC message for all entries, not one per node.
    expect(snapshotCalls).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)

    const entries = (snapshotCalls[0][1] as {
      change: { entries: Array<{ pathname: string; isMarkdown: boolean }> }
    }).change.entries
    expect(entries.length).toBe(1 + folderPaths.length + filePaths.length)
    expect(entries.filter((e) => e.isMarkdown)).toHaveLength(filePaths.length)

    // The whole point of the metadata path: zero Markdown body reads.
    expect(loadMarkdownFileMock).not.toHaveBeenCalled()
  }, 20000)

  it('coalesces repeated scan-time events for one path into a single replay', async() => {
    const waitForType = async(type: string): Promise<void> => {
      for (let i = 0; i < 400; i++) {
        if (send.mock.calls.some((call) => (call[1] as { type?: string })?.type === type)) return
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      throw new Error(`Timed out waiting for a ${type} send`)
    }
    const hot = path.join(tempDirectory, 'hot.md')
    await writeFile(hot, '# hot')

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', hot)
    fakeWatcher.emit('change', hot)
    fakeWatcher.emit('change', hot)
    fakeWatcher.emit('change', hot)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    await waitForType('change')
    // Three changes on one path must not produce three replays. Give any
    // duplicate replay a chance to land before counting.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const changeCalls = send.mock.calls.filter((call) => (call[1] as { type: string }).type === 'change')
    expect(changeCalls).toHaveLength(1)
  })

  it('keeps a file that was deleted then re-created during the scan', async() => {
    const churn = path.join(tempDirectory, 'churn.md')
    await writeFile(churn, '# churn')

    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('add', churn)
    fakeWatcher.emit('unlink', churn)
    // The file comes back before `ready`; the later add is the current state.
    fakeWatcher.emit('add', churn)
    await flush()
    fakeWatcher.emit('ready')
    await waitForSnapshot(send)

    const snapshotEntries = (send.mock.calls.find(
      (call) => (call[1] as { type: string }).type === 'snapshot'
    )?.[1] as { change: { entries: Array<{ pathname: string }> } }).change.entries
    expect(snapshotEntries.some((entry) => entry.pathname === churn)).toBe(true)
    // The stale removal must not be replayed on top of the re-add.
    expect(send.mock.calls.some((call) => (call[1] as { type: string }).type === 'unlink')).toBe(
      false
    )
  })
})
