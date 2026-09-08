import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BufferedEditorState } from '@shared/types/bufferedState'
import { normalizeBufferedState } from '@shared/types/bufferedState'
import {
  createBufferedState,
  registerBufferedStateStores,
  sendBufferedState,
  type BufferedStateStores
} from '@/store/bufferedState'

const invoke = vi.fn().mockResolvedValue(undefined)
const ipcRendererStub = { invoke }

const createStores = (editorState: BufferedEditorState | null): BufferedStateStores => ({
  editorStore: {
    CREATE_BUFFERED_STATE: vi.fn(() => editorState)
  },
  projectStore: {
    CREATE_BUFFERED_STATE: vi.fn(() => ({ rootDirectory: 'D:/notes' }))
  },
  layoutStore: {
    CREATE_BUFFERED_STATE: vi.fn(() => ({
      rightColumn: 'files',
      showSideBar: true,
      showTabBar: true,
      sideBarWidth: 280
    }))
  }
})


const validTab = {
  id: 'tab-1',
  pathname: 'D:/notes/note.md',
  filename: 'note.md',
  markdown: '# Note',
  isSaved: true,
  encoding: { encoding: 'utf-8', isBom: false },
  lineEnding: 'LF',
  trimTrailingNewline: 0,
  adjustLineEndingOnSave: false,
  cursor: null,
  wordCount: { paragraph: 1, word: 1, character: 6, all: 6 },
  muyaIndexCursor: null,
  scrollTop: 0
}
describe('buffered-state coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.electron = { ipcRenderer: ipcRendererStub } as unknown as Window['electron']
    registerBufferedStateStores(null)
  })


  it('normalizes legacy nested editor snapshots', () => {
    expect(
      normalizeBufferedState({
        version: 1,
        editor: { tabs: [validTab], currentFileId: 'tab-1' },
        project: { rootDirectory: 'D:/notes' }
      })
    ).toEqual({
      version: 1,
      tabs: [validTab],
      currentFileId: 'tab-1',
      restoreWarnings: [],
      project: { rootDirectory: 'D:/notes' }
    })
  })

  it('rejects malformed snapshots instead of partially restoring them', () => {
    expect(normalizeBufferedState({ tabs: [{ ...validTab, markdown: 42 }] })).toBeNull()
    expect(normalizeBufferedState({ editor: { tabs: [] }, layout: { showSideBar: true } })).toBeNull()
  })
  it('does not access IPC before the renderer composition root registers stores', async() => {
    expect(createBufferedState()).toBeNull()
    await expect(sendBufferedState()).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('aggregates editor, project, and layout snapshots through injected providers', () => {
    const stores = createStores({ tabs: [], currentFileId: 'tab-1', restoreWarnings: [] })
    registerBufferedStateStores(stores)

    expect(createBufferedState()).toEqual({
      version: 1,
      tabs: [],
      currentFileId: 'tab-1',
      restoreWarnings: [],
      project: { rootDirectory: 'D:/notes' },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })
    expect(stores.editorStore.CREATE_BUFFERED_STATE).toHaveBeenCalledOnce()
    expect(stores.projectStore.CREATE_BUFFERED_STATE).toHaveBeenCalledOnce()
    expect(stores.layoutStore.CREATE_BUFFERED_STATE).toHaveBeenCalledOnce()
  })

  it('sends the aggregated snapshot through the typed IPC bridge', async() => {
    registerBufferedStateStores(
      createStores({ tabs: [], currentFileId: null, restoreWarnings: [] })
    )

    await sendBufferedState()

    expect(invoke).toHaveBeenCalledWith('update-buffer-state', {
      version: 1,
      tabs: [],
      currentFileId: null,
      restoreWarnings: [],
      project: { rootDirectory: 'D:/notes' },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })
  })
})
