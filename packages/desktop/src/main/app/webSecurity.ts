import type { App, Event, WebContents } from 'electron'

/**
 * Register the desktop renderer's existing web-contents security policy.
 *
 * This deliberately does not register a custom protocol or change renderer
 * loading. It centralizes the behavior that was previously registered inline
 * by the application composition root.
 */
export const registerWebContentsSecurityPolicy = (application: App): void => {
  application.on('web-contents-created', (_event: Event, contents: WebContents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
    contents.on('will-navigate', (event) => {
      event.preventDefault()
    })
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' }
    })
  })
}
