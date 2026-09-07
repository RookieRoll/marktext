export type Cleanup = () => void

interface ActiveRegistration {
  cleanup: Cleanup
}

const activeRegistrations = new WeakMap<object, WeakMap<object, ActiveRegistration>>()

/**
 * Register the supplied editor IPC handlers and return an idempotent cleanup.
 *
 * The same handler map can be registered more than once with the same registrar
 * without adding duplicate listeners. Once its cleanup runs, it can be
 * registered again. Channels and handler arguments are inferred from the
 * supplied handlers; the registrar must accept each inferred handler shape.
 */
export function registerEditorIpcListeners<
  Key extends string,
  Handlers extends { [K in Key]?: (...args: any[]) => void }
>(
  register: (
    channel: Key,
    handler: (...args: any[]) => void
  ) => Cleanup,
  handlers: Handlers
): Cleanup {
  const registerKey = register as object
  const handlersKey = handlers as object
  let registrationsForRegister = activeRegistrations.get(registerKey)

  if (!registrationsForRegister) {
    registrationsForRegister = new WeakMap<object, ActiveRegistration>()
    activeRegistrations.set(registerKey, registrationsForRegister)
  }

  const existingRegistration = registrationsForRegister.get(handlersKey)
  if (existingRegistration) return existingRegistration.cleanup

  const cleanups: Cleanup[] = []
  let cleanedUp = false
  const cleanup = (): void => {
    if (cleanedUp) return

    cleanedUp = true
    registrationsForRegister?.delete(handlersKey)
    for (const unregister of cleanups.reverse()) unregister()
  }

  registrationsForRegister.set(handlersKey, { cleanup })

  try {
    for (const channel of Object.keys(handlers) as Key[]) {
      const handler = handlers[channel]
      if (typeof handler !== 'function') continue
      cleanups.push(register(channel, handler as (...args: any[]) => void))
    }
  } catch (error) {
    cleanup()
    throw error
  }

  return cleanup
}
