import type { BootInfo } from '@shared/types/ipc'

/**
 * Renderer capability accessors for the typed preload bridge.
 *
 * Keeping these lookups here prevents feature modules and stores from reaching
 * into the global window.electron object directly. It also gives unit tests a
 * single seam to stub when a feature needs Electron capabilities.
 */
export const hasElectronBridge = (): boolean =>
  typeof window !== 'undefined' && !!window.electron?.ipcRenderer

export const getElectronBridge = (): Window['electron'] => window.electron

export const getIpcRenderer = (): Window['electron']['ipcRenderer'] =>
  getElectronBridge().ipcRenderer

export const getClipboardBridge = (): Window['electron']['clipboard'] =>
  getElectronBridge().clipboard

export const getShellBridge = (): Window['electron']['shell'] => getElectronBridge().shell

export const getWebFrameBridge = (): Window['electron']['webFrame'] => getElectronBridge().webFrame

export const getWebUtilsBridge = (): Window['electron']['webUtils'] => getElectronBridge().webUtils

export const getCommandExistsBridge = (): Window['commandExists'] | undefined =>
  typeof window === 'undefined' ? undefined : window.commandExists

export const getI18nUtilsBridge = (): Window['i18nUtils'] => window.i18nUtils

export const getFontsBridge = (): Window['fonts'] => window.fonts

/** Return the renderer-side process metadata exposed by preload. */
export const getProcessBridge = (): Window['electron']['process'] => {
  const processInfo = typeof window !== 'undefined' ? window.electron?.process : undefined
  return (
    processInfo ?? {
      platform: '' as NodeJS.Platform,
      versions: {},
      env: {}
    }
  )
}

export const getProcessPlatform = (): NodeJS.Platform | '' => getProcessBridge().platform

/** Return the window-control capability exposed by preload. */
export const getWindowControlBridge = (): Window['electron']['windowControl'] =>
  getElectronBridge().windowControl

/** Return boot-time paths exposed by preload. */
export const getElectronPaths = (): Partial<BootInfo['paths']> =>
  (typeof window !== 'undefined' ? window.electron?.paths : undefined) ?? {}
