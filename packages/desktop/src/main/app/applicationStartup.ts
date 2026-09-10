/**
 * The application startup stages owned by the main-process composition root.
 *
 * This module deliberately contains no Electron imports. The caller supplies the
 * platform-specific effects, while this function keeps their dependency order
 * explicit and independently testable.
 */
export const APPLICATION_STARTUP_ORDER = [
  'registerProtocol',
  'registerIpc',
  'applySecurityPolicy',
  'initializePreferences',
  'registerMenus',
  'restoreStateAndWindows',
  'createFirstWindow',
  'registerLifecycleEvents'
] as const

export type ApplicationStartupStep = (typeof APPLICATION_STARTUP_ORDER)[number]
type MaybePromise<T> = T | PromiseLike<T>

/**
 * Narrow effects required to start the application.
 *
 * Each effect should adapt one existing main-process responsibility. Keeping
 * those adapters outside this module prevents the orchestration layer from
 * depending on Electron, Accessor, or any concrete service implementation.
 */
export interface ApplicationStartupEffects {
  registerProtocol: () => MaybePromise<void>
  registerIpc: () => MaybePromise<void>
  applySecurityPolicy: () => MaybePromise<void>
  initializePreferences: () => MaybePromise<void>
  registerMenus: () => MaybePromise<void>
  restoreStateAndWindows: () => MaybePromise<void>
  createFirstWindow: () => MaybePromise<void>
  registerLifecycleEvents: () => MaybePromise<void>
}

export interface StartupOpenRequest<T> {
  paths: T[]
  openFilesInSameWindow: boolean
}

/**
 * Keeps startup-originated file requests in arrival order until an editor
 * window is available. The queue is deliberately Electron-independent so the
 * startup event boundary can be exercised without native bindings.
 */
export const createStartupOpenRequestQueue = <T>() => {
  const requests: Array<StartupOpenRequest<T>> = []

  return {
    enqueue(paths: readonly T[], openFilesInSameWindow = false): void {
      if (paths.length === 0) return
      requests.push({ paths: [...paths], openFilesInSameWindow })
    },
    drain(): Array<StartupOpenRequest<T>> {
      return requests.splice(0)
    },
    get size(): number {
      return requests.length
    }
  }
}

/**
 * Run the application startup stages in their required order.
 *
 * The function intentionally does not catch errors: a failed stage must stop
 * startup and be reported by the composition root that owns the effects.
 */
export const runApplicationStartup = async (
  effects: ApplicationStartupEffects,
  signal?: AbortSignal
): Promise<void> => {
  for (const step of APPLICATION_STARTUP_ORDER) {
    if (signal?.aborted) return
    await effects[step]()
    if (signal?.aborted) return
  }
}
