/**
 * Runs restore work with bounded concurrency without depending on Electron.
 *
 * This module keeps scheduling policy separate from document loading so the
 * caller can cancel pending work when a window or tab is closed.
 */

export interface RestoreSchedulerOptions {
  concurrency: number
  signal?: AbortSignal
  yieldBetweenTasks?: () => Promise<void>
}

const assertConcurrency = (concurrency: number): void => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Restore concurrency must be a positive integer.')
  }
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0)
  })

/**
 * Executes tasks with bounded concurrency.
 *
 * Every started task is awaited before the returned promise settles, even when
 * a task rejects. Cancellation prevents new tasks from starting; callers remain
 * responsible for ignoring results from tasks that were already running.
 */
export const scheduleRestoreTasks = <T>(
  taskCount: number,
  options: RestoreSchedulerOptions,
  runTask: (index: number) => Promise<T> | T
): Promise<void> => {
  assertConcurrency(options.concurrency)

  const { concurrency, signal, yieldBetweenTasks = yieldToEventLoop } = options
  let nextTaskIndex = 0

  const runWorker = async(): Promise<void> => {
    while (!signal?.aborted) {
      const taskIndex = nextTaskIndex
      nextTaskIndex += 1

      if (taskIndex >= taskCount) return

      try {
        await runTask(taskIndex)
      } catch {
        // Restore failures belong to the caller's task-level error handling.
      }

      if (!signal?.aborted && nextTaskIndex < taskCount) {
        await yieldBetweenTasks()
      }
    }
  }

  const workerCount = Math.min(concurrency, Math.max(0, taskCount))
  return Promise.all(Array.from({ length: workerCount }, () => runWorker())).then(() => {})
}

export default scheduleRestoreTasks
