import { describe, expect, it, vi } from 'vitest'
import { registerWebContentsSecurityPolicy } from '../../../src/main/app/webSecurity'

type WebContentsEvent = { preventDefault: () => void }
type WebContentsListener = (event: WebContentsEvent) => void
type WebContentsCreatedListener = (_event: unknown, contents: FakeWebContents) => void

interface FakeWebContents {
  on: (event: 'will-attach-webview' | 'will-navigate', listener: WebContentsListener) => void
  setWindowOpenHandler: (handler: () => { action: 'deny' }) => void
}

interface FakeApplication {
  on: (event: 'web-contents-created', listener: WebContentsCreatedListener) => void
}

describe('web contents security policy', () => {
  it('keeps webviews, navigation, and window opens denied', () => {
    let webContentsCreatedListener: WebContentsCreatedListener | undefined
    const application: FakeApplication = {
      on: vi.fn((_event, listener) => {
        webContentsCreatedListener = listener
      })
    }
    const listeners = new Map<'will-attach-webview' | 'will-navigate', WebContentsListener>()
    let windowOpenHandler: (() => { action: 'deny' }) | undefined
    const contents: FakeWebContents = {
      on: vi.fn((event, listener) => {
        listeners.set(event, listener)
      }),
      setWindowOpenHandler: vi.fn((handler) => {
        windowOpenHandler = handler
      })
    }

    registerWebContentsSecurityPolicy(application as never)
    webContentsCreatedListener?.({}, contents)

    expect(application.on).toHaveBeenCalledWith('web-contents-created', expect.any(Function))
    expect(contents.on).toHaveBeenCalledTimes(2)
    expect(contents.setWindowOpenHandler).toHaveBeenCalledTimes(1)

    const preventDefault = vi.fn()
    listeners.get('will-attach-webview')?.({ preventDefault })
    listeners.get('will-navigate')?.({ preventDefault })

    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(windowOpenHandler?.()).toEqual({ action: 'deny' })
  })
})
