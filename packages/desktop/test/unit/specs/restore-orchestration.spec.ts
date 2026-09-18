import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRestoreCompletionTracker, planRestore } from '../../../src/main/windows/restorePlan'
import { restoreTabContent } from '../../../src/main/windows/restoreTab'

// The layer split in `_restoreAllState` is what makes the first window usable
// without waiting for every restored document. Its ordering guarantees are not
// observable from a pure unit test (they depend on Electron's window/`ipcMain`
// surface), so assert the orchestration markers in place — the same
// characterization style used by the other startup/lifecycle specs — and pair
// them with executable tests for the pure policy modules.
const desktopRoot = resolve(__dirname, '../../..')
const readSource = (relativePath: string): string =>
  readFileSync(resolve(desktopRoot, relativePath), 'utf8')
const compact = (source: string): string => source.replace(/\s+/g, ' ')
const editorWindowSource = compact(readSource('src/main/windows/editor.ts'))

describe('layered startup restore orchestration', () => {
  it('refreshes the active document before handing state to the renderer', () => {
    const activeRefresh = editorWindowSource.indexOf('await refreshTab(activeTab, false)')
    const loadState = editorWindowSource.indexOf(
      "browserWindow.webContents.send('mt::load-state', bufferState)"
    )
    const backgroundQueue = editorWindowSource.indexOf('scheduleRestoreTasks(')

    expect(activeRefresh).toBeGreaterThanOrEqual(0)
    expect(loadState).toBeGreaterThanOrEqual(0)
    expect(backgroundQueue).toBeGreaterThanOrEqual(0)
    // Active content is read first, the renderer gets its tabs next, and only
    // then is the non-active queue scheduled.
    expect(activeRefresh).toBeLessThan(loadState)
    expect(loadState).toBeLessThan(backgroundQueue)
  })

  it('does not block the first window on the non-active restore queue', () => {
    // The active-document work is awaited inside `restoreActiveDocument`, which
    // is invoked without being awaited by `_restoreAllState`; the background
    // queue is only scheduled from inside that same function.
    expect(editorWindowSource).toContain('restoreActiveDocument().catch((error) => {')
    expect(editorWindowSource).toContain(
      'if (activeTab) activeFailure = await refreshTab(activeTab, false)'
    )
    expect(editorWindowSource).toContain(
      'restoreCompletion.startBackgroundTasks(backgroundTabs.length)'
    )
  })

  it('bounds and cancels background restore work per window', () => {
    expect(editorWindowSource).toContain('private _restoreAbortController: AbortController | null')
    expect(editorWindowSource).toContain('const backgroundController = new AbortController()')
    expect(editorWindowSource).toContain('{ concurrency: 2, signal: backgroundController.signal }')
    expect(editorWindowSource).toContain('this._restoreAbortController = backgroundController')
    // A closing window aborts its own queue and drops the reference, so a late
    // result can neither write back into the renderer nor leak across windows.
    expect(editorWindowSource).toContain('this._restoreAbortController?.abort()')
    expect(editorWindowSource).toContain('this._restoreAbortController = null')
    expect(editorWindowSource).toContain('if (!this._isWindowUsable(browserWindow)) return null')
  })

  it('isolates a failed restored tab and keeps reporting other tabs', () => {
    // A failure is reported as metadata plus a tab notification; it never
    // rejects the shared restore promise nor writes an error into the content.
    expect(editorWindowSource).toContain(
      "browserWindow.webContents.send('mt::restore-tab-failed', {"
    )
    expect(editorWindowSource).toContain('const failure = await refreshTab(tab)')
    expect(editorWindowSource).toContain('if (failure) handleRestoreFailure(failure)')
    expect(editorWindowSource).toContain('activeFailure = await refreshTab(activeTab, false)')
  })

  it('keeps background tab content out of the first interactive payload', () => {
    // The active refresh writes the tab in memory but is told not to notify the
    // renderer, and the renderer only receives non-active Markdown once the
    // background task for that tab completes.
    const refreshTab = editorWindowSource.slice(
      editorWindowSource.indexOf('const refreshTab = async('),
      editorWindowSource.indexOf('const restoreActiveDocument =')
    )
    expect(refreshTab).toContain('if (notifyRenderer) {')
    expect(refreshTab).toContain("browserWindow.webContents.send('mt::restore-tab-content', {")
    const guard = refreshTab.indexOf('if (notifyRenderer) {')
    const send = refreshTab.indexOf("send('mt::restore-tab-content'")
    expect(guard).toBeGreaterThanOrEqual(0)
    // The only content send in `refreshTab` sits inside the guard, so the
    // active refresh (`notifyRenderer = false`) cannot re-deliver content the
    // renderer already received in the first interactive payload.
    expect(send).toBeGreaterThan(guard)
    expect(refreshTab.slice(0, guard)).not.toContain("send('mt::restore-tab-content'")
  })
})

describe('restored tab metadata and content guarantees', () => {
  it('keeps unsaved buffers intact while the background queue refreshes metadata', async () => {
    const unsaved = {
      id: 'draft',
      pathname: '/notes/draft.md',
      filename: 'draft.md',
      markdown: '# Unsaved draft',
      isSaved: false
    }

    const result = await restoreTabContent(unsaved, async () => ({ markdown: '# Disk' }))

    expect(result).toEqual({ status: 'unchanged', tabId: 'draft' })
    expect(unsaved.markdown).toBe('# Unsaved draft')
    expect(unsaved.isSaved).toBe(false)
  })

  it('reports a background failure without losing the recovered content', async () => {
    const broken = {
      id: 'broken',
      pathname: '/notes/broken.md',
      filename: 'broken.md',
      markdown: '# Recovered',
      isSaved: true
    }

    const result = await restoreTabContent(broken, async () => {
      throw new Error('EACCES: permission denied')
    })

    expect(result.status).toBe('failed')
    expect(broken.markdown).toBe('# Recovered')
    // Marked unsaved so closing or saving cannot silently discard the recovery.
    expect(broken.isSaved).toBe(false)
  })

  it('does not let a single failure end the background queue early', async () => {
    const tabs = [
      {
        id: 'broken',
        pathname: '/notes/broken.md',
        filename: 'broken.md',
        markdown: '# A',
        isSaved: true
      },
      {
        id: 'third',
        pathname: '/notes/third.md',
        filename: 'third.md',
        markdown: '# B',
        isSaved: true
      }
    ]
    const completion = createRestoreCompletionTracker(() => {})
    const failures: string[] = []

    // Mirrors the queue body: each task reports its own outcome and always
    // accounts for completion, so one failure cannot strand the tracker.
    completion.activeDocumentSettled()
    completion.startBackgroundTasks(tabs.length)
    await Promise.all(
      tabs.map(async (tab) => {
        const result = await restoreTabContent(tab, async (pathname) => {
          if (pathname.endsWith('broken.md')) throw new Error('missing')
          return { markdown: '# Disk' }
        })
        if (result.status === 'failed') failures.push(result.tabId)
        completion.backgroundTaskFinished()
      })
    )

    expect(failures).toEqual(['broken'])
    expect(completion.pendingBackgroundTasks).toBe(0)
    expect(completion.complete).toBe(true)
  })

  it('assigns every restored document to exactly one restore layer', () => {
    const restored = [{ id: 'first' }, { id: 'second' }, { id: 'third' }, { id: 'fourth' }]
    const plan = planRestore(restored, 'third')

    const layers = [plan.activeTab, ...plan.backgroundTabs].filter(
      (tab): tab is { id: string } => tab !== undefined
    )
    expect(layers).toHaveLength(restored.length)
    expect(new Set(layers.map((tab) => tab.id)).size).toBe(restored.length)
    expect(plan.activeTab?.id).toBe('third')
  })
})
