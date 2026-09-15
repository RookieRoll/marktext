import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const renderer = resolve(__dirname, '../../../src/renderer/src')
const readRendererFile = (relativePath: string): string =>
  readFileSync(resolve(renderer, relativePath), 'utf8')

describe('sidebar lifecycle cleanup', () => {
  it('delegates row context menus to a single container listener', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')
    const treeRow = readRendererFile('components/sideBar/treeRow.vue')

    // The scroll container owns one `contextmenu` listener and resolves the
    // logical row through `data-pathname`, so no per-row listener exists.
    expect(tree).toContain('@contextmenu.prevent="handleTreeContextMenu"')
    expect(tree).toContain("target?.closest?.('[data-pathname]')")
    expect(treeRow).toContain(':data-pathname="row.pathname"')
    expect(treeRow).not.toContain('addEventListener')
    expect(treeRow).not.toContain('removeEventListener')
  })

  it('renders only the virtual window instead of the whole logical tree', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')

    // The list iterates the windowed slice, never `projectTree.folders/files`,
    // so mounted row count stays proportional to the viewport.
    expect(tree).toContain('v-for="entry of visibleSlice"')
    expect(tree).toContain('visibleRows.value.slice(virtualRange.value.start, virtualRange.value.end)')
    expect(tree).toContain('height: ')
    expect(tree).toContain('virtualRange.totalHeight')
    expect(tree).not.toContain('v-for="folder of projectTree.folders"')
    expect(tree).not.toContain('v-for="file of projectTree.files"')
  })
  it('keeps file nodes from subscribing to the whole editor tab state', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')
    const treeRow = readRendererFile('components/sideBar/treeRow.vue')
    const openedTab = readRendererFile('components/sideBar/treeOpenedTab.vue')

    // Only the container reads the active tab; rows receive plain booleans.
    expect(tree).toContain('const isRowCurrent = (row: TreeRowModel): boolean =>')
    expect(tree).toContain(':is-current="isRowCurrent(entry)"')
    expect(treeRow).not.toContain('useEditorStore')
    expect(treeRow).not.toContain('storeToRefs')
    expect(openedTab).toContain(':class="[{ active: isActive, unsaved: !file.isSaved }]"')
  })

  it('subscribes to tree notifications once at the container, not per node', () => {
    const tree = readRendererFile('components/sideBar/tree.vue')
    const treeRow = readRendererFile('components/sideBar/treeRow.vue')

    // The container owns the global subscriptions and routes by row key.
    expect(tree).toContain("bus.on('SIDEBAR::show-new-input', focusCreateRow)")
    expect(tree).toContain("bus.on('SIDEBAR::show-rename-input', focusRenameRow)")
    expect(tree).toContain("bus.off('SIDEBAR::show-new-input', focusCreateRow)")
    expect(tree).toContain("bus.off('SIDEBAR::show-rename-input', focusRenameRow)")
    expect(tree).toContain('provide<SidebarNodeRegistry>')

    // Rows only register their handlers, so listener count no longer grows with
    // the number of rendered files and folders.
    expect(treeRow).not.toContain('bus.on(')
    expect(treeRow).toContain('registry?.register(props.row.key')
    expect(treeRow).toContain('unregisterNode?.()')
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
