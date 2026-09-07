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

/**
 * Run the application startup stages in their required order.
 *
 * The function intentionally does not catch errors: a failed stage must stop
 * startup and be reported by the composition root that owns the effects.
 */
export const runApplicationStartup = async (effects: ApplicationStartupEffects): Promise<void> => {
  for (const step of APPLICATION_STARTUP_ORDER) {
    await effects[step]()
  }
}
