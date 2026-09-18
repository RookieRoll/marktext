import { describe, expect, it, vi } from 'vitest'
import {
  createIdleHistoryScheduler,
  DeferredHistoryRestore,
  type HistoryRestoreScheduler
} from '@/store/editor/deferredHistory'

// A scheduler whose callbacks fire only when the test says so, so the
// defer/flush/cancel rules are asserted deterministically instead of racing an
// idle callback.
const createManualScheduler = () => {
  let queued: (() => void) | null = null
  const scheduler: HistoryRestoreScheduler = {
    schedule: (run) => {
      queued = run
    },
    cancel: () => {
      queued = null
    }
  }
  return {
    scheduler,
    get hasQueued() {
      return queued !== null
    },
    runQueued(): void {
      const run = queued
      queued = null
      run?.()
    }
  }
}

const makeRestore = (activeTabId: string | null = 'tab-a') => {
  const manual = createManualScheduler()
  const apply = vi.fn()
  let active = activeTabId
  const restore = new DeferredHistoryRestore(manual.scheduler, () => active, apply)
  return {
    manual,
    apply,
    restore,
    setActiveTab: (id: string | null) => {
      active = id
    }
  }
}

describe('idle history scheduler', () => {
  it('falls back to a macrotask when requestIdleCallback is unavailable', async () => {
    const run = vi.fn()
    const scheduler = createIdleHistoryScheduler()

    scheduler.schedule(run)
    expect(run).not.toHaveBeenCalled()

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending fallback before it fires', async () => {
    const run = vi.fn()
    const scheduler = createIdleHistoryScheduler()

    scheduler.schedule(run)
    scheduler.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(run).not.toHaveBeenCalled()
  })
})

describe('deferred history restore', () => {
  it('does not apply the persisted stack inside the tab switch', () => {
    const { apply, restore, manual } = makeRestore()

    restore.defer('tab-a', { undo: [], redo: [] })

    // The handler returned without touching the engine — that is the whole point
    // of moving the deep clone off the first-frame path.
    expect(apply).not.toHaveBeenCalled()
    expect(restore.hasPending).toBe(true)
    expect(restore.pendingTabId).toBe('tab-a')
    expect(manual.hasQueued).toBe(true)
  })

  it('applies the stack once the renderer goes idle', () => {
    const { apply, restore, manual } = makeRestore()
    const history = { undo: [{ id: 1 }], redo: [] }

    restore.defer('tab-a', history)
    manual.runQueued()

    expect(apply).toHaveBeenCalledWith('tab-a', history)
    expect(restore.hasPending).toBe(false)
  })

  it('flushes the pending restore before undo can read the stack', () => {
    const { apply, restore } = makeRestore()
    const history = { undo: [{ id: 1 }], redo: [] }

    restore.defer('tab-a', history)
    // What `handleUndo`/`handleRedo` do before touching the engine.
    const flushed = restore.flush()

    expect(flushed).toBe(true)
    expect(apply).toHaveBeenCalledWith('tab-a', history)
  })

  it('flushes before leaving a tab so the captured stack includes the restore', () => {
    const { apply, restore } = makeRestore()
    const history = { undo: [{ id: 'persisted' }], redo: [] }

    restore.defer('tab-a', history)
    restore.flush()

    expect(apply).toHaveBeenCalledTimes(1)
    // Nothing is left queued for the outgoing tab, so the captured stack cannot
    // be missing the persisted entries.
    expect(restore.hasPending).toBe(false)
  })

  it('applies immediately when the tab was already left', () => {
    const { apply, restore, manual, setActiveTab } = makeRestore()
    const history = { undo: [{ id: 1 }], redo: [] }

    // Tab A is left before the switch handler queues its restore: there is no
    // first-frame cost left to protect, so it is applied straight away.
    setActiveTab('tab-b')
    restore.defer('tab-a', history)
    manual.runQueued()

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith('tab-a', history)
  })

  it('drops the queued restore when the active tab changed before it fired', () => {
    const { apply, restore, manual, setActiveTab } = makeRestore()

    restore.defer('tab-a', { undo: [], redo: [] })
    // The idle callback fires after the user moved on to another document. The
    // entry stays in `engineHistoryByTab`, so the next activation re-defers it.
    setActiveTab('tab-b')
    manual.runQueued()

    expect(apply).not.toHaveBeenCalled()
    expect(restore.hasPending).toBe(false)
  })

  it('replaces a pending restore for a different tab instead of stacking work', () => {
    const { apply, restore, manual, setActiveTab } = makeRestore()
    const first = { undo: [{ id: 'a' }], redo: [] }
    const second = { undo: [{ id: 'b' }], redo: [] }

    // A -> B -> C in quick succession: each switch supersedes the previous
    // queue, so at most one clone is ever pending.
    restore.defer('tab-a', first)
    setActiveTab('tab-b')
    restore.defer('tab-b', second)
    setActiveTab('tab-c')
    manual.runQueued()

    // B's restore was dropped when the renderer moved on; A was superseded
    // before it ever ran. Both tabs re-defer on their next activation.
    expect(apply).not.toHaveBeenCalled()
    expect(restore.hasPending).toBe(false)
  })

  it('drops a queued restore on teardown without applying it', () => {
    const { apply, restore, manual } = makeRestore()

    restore.defer('tab-a', { undo: [], redo: [] })
    restore.cancel()
    manual.runQueued()

    expect(apply).not.toHaveBeenCalled()
    expect(restore.hasPending).toBe(false)
  })

  it('only cancels the restore belonging to the requested tab', () => {
    const { restore } = makeRestore()

    restore.defer('tab-a', { undo: [], redo: [] })
    restore.cancel('tab-b')
    expect(restore.hasPending).toBe(true)

    restore.cancel('tab-a')
    expect(restore.hasPending).toBe(false)
  })

  it('reports nothing to flush when no restore is queued', () => {
    const { restore } = makeRestore()

    expect(restore.flush()).toBe(false)
  })
})
