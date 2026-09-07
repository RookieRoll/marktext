import type { BrowserWindow, WebContents, WebFrameMain } from 'electron'

/**
 * The part of an Electron IPC event needed to validate a renderer sender.
 * Both IpcMainEvent and IpcMainInvokeEvent satisfy this shape.
 */
export interface RendererIpcEvent {
  readonly sender: WebContents
  readonly senderFrame: WebFrameMain | null
}

export type RendererWindowResolver = (sender: WebContents) => BrowserWindow | null

export interface RendererSenderPolicy {
  /** Reject messages sent by child frames. Enabled by default. */
  readonly requireMainFrame?: boolean
  /** Restrict a handler to one already-identified BrowserWindow. */
  readonly expectedWindow?: BrowserWindow
  /** Apply an explicit application URL/origin policy to the sending frame. */
  readonly isTrustedFrame?: (frame: WebFrameMain) => boolean
}

export interface RendererSenderGuard {
  /**
   * Resolve a validated sender to its BrowserWindow, or return null when the
   * sender is not accepted by the policy.
   */
  getWindow(event: RendererIpcEvent, policy?: RendererSenderPolicy): BrowserWindow | null
  /**
   * Strict form for handlers where rejecting an invalid sender is preferable to
   * silently returning. The caller owns the error boundary/logging policy.
   */
  assertTrustedRenderer(event: RendererIpcEvent, policy?: RendererSenderPolicy): BrowserWindow
}

/**
 * Check that an IPC message originated from the top-level frame of its
 * WebContents. A null senderFrame is treated as invalid because Electron may
 * expose it after navigation or frame destruction.
 */
export const isMainFrameSender = (event: RendererIpcEvent): boolean =>
  event.senderFrame !== null && event.senderFrame === event.sender.mainFrame

/**
 * Create a sender guard with the application's BrowserWindow lookup injected.
 *
 * Dependency injection keeps this module free of Electron runtime side effects
 * and lets each caller use the same validation policy with its existing
 * BrowserWindow.fromWebContents lookup. This slice intentionally does not
 * change any existing handler; migration can happen handler-by-handler.
 */
export const createRendererSenderGuard = (
  resolveWindow: RendererWindowResolver
): RendererSenderGuard => {
  const getWindow = (
    event: RendererIpcEvent,
    policy: RendererSenderPolicy = {}
  ): BrowserWindow | null => {
    const window = resolveWindow(event.sender)
    if (!window) return null

    if (policy.expectedWindow && window !== policy.expectedWindow) return null

    if (policy.requireMainFrame !== false && !isMainFrameSender(event)) return null

    const frame = event.senderFrame
    if (policy.isTrustedFrame && (!frame || !policy.isTrustedFrame(frame))) return null

    return window
  }

  const assertTrustedRenderer = (
    event: RendererIpcEvent,
    policy?: RendererSenderPolicy
  ): BrowserWindow => {
    const window = getWindow(event, policy)
    if (!window) {
      throw new Error('Rejected IPC sender: expected a trusted MarkText renderer')
    }
    return window
  }

  return { getWindow, assertTrustedRenderer }
}
