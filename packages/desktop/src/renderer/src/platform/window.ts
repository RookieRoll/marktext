import { getIpcRenderer } from './electron'
import { getCurrentWindowId } from './runtime'

export { getCurrentWindowId } from './runtime'

export const openFileByWindowId = (filePath: string): void => {
  const windowId = getCurrentWindowId()
  if (windowId === null) return
  getIpcRenderer().send('mt::open-file-by-window-id', windowId, filePath)
}
