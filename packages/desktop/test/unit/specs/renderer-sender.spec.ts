import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import {
  createRendererSenderGuard,
  isMainFrameSender,
  type RendererIpcEvent
} from '../../../src/main/ipc/rendererSender'

type TestRenderer = {
  mainFrame: WebFrameMain
}

const createFixture = () => {
  const mainFrame = {} as WebFrameMain
  const childFrame = {} as WebFrameMain
  const sender = { mainFrame } as TestRenderer as WebContents
  const window = { id: 42 } as BrowserWindow
  const resolveWindow = vi.fn((candidate: WebContents) => (candidate === sender ? window : null))
  const guard = createRendererSenderGuard(resolveWindow)

  const mainFrameEvent: RendererIpcEvent = { sender, senderFrame: mainFrame }
  const childFrameEvent: RendererIpcEvent = { sender, senderFrame: childFrame }
  const missingFrameEvent: RendererIpcEvent = { sender, senderFrame: null }

  return {
    childFrame,
    guard,
    mainFrame,
    mainFrameEvent,
    missingFrameEvent,
    resolveWindow,
    sender,
    childFrameEvent,
    window
  }
}

describe('renderer sender guard', () => {
  it('accepts a known BrowserWindow and its main frame', () => {
    const { guard, mainFrameEvent, resolveWindow, window } = createFixture()

    expect(guard.getWindow(mainFrameEvent)).toBe(window)
    expect(resolveWindow).toHaveBeenCalledWith(mainFrameEvent.sender)
  })

  it('rejects an unknown WebContents without throwing in the nullable API', () => {
    const { guard, mainFrameEvent, sender } = createFixture()
    const unknownSender = { mainFrame: mainFrameEvent.sender.mainFrame } as WebContents
    const unknownEvent: RendererIpcEvent = {
      sender: unknownSender,
      senderFrame: sender.mainFrame
    }

    expect(guard.getWindow(unknownEvent)).toBeNull()
  })

  it('rejects child frames by default', () => {
    const { childFrameEvent, guard } = createFixture()

    expect(isMainFrameSender(childFrameEvent)).toBe(false)
    expect(guard.getWindow(childFrameEvent)).toBeNull()
  })

  it('rejects a missing sender frame because the frame may be destroyed or navigated', () => {
    const { guard, missingFrameEvent } = createFixture()

    expect(isMainFrameSender(missingFrameEvent)).toBe(false)
    expect(guard.getWindow(missingFrameEvent)).toBeNull()
  })

  it('can preserve a legacy window-only transition explicitly', () => {
    const { childFrameEvent, guard, window } = createFixture()

    expect(guard.getWindow(childFrameEvent, { requireMainFrame: false })).toBe(window)
  })

  it('can restrict a handler to one exact BrowserWindow', () => {
    const { guard, mainFrameEvent, window } = createFixture()
    const otherWindow = { id: 7 } as BrowserWindow

    expect(guard.getWindow(mainFrameEvent, { expectedWindow: window })).toBe(window)
    expect(guard.getWindow(mainFrameEvent, { expectedWindow: otherWindow })).toBeNull()
  })

  it('applies an explicit frame trust policy when one is supplied', () => {
    const { guard, mainFrameEvent, mainFrame } = createFixture()
    const isTrustedFrame = vi.fn((frame: WebFrameMain) => frame === mainFrame)

    expect(guard.getWindow(mainFrameEvent, { isTrustedFrame })).not.toBeNull()
    expect(isTrustedFrame).toHaveBeenCalledWith(mainFrame)

    expect(
      guard.getWindow(mainFrameEvent, {
        isTrustedFrame: () => false
      })
    ).toBeNull()
  })

  it('provides a strict API for handlers that must fail closed', () => {
    const { childFrameEvent, guard, mainFrameEvent, window } = createFixture()

    expect(guard.assertTrustedRenderer(mainFrameEvent)).toBe(window)
    expect(() => guard.assertTrustedRenderer(childFrameEvent)).toThrow('Rejected IPC sender')
  })
})
