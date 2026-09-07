import fs from 'fs-extra'
import { statSync, constants, type Stats } from 'fs'
import { BrowserWindow, ipcMain } from 'electron'
import { isFile as commonIsFile, isDirectory as commonIsDirectory } from 'common/filesystem'
import { createRendererSenderGuard } from './rendererSender'

interface SerializedStat {
  size: number
  mtimeMs: number
  ctimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

const serializeStat = (stats: Stats): SerializedStat => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  isFile: stats.isFile(),
  isDirectory: stats.isDirectory(),
  isSymbolicLink: stats.isSymbolicLink()
})

const toBuffer = (data: unknown): unknown => {
  if (data == null) return data
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (typeof data === 'string') return data
  if (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: string }).type === 'Buffer' &&
    Array.isArray((data as { data?: unknown }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data)
  }
  return data
}

const rendererSenderGuard = createRendererSenderGuard((sender) =>
  BrowserWindow.fromWebContents(sender)
)

export const registerFsHandlers = (): void => {
  ipcMain.handle('mt::fs::is-file', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return commonIsFile(p)
  })
  ipcMain.handle('mt::fs::is-directory', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return commonIsDirectory(p)
  })
  ipcMain.handle('mt::fs::empty-dir', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.emptyDir(p)
  })
  ipcMain.handle('mt::fs::copy', (e, src: string, dest: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.copy(src, dest)
  })
  ipcMain.handle('mt::fs::ensure-dir', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.ensureDir(p)
  })

  ipcMain.handle('mt::fs::output-file', (e, p: string, data: unknown) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.outputFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::move', (e, src: string, dest: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.move(src, dest, { overwrite: false })
  })
  ipcMain.handle('mt::fs::stat', async(e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return serializeStat(await fs.stat(p))
  })

  ipcMain.handle('mt::fs::write-file', (e, p: string, data: unknown) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.writeFile(p, toBuffer(data) as string | NodeJS.ArrayBufferView)
  })
  ipcMain.handle('mt::fs::read-file', async(e, p: string, encoding?: BufferEncoding) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    const buf = await fs.readFile(p, encoding)
    return buf
  })
  ipcMain.handle('mt::fs::path-exists', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.pathExists(p)
  })
  ipcMain.handle('mt::fs::unlink', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.unlink(p)
  })
  ipcMain.handle('mt::fs::readdir', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    return fs.readdir(p)
  })
  ipcMain.handle('mt::fs::is-executable', (e, p: string) => {
    rendererSenderGuard.assertTrustedRenderer(e)
    try {
      const stat = statSync(p)
      if (process.platform === 'win32') return stat.isFile()
      return (
        stat.isFile() &&
        (stat.mode & (constants.S_IXUSR | constants.S_IXGRP | constants.S_IXOTH)) !== 0
      )
    } catch {
      return false
    }
  })
}
