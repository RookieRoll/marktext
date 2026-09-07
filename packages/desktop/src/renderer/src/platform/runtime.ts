export type RendererRuntime = NonNullable<Window['marktext']>
export type RendererInitialState = NonNullable<RendererRuntime['initialState']>

/** Return the current window's MarkText boot state, when bootstrap completed. */
export const getMarktextRuntime = (): RendererRuntime | undefined =>
  typeof window === 'undefined' ? undefined : window.marktext

export const setMarktextRuntime = (runtime: RendererRuntime): void => {
  window.marktext = runtime
}

export const getCurrentWindowId = (): number | null => {
  const windowId = getMarktextRuntime()?.env?.windowId
  return typeof windowId === 'number' ? windowId : null
}

export const getInitialState = (): RendererInitialState | undefined =>
  getMarktextRuntime()?.initialState

export const getWindowType = (): string | undefined => {
  const type = getMarktextRuntime()?.env?.type
  return typeof type === 'string' ? type : undefined
}

export const isDebugMode = (): boolean => getMarktextRuntime()?.env?.debug === true

/** Return the directory used by Muya to resolve relative local resources. */
export const getDocumentDirectory = (): string => {
  const directory = typeof window === 'undefined' ? undefined : window.DIRNAME
  return typeof directory === 'string' ? directory : ''
}

/** Keep Muya's legacy document-directory bridge behind the renderer platform boundary. */
export const setDocumentDirectory = (directory: string): void => {
  if (typeof window !== 'undefined') window.DIRNAME = directory
}
