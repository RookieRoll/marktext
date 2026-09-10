/**
 * Creates a retryable, concurrency-safe lazy service loader.
 *
 * The first caller starts one loader Promise. Concurrent callers share it;
 * after a rejection the cached Promise is cleared so a later request can
 * retry instead of receiving a permanently rejected Promise.
 */
export const createEnsureService = <T>(loader: () => Promise<T>): (() => Promise<T>) => {
  let pending: Promise<T> | null = null

  return (): Promise<T> => {
    if (pending) return pending

    pending = Promise.resolve()
      .then(loader)
      .catch((error: unknown) => {
        pending = null
        throw error
      })

    return pending
  }
}
