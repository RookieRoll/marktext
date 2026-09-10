import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const renderer = resolve(__dirname, '../../../src/renderer/src')
const readRendererFile = (relativePath: string): string =>
  readFileSync(resolve(renderer, relativePath), 'utf8')

describe('sidebar lifecycle cleanup', () => {
  it('pairs tree contextmenu listeners with named unmount handlers', () => {
    const treeFile = readRendererFile('components/sideBar/treeFile.vue')
    const treeFolder = readRendererFile('components/sideBar/treeFolder.vue')

    expect(treeFile).toMatch(/const handleContextMenu = \(event: MouseEvent\)/)
    expect(treeFile).toContain("fileEl.value.addEventListener('contextmenu', handleContextMenu)")
    expect(treeFile).toContain(
      "fileEl.value?.removeEventListener('contextmenu', handleContextMenu)"
    )
    expect(treeFolder).toMatch(/const handleContextMenu = \(event: MouseEvent\)/)
    expect(treeFolder).toContain(
      "folderEl.value.addEventListener('contextmenu', handleContextMenu)"
    )
    expect(treeFolder).toContain(
      "folderEl.value?.removeEventListener('contextmenu', handleContextMenu)"
    )
  })

  it('keeps app and settings-sidebar listeners disposable', () => {
    const app = readRendererFile('pages/app.vue')
    const settingsSidebar = readRendererFile('prefComponents/sideBar/index.vue')
    const settingsConfig = readRendererFile('prefComponents/sideBar/config.ts')

    expect(app).toContain("window.addEventListener('dragover', handleDragOver, false)")
    expect(app).toContain("window.removeEventListener('dragover', handleDragOver, false)")
    expect(app).toContain('clearTimeout(timer.value)')
    expect(settingsSidebar).toContain(
      "window.addEventListener('languageChanged', handleLanguageChanged)"
    )
    expect(settingsSidebar).toContain(
      "window.removeEventListener('languageChanged', handleLanguageChanged)"
    )
    expect(settingsSidebar).toContain('stopLanguageChangeListener?.()')
    expect(settingsConfig).toContain("bus.on('language-changed', handleLanguageChange)")
    expect(settingsConfig).toContain(
      "return () => bus.off('language-changed', handleLanguageChange)"
    )
    expect(settingsConfig).not.toContain('setInterval(')
  })
})
