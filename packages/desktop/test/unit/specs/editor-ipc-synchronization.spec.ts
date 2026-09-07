import { describe, expect, it, vi } from 'vitest'
import {
  registerEditorIpcListeners,
  type Cleanup,
  type EditorIpcHandlers,
  type EditorIpcListenerRegistrar
} from '@/store/editor/ipcSynchronization'

type TestHandlers = {
  'state-replaced': (state: string) => void
  'window-zoomed': (zoomFactor: number) => void
}

type RegisteredListener = {
  channel: keyof TestHandlers
  handler: TestHandlers[keyof TestHandlers]
  cleanup: ReturnType<typeof vi.fn>
}

const createRegistrar = (): {
  register: EditorIpcListenerRegistrar<TestHandlers>
  registrations: RegisteredListener[]
} => {
  const registrations: RegisteredListener[] = []
  const register: EditorIpcListenerRegistrar<TestHandlers> = (channel, handler) => {
    const cleanup = vi.fn()
    registrations.push({ channel, handler, cleanup })
    return cleanup
  }

  return { register, registrations }
}

describe('registerEditorIpcListeners', () => {
  it('registers each supplied handler and forwards events without platform dependencies', () => {
    const { register, registrations } = createRegistrar()
    const stateHandler = vi.fn()
    const zoomHandler = vi.fn()
    const handlers: EditorIpcHandlers<TestHandlers> = {
      'state-replaced': stateHandler,
      'window-zoomed': zoomHandler
    }

    const cleanup = registerEditorIpcListeners(register, handlers)

    expect(registrations.map(({ channel }) => channel)).toEqual(['state-replaced', 'window-zoomed'])

    const stateListener = registrations[0]?.handler as TestHandlers['state-replaced']
    const zoomListener = registrations[1]?.handler as TestHandlers['window-zoomed']
    stateListener('restored')
    zoomListener(1.25)

    expect(stateHandler).toHaveBeenCalledWith('restored')
    expect(zoomHandler).toHaveBeenCalledWith(1.25)

    cleanup()
  })

  it('does not duplicate an active registration and makes cleanup idempotent', () => {
    const { register, registrations } = createRegistrar()
    const handlers: EditorIpcHandlers<TestHandlers> = {
      'state-replaced': vi.fn(),
      'window-zoomed': vi.fn()
    }

    const cleanup = registerEditorIpcListeners(register, handlers)
    const duplicateCleanup = registerEditorIpcListeners(register, handlers)

    expect(duplicateCleanup).toBe(cleanup)
    expect(registrations).toHaveLength(2)

    cleanup()
    cleanup()

    expect(registrations[0]?.cleanup).toHaveBeenCalledOnce()
    expect(registrations[1]?.cleanup).toHaveBeenCalledOnce()
  })

  it('can register again after cleanup and skips missing handlers', () => {
    const { register, registrations } = createRegistrar()
    const handlers: EditorIpcHandlers<TestHandlers> = {
      'state-replaced': vi.fn(),
      'window-zoomed': undefined
    }

    const cleanup = registerEditorIpcListeners(register, handlers)
    cleanup()
    registerEditorIpcListeners(register, handlers)

    expect(registrations.map(({ channel }) => channel)).toEqual([
      'state-replaced',
      'state-replaced'
    ])
  })

  it('returns a cleanup even when no handlers are supplied', () => {
    const { register, registrations } = createRegistrar()
    const cleanup: Cleanup = registerEditorIpcListeners(register, {})

    expect(registrations).toHaveLength(0)
    expect(() => cleanup()).not.toThrow()
  })
})
