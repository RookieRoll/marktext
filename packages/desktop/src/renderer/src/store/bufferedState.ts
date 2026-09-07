import debounce from 'lodash/debounce'
import type {
  BufferedEditorState,
  BufferedLayoutState,
  BufferedProjectState,
  BufferedState
} from '@shared/types/bufferedState'
import { getIpcRenderer } from '@/platform/electron'
const BUFFERED_STATE_DEBOUNCE_MS = 1000
const BUFFERED_STATE_VERSION = 1

/**
 * Minimal store surface required by the buffered-state coordinator.
 *
 * Keeping this interface here prevents the coordinator from importing Pinia
 * stores. The stores still request persistence, but the renderer composition
 * root owns wiring the three state providers together.
 */
export interface BufferedStateStore<T extends object> {
  CREATE_BUFFERED_STATE: () => T | null
}

export interface BufferedStateStores {
  editorStore: BufferedStateStore<BufferedEditorState>
  projectStore: BufferedStateStore<BufferedProjectState>
  layoutStore: BufferedStateStore<BufferedLayoutState>
}

let registeredStores: BufferedStateStores | null = null

/**
 * Register the renderer stores once the Pinia application has been composed.
 *
 * This is intentionally an explicit dependency-injection seam rather than a
 * lazy import of the stores: editor, project, and layout all request buffered
 * persistence, so importing them here would create a runtime module cycle.
 */
export const registerBufferedStateStores = (stores: BufferedStateStores | null): void => {
  registeredStores = stores
}

export const createBufferedState = (): BufferedState | null => {
  if (!registeredStores) return null

  const editorState = registeredStores.editorStore.CREATE_BUFFERED_STATE()
  if (!editorState) return null

  return {
    version: BUFFERED_STATE_VERSION,
    ...editorState,
    project: registeredStores.projectStore.CREATE_BUFFERED_STATE(),
    layout: registeredStores.layoutStore.CREATE_BUFFERED_STATE()
  }
}

export const sendBufferedState = (): Promise<boolean> => {
  const snapshot = createBufferedState()
  if (snapshot) {
    return getIpcRenderer().invoke('update-buffer-state', snapshot)
  }

  return Promise.resolve(false)
}

export const debouncedSendBufferedState = debounce(() => {
  sendBufferedState().catch((err) => {
    console.error('Failed to update buffered state', err)
  })
}, BUFFERED_STATE_DEBOUNCE_MS)
