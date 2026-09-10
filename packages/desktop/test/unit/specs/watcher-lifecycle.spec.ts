import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

function createFakeWatcher(): FakeWatcher {
  const handlers = new Map<string, EventHandler>()
  const fakeWatcher = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler)
      return fakeWatcher
    }),
    close: vi.fn(() => Promise.resolve()),
    unwatch: vi.fn(() => fakeWatcher),
    add: vi.fn(() => fakeWatcher),
    emit: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args)
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

vi.mock('ced', () => ({ default: () => 'UTF-8' }))
vi.mock('main_renderer/config', () => ({ isLinux: true, isOsx: false }))

import Watcher from 'main_renderer/filesystem/watcher'

describe('watcher lifecycle', () => {
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
    win.isDestroyed.mockReturnValue(false)
    watcher = new Watcher(preferences as never)
    tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'marktext-watcher-'))
  })

  afterEach(async () => {
    watcher.close()
    await rm(tempDirectory, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('ignores an add event when the file is deleted before stat completes', async () => {
    const pathname = path.join(tempDirectory, 'created.md')
    await writeFile(pathname, '# created')
    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    await rm(pathname)
    fakeWatcher.emit('add', pathname)
    await new Promise((resolve) => setImmediate(resolve))

    expect(send).not.toHaveBeenCalled()
  })

  it('clears a pending Linux rename repair when the window watcher closes', () => {
    vi.useFakeTimers()
    watcher.watch(win as never, '/project/note.md', 'file')
    const fakeWatcher = fakeWatchers[0]

    fakeWatcher.emit('raw', 'rename', '/project/note.md', {})
    watcher.unwatchByWindowId(win.id)
    vi.advanceTimersByTime(150)

    expect(fakeWatcher.close).toHaveBeenCalledTimes(1)
    expect(fakeWatcher.unwatch).not.toHaveBeenCalled()
    expect(fakeWatcher.add).not.toHaveBeenCalled()
  })

  it('does not send watcher events after close or window destruction', () => {
    watcher.watch(win as never, tempDirectory, 'dir')
    const fakeWatcher = fakeWatchers[0]

    watcher.close()
    fakeWatcher.emit('unlink', path.join(tempDirectory, 'note.md'))
    expect(send).not.toHaveBeenCalled()

    win.isDestroyed.mockReturnValue(true)
    const secondWatcher = new Watcher(preferences as never)
    secondWatcher.watch(win as never, tempDirectory, 'dir')
    fakeWatchers[1].emit('unlink', path.join(tempDirectory, 'note.md'))
    expect(send).not.toHaveBeenCalled()
    secondWatcher.close()
  })
})
