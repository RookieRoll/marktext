import { onBeforeUnmount, onMounted } from 'vue'

export interface EditorHostOptions {
  onMount: () => void
  cleanup: () => void
}

export interface EditorHostController {
  mount: () => void
  unmount: () => void
}

interface EditorHostLifecycleHooks {
  onMounted: (hook: () => void) => void
  onBeforeUnmount: (hook: () => void) => void
}

const vueLifecycleHooks: EditorHostLifecycleHooks = {
  onMounted,
  onBeforeUnmount
}

/**
 * Register the editor host lifecycle without coupling its effects to Vue.
 *
 * The returned controller is intentionally small so the host can be tested
 * with lifecycle callbacks while the component uses Vue's lifecycle hooks.
 */
export function useEditorHost(
  options: EditorHostOptions,
  hooks: EditorHostLifecycleHooks = vueLifecycleHooks
): EditorHostController {
  let mounted = false
  let unmounted = false

  const mount = (): void => {
    if (mounted || unmounted) return

    mounted = true
    options.onMount()
  }

  const unmount = (): void => {
    if (unmounted) return

    unmounted = true
    options.cleanup()
  }

  hooks.onMounted(mount)
  hooks.onBeforeUnmount(unmount)

  return { mount, unmount }
}
