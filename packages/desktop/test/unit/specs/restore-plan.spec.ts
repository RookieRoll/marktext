import { describe, expect, it, vi } from 'vitest'
import { createRestoreCompletionTracker, planRestore } from '../../../src/main/windows/restorePlan'

const tabs = [
  { id: 'a', pathname: '/notes/a.md' },
  { id: 'b', pathname: '/notes/b.md' },
  { id: 'c', pathname: '/notes/c.md' }
]

describe('planRestore', () => {
  it('puts the persisted active tab on the critical path', () => {
    const plan = planRestore(tabs, 'b')

    expect(plan.activeTab).toEqual({ id: 'b', pathname: '/notes/b.md' })
    expect(plan.backgroundTabs.map((tab) => tab.id)).toEqual(['a', 'c'])
  })

  it('keeps tab order and excludes the active tab exactly once', () => {
    const withDuplicateId = [...tabs, { id: 'b', pathname: '/notes/b-copy.md' }]
    const plan = planRestore(withDuplicateId, 'b')

    expect(plan.activeTab?.id).toBe('b')
    // Only the first match is treated as active; the rest stay in the queue so
    // no restored tab is silently dropped.
    expect(plan.backgroundTabs).toHaveLength(3)
  })

  it('falls back to the first tab when the active id cannot be resolved', () => {
    const missing = planRestore(tabs, 'missing')
    const absent = planRestore(tabs, null)

    expect(missing.activeTab?.id).toBe('a')
    expect(missing.backgroundTabs.map((tab) => tab.id)).toEqual(['b', 'c'])
    expect(absent.activeTab?.id).toBe('a')
  })

  it('reports no active tab and no background work for an empty restore', () => {
    expect(planRestore([], 'anything')).toEqual({ activeTab: undefined, backgroundTabs: [] })
  })
})

describe('createRestoreCompletionTracker', () => {
  it('waits for the active document and every background task', () => {
    const onComplete = vi.fn()
    const tracker = createRestoreCompletionTracker(onComplete)

    tracker.activeDocumentSettled()
    expect(onComplete).not.toHaveBeenCalled()

    tracker.startBackgroundTasks(3)
    expect(onComplete).not.toHaveBeenCalled()

    tracker.backgroundTaskFinished()
    tracker.backgroundTaskFinished()
    expect(onComplete).not.toHaveBeenCalled()
    expect(tracker.pendingBackgroundTasks).toBe(1)

    tracker.backgroundTaskFinished()
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(tracker.complete).toBe(true)
  })

  it('does not report completion before the background workload is declared', () => {
    const onComplete = vi.fn()
    const tracker = createRestoreCompletionTracker(onComplete)

    tracker.startBackgroundTasks(1)
    tracker.backgroundTaskFinished()
    expect(onComplete).not.toHaveBeenCalled()

    tracker.activeDocumentSettled()
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('reports completion exactly once even with late accounting', () => {
    const onComplete = vi.fn()
    const tracker = createRestoreCompletionTracker(onComplete)

    tracker.activeDocumentSettled()
    tracker.startBackgroundTasks(0)
    tracker.backgroundTaskFinished()
    tracker.backgroundTaskFinished()
    tracker.startBackgroundTasks(0)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid background task count', () => {
    const tracker = createRestoreCompletionTracker(() => {})

    expect(() => tracker.startBackgroundTasks(-1)).toThrow(RangeError)
    expect(() => tracker.startBackgroundTasks(1.5)).toThrow(RangeError)
    expect(() => tracker.startBackgroundTasks(Number.NaN)).toThrow(RangeError)
  })
})
