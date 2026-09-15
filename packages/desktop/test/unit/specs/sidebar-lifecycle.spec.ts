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

  it('keeps file nodes from subscribing to the whole editor tab state', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')
    const treeFile = readRendererFile('components/sideBar/treeFile.vue')
    const treeFolder = readRendererFile('components/sideBar/treeFolder.vue')
    const openedTab = readRendererFile('components/sideBar/treeOpenedTab.vue')

    expect(tree).toContain(':current-file-pathname="currentFile?.pathname ?? \'\'"')
    expect(treeFile).toContain('currentFilePathname === file.pathname')
    expect(treeFile).toContain('editorStore.OPEN_OR_SWITCH_FILE(pathname)')
    expect(treeFile).not.toContain('const { currentFile, tabs } = storeToRefs(editorStore)')
    expect(treeFolder).toContain(':current-file-pathname="currentFilePathname"')
    expect(openedTab).toContain(':class="[{ active: isActive, unsaved: !file.isSaved }]"')
  })

  it('subscribes to tree notifications once at the container, not per node', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')
    const treeFile = readRendererFile('components/sideBar/treeFile.vue')
    const treeFolder = readRendererFile('components/sideBar/treeFolder.vue')

    // The container owns the global subscriptions and routes by pathname.
    expect(tree).toContain("bus.on('SIDEBAR::show-new-input', handleInputFocus)")
    expect(tree).toContain("bus.on('SIDEBAR::show-rename-input', handleRenameFocus)")
    expect(tree).toContain("bus.off('SIDEBAR::show-new-input', handleInputFocus)")
    expect(tree).toContain("bus.off('SIDEBAR::show-rename-input', handleRenameFocus)")
    expect(tree).toContain('SIDEBAR_NODE_REGISTRY')

    // Nodes only register their handlers, so listener count no longer grows
    // with the number of rendered files and folders.
    for (const node of [treeFile, treeFolder]) {
      expect(node).not.toContain("bus.on('SIDEBAR::show-new-input'")
      expect(node).not.toContain("bus.on('SIDEBAR::show-rename-input'")
      expect(node).toContain('unregisterNode?.()')
    }
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
