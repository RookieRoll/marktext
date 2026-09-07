export type Cleanup = () => void

type HandlerMap = object

type HandlerFor<
  Handlers extends HandlerMap,
  Channel extends keyof Handlers
> = Handlers[Channel] extends (...args: infer Args) => unknown ? (...args: Args) => void : never

export type EditorIpcHandlers<Handlers extends HandlerMap> = {
  [Channel in keyof Handlers]?: HandlerFor<Handlers, Channel>
}

export type EditorIpcListenerRegistrar<Handlers extends HandlerMap> = <
  Channel extends keyof Handlers
>(
  channel: Channel,
  handler: HandlerFor<Handlers, Channel>
) => Cleanup

interface ActiveRegistration {
  cleanup: Cleanup
}

const activeRegistrations = new WeakMap<object, WeakMap<object, ActiveRegistration>>()

/**
 * Register the supplied editor IPC handlers and return an idempotent cleanup.
 *
 * The same handler map can be registered more than once with the same registrar
 * without adding duplicate listeners. Once its cleanup runs, it can be
 * registered again.
 */
export function registerEditorIpcListeners<Handlers extends HandlerMap>(
  register: EditorIpcListenerRegistrar<Handlers>,
  handlers: EditorIpcHandlers<Handlers>
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
    for (const channel of Reflect.ownKeys(handlers) as Array<keyof Handlers>) {
      const handler = handlers[channel] as unknown as HandlerFor<Handlers, typeof channel> | undefined
      if (typeof handler !== 'function') continue
      cleanups.push(register(channel, handler))
    }
  } catch (error) {
    cleanup()
    throw error
  }

  return cleanup
}
