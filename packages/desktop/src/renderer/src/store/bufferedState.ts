import debounce from 'lodash/debounce'
import type {
  BufferedEditorState,
  BufferedLayoutState,
  BufferedProjectState,
  BufferedState
} from '@shared/types/bufferedState'
import { BUFFERED_STATE_VERSION, isBufferedState } from '@shared/types/bufferedState'
import { getIpcRenderer } from '@/platform/electron'

const BUFFERED_STATE_DEBOUNCE_MS = 1000

/**
 * Minimal persistence provider surface required by the buffered-state coordinator.
 *
 * The coordinator owns no Pinia dependency. The composition root supplies plain
 * snapshot functions, which keeps persistence reusable in tests and prevents a
 * store import cycle.
 */
export type BufferedStateProvider<T extends object> = () => T | null

export interface BufferedStateProviders {
  editor: BufferedStateProvider<BufferedEditorState>
  project: BufferedStateProvider<BufferedProjectState>
  layout: BufferedStateProvider<BufferedLayoutState>
}

/**
 * Compatibility surface for callers that still expose Pinia-like stores.
 *
 * The coordinator itself only consumes BufferedStateProviders. These exports
 * keep existing tests and transitional callers source-compatible while the
 * composition root moves to plain provider functions.
 */
export interface BufferedStateStore<T extends object> {
  CREATE_BUFFERED_STATE: () => T | null
}

export interface BufferedStateStores {
  editorStore: BufferedStateStore<BufferedEditorState>
  projectStore: BufferedStateStore<BufferedProjectState>
  layoutStore: BufferedStateStore<BufferedLayoutState>
}

let registeredProviders: BufferedStateProviders | null = null

/** Register the renderer-owned persistence providers after composition. */
export const registerBufferedStateProviders = (providers: BufferedStateProviders | null): void => {
  registeredProviders = providers
}

/**
 * Keep the previous store-shaped registration API as a compatibility adapter.
 * New composition roots should use registerBufferedStateProviders instead.
 */
export const registerBufferedStateStores = (stores: BufferedStateStores | null): void => {
  if (!stores) {
    registerBufferedStateProviders(null)
    return
  }

  registerBufferedStateProviders({
    editor: () => stores.editorStore.CREATE_BUFFERED_STATE(),
    project: () => stores.projectStore.CREATE_BUFFERED_STATE(),
    layout: () => stores.layoutStore.CREATE_BUFFERED_STATE()
  })
}

export const createBufferedState = (): BufferedState | null => {
  if (!registeredProviders) return null

  try {
    const editorState = registeredProviders.editor()
    if (!editorState) return null

    const snapshot: BufferedState = {
      version: BUFFERED_STATE_VERSION,
      ...editorState,
      project: registeredProviders.project(),
      layout: registeredProviders.layout()
    }

    if (!isBufferedState(snapshot)) {
      console.warn('Skipping invalid buffered state snapshot')
      return null
    }

    return snapshot
  } catch (err) {
    console.warn('Skipping buffered state snapshot after provider failure', err)
    return null
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
