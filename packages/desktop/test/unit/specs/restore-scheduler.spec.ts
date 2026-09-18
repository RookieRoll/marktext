import { describe, expect, it, vi } from 'vitest'
import { scheduleRestoreTasks } from '../../../src/main/windows/restoreScheduler'

const deferred = <T = void>() => {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

describe('scheduleRestoreTasks', () => {
  it('limits the number of concurrently running tasks', async() => {
    const first = deferred()
    const second = deferred()
    const runTask = vi.fn(async(index: number) => {
      await (index === 0 ? first.promise : second.promise)
    })

    const scheduling = scheduleRestoreTasks(
      4,
      { concurrency: 2, yieldBetweenTasks: async() => {} },
      runTask
    )

    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(2))
    expect(runTask.mock.calls.map(([index]) => index)).toEqual([0, 1])

    first.resolve()
    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(3))
    expect(runTask.mock.calls.map(([index]) => index)).toEqual([0, 1, 2])

    second.resolve()
    await scheduling
    expect(runTask).toHaveBeenCalledTimes(4)
  })

  it('resolves after every task completes', async() => {
    const completed: number[] = []
    let settled = false

    const scheduling = scheduleRestoreTasks(
      3,
      { concurrency: 2, yieldBetweenTasks: async() => {} },
      async(index) => {
        await Promise.resolve()
        completed.push(index)
      }
    ).then(() => {
      settled = true
    })

    expect(settled).toBe(false)
    await scheduling
    expect(settled).toBe(true)
    expect(completed.sort()).toEqual([0, 1, 2])
  })

  it('does not start new tasks after cancellation', async() => {
    const controller = new AbortController()
    const first = deferred()
    const runTask = vi.fn(async(index: number) => {
      if (index === 0) await first.promise
    })

    const scheduling = scheduleRestoreTasks(
      3,
      { concurrency: 1, signal: controller.signal },
      runTask
    )

    await vi.waitFor(() => expect(runTask).toHaveBeenCalledTimes(1))
    controller.abort()
    first.resolve()
    await scheduling

    expect(runTask).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid concurrency values with RangeError', () => {
    expect(() => scheduleRestoreTasks(1, { concurrency: 0 }, () => {})).toThrow(RangeError)
    expect(() => scheduleRestoreTasks(1, { concurrency: Number.NaN }, () => {})).toThrow(
      RangeError
    )
    expect(() => scheduleRestoreTasks(1, { concurrency: 1.5 }, () => {})).toThrow(RangeError)
  })
})
