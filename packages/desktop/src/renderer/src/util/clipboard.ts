import { isLinux } from './index'
import { getClipboardBridge } from '@/platform/electron'

export const guessClipboardFilePath = async(): Promise<string> => {
  if (isLinux) return ''
  try {
    const result = await getClipboardBridge().guessFilePath()
    return typeof result === 'string' ? result : ''
  } catch {
    return ''
  }
}
