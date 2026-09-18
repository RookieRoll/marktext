import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktopRoot = resolve(__dirname, '../../..')
const readSource = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, relativePath), 'utf8')

const compact = (source: string): string => source.replace(/\s+/g, ' ')

// The startup-memory change was archived on 2026-09-16; its evidence docs now
// live under `openspec/changes/archive/`. Point the audit at the archived copy
// so these source-of-truth assertions survive the archive move.
const STARTUP_MEMORY_CHANGE_DIR =
  '../../openspec/changes/archive/2026-09-16-optimize-startup-memory'

describe('editor window lifecycle ownership', () => {
  it('removes a closed window from the registry before active-window callbacks can resolve it', () => {
    const source = compact(readSource('src/main/app/windowManager.ts'))

    expect(source).toContain('_windows.delete(windowId)')
    expect(source).toContain("window.removeAllListeners('window-focus')")
    expect(source).toContain('this._watcher.unwatchByWindowId(windowId)')
    expect(source).toContain('this._appMenu.removeWindowMenu(windowId)')
    expect(source.indexOf('_windows.delete(windowId)')).toBeLessThan(
      source.indexOf('this._windowActivity.delete(windowId)')
    )
  })

  it('cleans editor-window resources and rejects late async work after close', () => {
    const source = compact(readSource('src/main/windows/editor.ts'))

    for (const marker of [
      'private _pendingOpenTimer',
      'private _windowResourcesCleaned',
      'this._unregisterAllowedLocalResourceRoots()',
      'clearTimeout(this._pendingOpenTimer)',
      'this._directoryToOpen = null',
      'this._filesToOpen = null',
      'this._openedFiles = null',
      'this.bufferStoreInfo = null',
      'this.browserWindow = null',
      'if (!this._isWindowUsable(browserWindow)) return',
      "browserWindow.webContents.send('mt::load-state', bufferState)"
    ]) {
      expect(source, `missing lifecycle marker: ${marker}`).toContain(marker)
    }
  })

  it('keeps tab state serializable while pruning replaceable runtime state', () => {
    const component = compact(readSource('src/renderer/src/components/editorWithTabs/editor.vue'))
    const store = compact(readSource('src/renderer/src/store/editor.ts'))

    expect(component).toContain('const engineHistoryByTab = new Map<string, unknown>()')
    expect(component).toContain('const syntheticHistoryByTab = new Map<string, SyntheticHistory>()')
    expect(component).toContain('pruneClosedTabState(new Set())')
    expect(component).toContain('imageViewer.destroy()')
    expect(component).toContain('editor.value.destroy()')
    expect(component).toContain('printer?.clearup()')
    expect(component).toContain('commandCenterStore.REMOVE_COMMAND')
    expect(store).toContain('clearAutoSaveTimer(file.id)')
    expect(store).toContain('tab.cursor = cursor')
    expect(store).toContain('scrollTop: tab.scrollTop ?? defaultFileState.scrollTop')
  })

  it('preserves unsaved recovery fields and does not delete recovery state during renderer cleanup', () => {
    const store = compact(readSource('src/renderer/src/store/editor.ts'))
    const bufferStore = compact(readSource('src/main/editorBufferStore/index.ts'))
    const editorWindow = compact(readSource('src/main/windows/editor.ts'))
    const doc = compact(readSource(`${STARTUP_MEMORY_CHANGE_DIR}/window-lifecycle.md`))

    for (const marker of [
      "markdown: typeof tab.markdown === 'string' ? tab.markdown : defaultFileState.markdown",
      'encoding: toSerializableValue(tab.encoding, defaultFileState.encoding)',
      'lineEnding: tab.lineEnding ?? defaultFileState.lineEnding',
      'cursor: toSerializableValue(tab.cursor, defaultFileState.cursor)',
      'scrollTop: tab.scrollTop ?? defaultFileState.scrollTop',
      'tab.isSaved = false',
      'writeBufferStoreFile(bufferStore.filePath, newState)'
    ]) {
      expect(store + bufferStore + editorWindow, `missing recovery marker: ${marker}`).toContain(
        marker
      )
    }

    // The restore path now lives in `restoreTab.ts`, which reads the on-disk
    // document but never overwrites an unsaved buffer's Markdown. Keep that
    // guarantee asserted against the module that owns it today.
    expect(compact(readSource('src/main/windows/restoreTab.ts'))).toContain(
      'if (tab.isSaved && document.markdown !== tab.markdown) {'
    )

    expect(doc).toContain('buffered-state debounce 不由该清理误取消')
    expect(doc).toContain('关闭窗口也不删除应用级恢复文件')
  })

  it('isolates multi-window state through window ids, restore ids and renderer teardown', () => {
    const manager = compact(readSource('src/main/app/windowManager.ts'))
    const editorWindow = compact(readSource('src/main/windows/editor.ts'))
    const bufferStore = compact(readSource('src/main/editorBufferStore/index.ts'))
    const doc = compact(readSource(`${STARTUP_MEMORY_CHANGE_DIR}/window-lifecycle.md`))

    expect(manager).toContain('private _windows: Map<number, BaseWindow>')
    expect(manager).toContain('rendererSenderGuard.getWindow(e)')
    expect(editorWindow).toContain('this.bufferStoreInfo = {')
    expect(editorWindow).toContain('restoreBufferId')
    expect(bufferStore).toContain('const restoreBufferId =')
    expect(bufferStore).toContain('this.getBufferStoreInfo(restoreBufferId)')
    expect(doc).toContain('每个 Electron `BrowserWindow` 有独立 Renderer 全局')
    expect(doc).toContain('关闭已保存且无需恢复的 tab 不删除其它 tab 或其它窗口的状态')
  })
})
