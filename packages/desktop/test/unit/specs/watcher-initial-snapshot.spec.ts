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

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

/**
 * The snapshot is emitted only after every pending metadata `stat` settles, so
 * waiting a fixed number of ticks is racy under parallel test load. Poll until
 * the batch the test expects has been delivered.
 */
const waitForSnapshot = async (send: { mock: { calls: unknown[][] } }): Promise<void> => {
  const hasSnapshot = (): boolean =>
    send.mock.calls.some((call) => (call[1] as { type?: string } | undefined)?.type === 'snapshot')
  for (let i = 0; i < 400; i++) {
    if (hasSnapshot()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for the initial project-tree snapshot')
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

  beforeEach(async () => {
    vi.useRealTimers()
    fakeWatchers.length = 0
    watchMock.mockClear()
    send.mockClear()
    loadMarkdownFileMock.mockClear()
    loadMarkdownFileMock.mockResolvedValue({ markdown: '# loaded' })
    watcher = new Watcher(preferences as never)
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'marktext-snapshot-'))
  })

  afterEach(async () => {
    watcher.close()
    await rm(tempDirectory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('does not read Markdown content while discovering the initial tree', async () => {
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

  it('delivers the discovered entries as a single snapshot', async () => {
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

  it('sends metadata only and omits file content from the snapshot', async () => {
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

  it('replays scan-time removals after the snapshot', async () => {
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
})
