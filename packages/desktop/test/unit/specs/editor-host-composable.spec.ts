import { describe, expect, it, vi } from 'vitest'
import { useEditorHost } from '@/components/editorWithTabs/composables/useEditorHost'

type LifecycleCallbacks = {
  mounted: Array<() => void>
  beforeUnmount: Array<() => void>
}

const createLifecycleHooks = (): {
  callbacks: LifecycleCallbacks
  hooks: {
    onMounted: (hook: () => void) => void
    onBeforeUnmount: (hook: () => void) => void
  }
} => {
  const callbacks: LifecycleCallbacks = {
    mounted: [],
    beforeUnmount: []
  }

  return {
    callbacks,
    hooks: {
      onMounted: (hook) => callbacks.mounted.push(hook),
      onBeforeUnmount: (hook) => callbacks.beforeUnmount.push(hook)
    }
  }
}

describe('useEditorHost', () => {
  it('registers mount and unmount effects with the host lifecycle', () => {
    const { callbacks, hooks } = createLifecycleHooks()
    const mount = vi.fn()
    const cleanup = vi.fn()

    useEditorHost({ onMount: mount, cleanup }, hooks)

    expect(callbacks.mounted).toHaveLength(1)
    expect(callbacks.beforeUnmount).toHaveLength(1)

    callbacks.mounted[0]?.()
    callbacks.beforeUnmount[0]?.()

    expect(mount).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('protects mount and cleanup from repeated lifecycle calls', () => {
    const { callbacks, hooks } = createLifecycleHooks()
    const mount = vi.fn()
    const cleanup = vi.fn()
    const host = useEditorHost({ onMount: mount, cleanup }, hooks)

    callbacks.mounted[0]?.()
    callbacks.mounted[0]?.()
    host.mount()
    callbacks.beforeUnmount[0]?.()
    callbacks.beforeUnmount[0]?.()
    host.unmount()

    expect(mount).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('does not mount after the host has been unmounted', () => {
    const { hooks } = createLifecycleHooks()
    const mount = vi.fn()
    const cleanup = vi.fn()
    const host = useEditorHost({ onMount: mount, cleanup }, hooks)

    host.unmount()
    host.mount()

    expect(mount).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
