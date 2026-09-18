import { describe, expect, it, vi } from 'vitest'
import { ContentCommitScheduler, type FrameScheduler } from '@/store/editor/contentCommit'

// Manual scheduler so coalescing/flush/drop rules are deterministic.
const createManualFrameScheduler = () => {
  let queued: (() => void) | null = null
  let nextHandle = 1
  const cancelled: number[] = []
  const scheduler: FrameScheduler = {
    schedule: (run) => {
      queued = run
      return nextHandle++
    },
    cancel: (handle) => {
      cancelled.push(handle)
      queued = null
    }
  }
  return {
    scheduler,
    cancelled,
    get hasQueued() {
      return queued !== null
    },
    runFrame(): void {
      const run = queued
      queued = null
      run?.()
    }
  }
}

const createScheduler = () => {
  const manual = createManualFrameScheduler()
  const commit = vi.fn()
  const commits = new ContentCommitScheduler(manual.scheduler, commit)
  return { manual, commit, commits }
}

describe('deferred content commit', () => {
  it('does not commit inside the json-change handler', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('tab-a', { markdown: '# A', cursor: { anchor: 1 } })

    // This is the whole point: the ~5ms serialize+hash pass is not on the
    // keystroke path any more.
    expect(commit).not.toHaveBeenCalled()
    expect(commits.has('tab-a')).toBe(true)
    expect(manual.hasQueued).toBe(true)
  })

  it('commits once per frame and keeps only the newest snapshot', () => {
    const { commit, commits, manual } = createScheduler()

    // Several batched ops inside one frame.
    commits.defer('tab-a', { markdown: 'a', cursor: null })
    commits.defer('tab-a', { markdown: 'ab', cursor: null })
    commits.defer('tab-a', { markdown: 'abc', cursor: null })
    manual.runFrame()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('tab-a', { markdown: 'abc', cursor: null })
  })

  it('coalesces per tab, not globally', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: null })
    commits.defer('tab-b', { markdown: 'B', cursor: null })
    manual.runFrame()

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commit).toHaveBeenCalledWith('tab-a', { markdown: 'A', cursor: null })
    expect(commit).toHaveBeenCalledWith('tab-b', { markdown: 'B', cursor: null })
  })

  it('flushes synchronously when a flush is requested mid-frame', () => {
    const { commit, commits } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: null })
    // What `handleFileChange` does before replacing the outgoing document.
    expect(commits.flush('tab-a')).toBe(true)

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('tab-a', { markdown: 'A', cursor: null })
    expect(commits.has('tab-a')).toBe(false)
  })

  it('flushes every pending tab when no id is given', () => {
    const { commit, commits } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: null })
    commits.defer('tab-b', { markdown: 'B', cursor: null })
    expect(commits.flush()).toBe(true)

    expect(commit).toHaveBeenCalledTimes(2)
    expect(commits.size).toBe(0)
  })

  it('does not commit a queued frame twice after a flush', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: null })
    commits.flush('tab-a')
    manual.runFrame()

    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('reports a no-op flush so callers can distinguish it', () => {
    const { commit, commits } = createScheduler()

    expect(commits.flush('tab-a')).toBe(false)
    expect(commits.flush()).toBe(false)
    expect(commit).not.toHaveBeenCalled()
  })

  it('drops a queued snapshot instead of writing stale content after a reload', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('tab-a', { markdown: 'pre-reload', cursor: null })
    // `setMarkdownToEditor` replaces the document; the queued snapshot describes
    // the PREVIOUS content and must never be committed.
    commits.drop('tab-a')
    manual.runFrame()

    expect(commit).not.toHaveBeenCalled()
    expect(commits.has('tab-a')).toBe(false)
    expect(manual.cancelled.length).toBeGreaterThan(0)
  })

  it('drops only the closed tab when pruning', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('live', { markdown: 'live', cursor: null })
    commits.defer('closed', { markdown: 'closed', cursor: null })
    commits.retain(new Set(['live']))
    manual.runFrame()

    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('live', { markdown: 'live', cursor: null })
  })

  it('discards everything on teardown', () => {
    const { commit, commits, manual } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: null })
    commits.clear()
    manual.runFrame()

    expect(commit).not.toHaveBeenCalled()
    expect(commits.size).toBe(0)
  })

  it('exposes the pending snapshot for assertions and diagnostics', () => {
    const { commits } = createScheduler()

    commits.defer('tab-a', { markdown: 'A', cursor: { anchor: 3 } })

    expect(commits.pendingFor('tab-a')).toEqual({ markdown: 'A', cursor: { anchor: 3 } })
  })
})
