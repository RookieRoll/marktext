import { ipcMain } from 'electron'
import log from 'electron-log'
import { createEnsureService } from '../utils/ensureService'

interface FontListShape {
  getFonts?: () => Promise<string[]>
  default?: { getFonts?: () => Promise<string[]> }
}

const ensureFontList = createEnsureService(async () => {
  const fontList = (await import('font-list')) as FontListShape
  const getFonts = fontList.getFonts || fontList.default?.getFonts
  if (typeof getFonts !== 'function') throw new Error('font-list does not expose getFonts')
  return getFonts
})

export const registerFontsHandlers = (): void => {
  ipcMain.handle('mt::fonts::list', async() => {
    try {
      const getFonts = await ensureFontList()
      return await getFonts()
    } catch (err) {
      log.error('font-list failed:', err)
      return []
    }
  })
}
