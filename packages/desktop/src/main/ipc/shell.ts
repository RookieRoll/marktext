import { BrowserWindow, ipcMain, shell, clipboard } from 'electron'
import log from 'electron-log'
import * as plist from 'plist'
import { createRendererSenderGuard } from './rendererSender'

const rendererSenderGuard = createRendererSenderGuard((sender) =>
  BrowserWindow.fromWebContents(sender)
)

export const registerShellHandlers = (): void => {
  ipcMain.handle('mt::shell::open-external', async(e, url: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    try {
      await shell.openExternal(url)
      return true
    } catch (err) {
      log.error('shell.openExternal failed:', err)
      return false
    }
  })
  ipcMain.on('mt::shell::open-external', (e, url: string) => {
    if (!rendererSenderGuard.getWindow(e)) return
    shell.openExternal(url).catch((err) => log.error('shell.openExternal failed:', err))
  })
  ipcMain.on('mt::shell::show-item', (e, fullPath: string) => {
    if (!rendererSenderGuard.getWindow(e)) return
    try {
      shell.showItemInFolder(fullPath)
    } catch (err) {
      log.error('shell.showItemInFolder failed:', err)
    }
  })
  ipcMain.handle('mt::shell::open-path', async(e, fullPath: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    try {
      return await shell.openPath(fullPath)
    } catch (err) {
      log.error('shell.openPath failed:', err)
      return String(err instanceof Error ? err.message : err)
    }
  })

  ipcMain.on('mt::clipboard::write-text', (e, text: string) => {
    if (!rendererSenderGuard.getWindow(e)) return
    try {
      clipboard.writeText(text)
    } catch (err) {
      log.error('clipboard.writeText failed:', err)
    }
  })
  ipcMain.handle('mt::clipboard::read-text', (e) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    try {
      return clipboard.readText()
    } catch {
      return ''
    }
  })
  ipcMain.handle('mt::clipboard::guess-file-path', (e) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    try {
      if (process.platform === 'darwin') {
        if (clipboard.has('NSFilenamesPboardType')) {
          const parsed = plist.parse(clipboard.read('NSFilenamesPboardType'))
          return Array.isArray(parsed) && parsed.length ? parsed[0] : ''
        }
        return ''
      }
      if (process.platform === 'win32') {
        const raw = clipboard.read('FileNameW')
        const filePath = raw ? raw.replace(new RegExp(String.fromCharCode(0), 'g'), '') : ''
        return typeof filePath === 'string' ? filePath : ''
      }
      return ''
    } catch (err) {
      log.error('clipboard.guess-file-path failed:', err)
      return ''
    }
  })
}
