import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { IFileState, MarkdownDocument } from '@shared/types/files'

// The editor store is renderer code, but its production dependencies expect
// preload globals to exist. Keep the bridge small and deterministic so these
// tests exercise store behavior without starting Electron.
vi.hoisted(() => {
  const dirname = (pathname: string): string => {
    const normalized = pathname.replaceAll('\\', '/')
    const separator = normalized.lastIndexOf('/')
    if (separator < 0) return '.'
    if (separator === 0) return '/'
    return normalized.slice(0, separator)
  }

  const path = {
    basename: (pathname: string) => pathname.slice(pathname.lastIndexOf('/') + 1),
    dirname,
    extname: (pathname: string) => {
      const filename = pathname.slice(pathname.lastIndexOf('/') + 1)
      const separator = filename.lastIndexOf('.')
      return separator > 0 ? filename.slice(separator) : ''
    },
    join: (...parts: string[]) => parts.join('/').replaceAll(/\/+/g, '/'),
    resolve: (...parts: string[]) => parts.join('/').replaceAll(/\/+/g, '/'),
    relative: () => '',
    isAbsolute: (pathname: string) => pathname.startsWith('/'),
    normalize: (pathname: string) => pathname.replaceAll('\\', '/'),
    parse: () => ({ root: '/', dir: '/', base: '', ext: '', name: '' }),
    format: () => '',
    sep: '/',
    delimiter: ':'
  }

  const ipcRenderer = {
    send: vi.fn(),
    sendSync: vi.fn(),
    invoke: vi.fn(() => Promise.resolve(true)),
    on: vi.fn(),
    once: vi.fn(),
    removeAllListeners: vi.fn()
  }

  const target = globalThis as unknown as { window?: Window }
  target.window ??= {} as Window
  target.window.path = path as unknown as Window['path']
  target.window.fileUtils = {
    isSamePathSync: (left: string, right: string) => left === right
  } as unknown as Window['fileUtils']
  target.window.electron = {
    ipcRenderer: ipcRenderer as unknown as Window['electron']['ipcRenderer'],
    clipboard: { writeText: vi.fn() },
    shell: {},
    webFrame: {},
    webUtils: {},
    process: { platform: 'win32', versions: {}, env: {} },
    paths: {},
    windowControl: {}
  } as unknown as Window['electron']
  target.window.DIRNAME = ''
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(() => Promise.resolve()), name: 'notify' }
}))

// Persistence is an orthogonal concern. Mocking the coordinator prevents its
// debounce timer from leaking between tests and keeps assertions local to the
// editor store state transitions.
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn(() => Promise.resolve(true))
}))

import { disposeEditorStoreRuntime, useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'

interface IpcListener {
  (event: unknown, ...args: unknown[]): void
}

const getIpcMock = (): { on: Mock; send: Mock } =>
  window.electron.ipcRenderer as unknown as { on: Mock; send: Mock }

const getIpcHandler = (channel: string): IpcListener => {
  const registration = getIpcMock().on.mock.calls.find((call) => call[0] === channel)
  expect(registration).toBeDefined()
  return registration?.[1] as IpcListener
}

const makeDocument = (
  id: string,
  pathname: string,
  filename = `${id}.md`,
  markdown = `# ${id}`
): MarkdownDocument => ({
  markdown,
  filename,
  pathname,
  lineEnding: 'lf'
})

const makeState = (
  id: string,
  pathname: string,
  filename = `${id}.md`,
  markdown = `# ${id}`
): IFileState => ({
  id,
  filename,
  pathname,
  markdown,
  isSaved: true,
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 3,
  history: { stack: [], index: -1 },
  cursor: null,
  wordCount: { paragraph: 0, word: 0, character: 0, all: 0 },
  searchMatches: { index: -1, matches: [], value: '' },
  scrollTop: 0,
  muyaIndexCursor: null,
  notifications: [],
  lastSavedHistoryId: 0
})

const makeBufferedTab = (
  id: string,
  pathname: string,
  filename: string,
  markdown: string,
  isSaved = true
) => ({
  id,
  pathname,
  filename,
  markdown,
  isSaved,
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  trimTrailingNewline: 3,
  adjustLineEndingOnSave: false,
  cursor: null,
  wordCount: { paragraph: 0, word: 0, character: 0, all: 0 },
  muyaIndexCursor: null,
  scrollTop: 0
})

describe('useEditorStore document lifecycle characterization', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.DIRNAME = ''
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('starts with no current file, tabs, or tab index entries', () => {
    const store = useEditorStore()

    expect(store.currentFile).toBeNull()
    expect(store.tabs).toEqual([])
    expect(store.tabIdToIndex).toEqual({})
    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
  })

  it('loads a document into the current tab and synchronizes its document directory', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('readme', '/workspace/docs/readme.md', 'readme.md', '# Readme')
    })

    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile).toMatchObject({
      filename: 'readme.md',
      pathname: '/workspace/docs/readme.md',
      markdown: '# Readme',
      isSaved: true
    })
    expect(store.currentFile?.id).toBe(store.tabs[0]?.id)
    expect(store.tabIdToIndex[store.currentFile?.id ?? '']).toBe(0)
    expect(store.currentFile?.wordCount).toEqual({
      paragraph: 1,
      word: 2,
      character: 7,
      all: 8
    })
    expect(window.DIRNAME).toBe('/workspace/docs')
  })

  it('updates the all counter for the empty-document newline sentinel', () => {
    const store = useEditorStore()

    store.NEW_UNTITLED_TAB({})
    const id = store.currentFile?.id
    if (!id) throw new Error('Expected a current file')

    store.LISTEN_FOR_CONTENT_CHANGE({ id, markdown: '\n' })

    expect(store.currentFile?.wordCount).toEqual({
      paragraph: 1,
      word: 0,
      character: 0,
      all: 1
    })
  })

  it('recalculates word count when content changes omit the snapshot', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('stats', '/workspace/stats.md', 'stats.md', 'old')
    })
    const id = store.currentFile?.id
    if (!id) throw new Error('Expected a current file')

    store.LISTEN_FOR_CONTENT_CHANGE({ id, markdown: 'hello world' })

    expect(store.currentFile?.wordCount).toEqual({
      paragraph: 1,
      word: 2,
      character: 10,
      all: 11
    })
  })

  it('switches the current tab and keeps the document directory aligned', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second/second.md'),
      selected: false
    })

    expect(store.currentFile?.pathname).toBe('/workspace/first/first.md')

    store.SWITCH_TAB_BY_INDEX(1)

    expect(store.currentFile?.pathname).toBe('/workspace/second/second.md')
    expect(window.DIRNAME).toBe('/workspace/second')
  })

  it('opens a new sidebar file or switches to an existing tab', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    const secondId = store.tabs[1]?.id
    if (!secondId) throw new Error('Expected a second tab')

    getIpcMock().send.mockClear()
    store.OPEN_OR_SWITCH_FILE('/workspace/second.md')

    expect(store.currentFile?.id).toBe(secondId)
    expect(getIpcMock().send).not.toHaveBeenCalledWith('mt::open-file', '/workspace/second.md', {})

    store.OPEN_OR_SWITCH_FILE('/workspace/third.md')
    expect(getIpcMock().send).toHaveBeenCalledWith('mt::open-file', '/workspace/third.md', {})
  })

  it('selects the next tab after closing the current tab', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('third', '/workspace/third.md'),
      selected: false
    })
    store.SWITCH_TAB_BY_INDEX(1)

    const closingId = store.currentFile?.id
    store.CLOSE_TAB(store.currentFile)

    expect(store.tabs.map((tab) => tab.filename)).toEqual(['first.md', 'third.md'])
    expect(store.currentFile?.id).not.toBe(closingId)
    expect(store.currentFile?.filename).toBe('third.md')
    expect(window.DIRNAME).toBe('/workspace')
  })

  it('selects the previous tab after closing the last current tab', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    store.SWITCH_TAB_BY_INDEX(1)

    store.CLOSE_TAB(store.currentFile)

    expect(store.tabs.map((tab) => tab.filename)).toEqual(['first.md'])
    expect(store.currentFile?.filename).toBe('first.md')
    expect(window.DIRNAME).toBe('/workspace')
  })

  it('clears the current file and document directory when the last tab closes', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('only', '/workspace/only.md')
    })
    store.CLOSE_TAB(store.currentFile)

    expect(store.tabs).toEqual([])
    expect(store.currentFile).toBeNull()
    expect(window.DIRNAME).toBe('')
    expect(store.listToc).toEqual([])
    expect(store.toc).toEqual([])
  })

  it('closes a batch of tabs, ignores missing ids, and selects the remaining tab', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    const firstId = store.currentFile?.id
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    const secondId = store.tabs[1]?.id
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('third', '/workspace/third.md'),
      selected: false
    })
    const thirdId = store.tabs[2]?.id

    store.CLOSE_TABS([firstId ?? '', thirdId ?? '', 'missing-tab'])

    expect(store.tabs.map((tab) => tab.id)).toEqual([secondId])
    expect(store.currentFile?.id).toBe(secondId)
    expect(window.DIRNAME).toBe('/workspace')
  })

  it('exchanges tabs and cycles through the reordered tabs with wraparound', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    const firstId = store.currentFile?.id ?? ''
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    const secondId = store.tabs[1]?.id ?? ''
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('third', '/workspace/third.md'),
      selected: false
    })
    const thirdId = store.tabs[2]?.id ?? ''

    store.EXCHANGE_TABS_BY_ID({ fromId: firstId, toId: thirdId })

    expect(store.tabs.map((tab) => tab.id)).toEqual([secondId, firstId, thirdId])
    expect(store.currentFile?.id).toBe(firstId)

    store.CYCLE_TABS(true)
    expect(store.currentFile?.id).toBe(thirdId)
    store.CYCLE_TABS(true)
    expect(store.currentFile?.id).toBe(secondId)
    store.CYCLE_TABS(false)
    expect(store.currentFile?.id).toBe(thirdId)
  })

  it('keeps the current tab when switching by an invalid index or empty path', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    const currentId = store.currentFile?.id

    store.SWITCH_TAB_BY_INDEX(-1)
    store.SWITCH_TAB_BY_INDEX(store.tabs.length)
    store.SWITCH_TAB_BY_FILEPATH('')

    expect(store.currentFile?.id).toBe(currentId)
  })

  it('does not create a second tab when opening a duplicate pathname', () => {
    const store = useEditorStore()
    const document = makeDocument('same', '/workspace/same.md')

    store.NEW_TAB_WITH_CONTENT({ markdownDocument: document })
    const existingId = store.currentFile?.id
    store.NEW_TAB_WITH_CONTENT({ markdownDocument: document, selected: false })

    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile?.id).toBe(existingId)
  })

  it('closes the existing tab when a saved tab receives its duplicate pathname', () => {
    const store = useEditorStore()

    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('first', '/workspace/first.md')
    })
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('second', '/workspace/second.md'),
      selected: false
    })
    const renamedTab = store.tabs[1]
    if (!renamedTab) throw new Error('Expected a second tab')

    store.LISTEN_FOR_SET_PATHNAME()
    const handleSetPathname = getIpcHandler('mt::set-pathname')
    handleSetPathname(undefined, {
      id: renamedTab.id,
      filename: 'first.md',
      pathname: '/workspace/first.md'
    })

    expect(store.tabs).toHaveLength(1)
    expect(store.currentFile?.id).toBe(renamedTab.id)
    expect(store.currentFile).toMatchObject({
      filename: 'first.md',
      pathname: '/workspace/first.md',
      isSaved: true
    })
  })

  it('schedules auto-save and replaces an earlier timer for the same tab', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSaveDelay = 100
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('draft', '/workspace/draft.md', 'draft.md', 'initial')
    })
    const tab = store.currentFile
    if (!tab) throw new Error('Expected a current file')
    tab.isSaved = false

    const options = {
      encoding: tab.encoding,
      lineEnding: tab.lineEnding,
      adjustLineEndingOnSave: tab.adjustLineEndingOnSave,
      trimTrailingNewline: tab.trimTrailingNewline
    }
    getIpcMock().send.mockClear()
    store.HANDLE_AUTO_SAVE({
      id: tab.id,
      filename: tab.filename,
      pathname: tab.pathname,
      markdown: 'first pending edit',
      options
    })
    store.HANDLE_AUTO_SAVE({
      id: tab.id,
      filename: tab.filename,
      pathname: tab.pathname,
      markdown: 'latest pending edit',
      options
    })

    vi.advanceTimersByTime(99)
    expect(getIpcMock().send).not.toHaveBeenCalledWith(
      'mt::response-file-save',
      tab.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )

    vi.advanceTimersByTime(1)
    expect(getIpcMock().send).toHaveBeenCalledTimes(1)
    expect(getIpcMock().send).toHaveBeenCalledWith(
      'mt::response-file-save',
      tab.id,
      'draft.md',
      '/workspace/draft.md',
      'latest pending edit',
      expect.objectContaining(options),
      ''
    )
  })

  it('disposes deferred window work without cancelling recovery state', () => {
    vi.useFakeTimers()
    const store = useEditorStore()

    store.LISTEN_FOR_BOOTSTRAP_WINDOW()
    disposeEditorStoreRuntime()
    vi.advanceTimersByTime(1000)

    expect(getIpcMock().send).not.toHaveBeenCalledWith('mt::request-keybindings')
  })

  it('cancels a pending auto-save when the renderer window is disposed', () => {
    vi.useFakeTimers()
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSaveDelay = 100
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('draft', '/workspace/draft.md', 'draft.md', 'initial')
    })
    const tab = store.currentFile
    if (!tab) throw new Error('Expected a current file')
    tab.isSaved = false

    store.HANDLE_AUTO_SAVE({
      id: tab.id,
      filename: tab.filename,
      pathname: tab.pathname,
      markdown: 'pending edit',
      options: {
        encoding: tab.encoding,
        lineEnding: tab.lineEnding,
        adjustLineEndingOnSave: tab.adjustLineEndingOnSave,
        trimTrailingNewline: tab.trimTrailingNewline
      }
    })

    disposeEditorStoreRuntime()
    vi.advanceTimersByTime(1000)

    expect(getIpcMock().send).not.toHaveBeenCalledWith(
      'mt::response-file-save',
      tab.id,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })

  it('reloads a saved tab immediately when auto-save is enabled and the disk content changes', () => {
    const store = useEditorStore()
    const preferences = usePreferencesStore()
    preferences.autoSave = true
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('note', '/workspace/note.md', 'note.md', 'before')
    })
    const tab = store.currentFile
    if (!tab) throw new Error('Expected a current file')
    const tabId = tab.id
    tab.scrollTop = 42
    const notifySpy = vi.spyOn(store, 'pushTabNotification')

    store.LISTEN_FOR_FILE_CHANGE()
    const handleFileChange = getIpcHandler('mt::update-file')
    handleFileChange(undefined, {
      type: 'change',
      change: {
        pathname: '/workspace/note.md',
        data: {
          filename: 'note.md',
          markdown: 'after',
          lineEnding: 'lf'
        }
      }
    })

    expect(tab).toMatchObject({
      id: tabId,
      markdown: 'after',
      isSaved: true,
      scrollTop: 42
    })
    expect(notifySpy).not.toHaveBeenCalled()
  })

  it('marks a tab unsaved and records a notification when saving fails', () => {
    const store = useEditorStore()
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('draft', '/workspace/draft.md')
    })
    const tab = store.currentFile
    if (!tab) throw new Error('Expected a current file')
    const notifySpy = vi.spyOn(store, 'pushTabNotification')

    store.LISTEN_FOR_SET_PATHNAME()
    const handleSaveFailure = getIpcHandler('mt::tab-save-failure')
    handleSaveFailure(undefined, tab.id, 'disk full')

    expect(tab.isSaved).toBe(false)
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: tab.id,
        style: 'crit',
        msg: expect.any(String)
      })
    )
  })
})

describe('useEditorStore save-related state updates', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.DIRNAME = ''
    vi.clearAllMocks()
  })

  it('updates the current tab path, filename, clean state, and directory after saving', () => {
    const store = useEditorStore()
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('draft', '', 'draft.md', 'draft')
    })
    if (!store.currentFile) throw new Error('Expected a current file')
    store.currentFile.isSaved = false

    store.LISTEN_FOR_SET_PATHNAME()
    const handleSetPathname = getIpcHandler('mt::set-pathname')

    handleSetPathname(undefined, {
      id: store.currentFile.id,
      filename: 'draft.md',
      pathname: '/workspace/saved/draft.md'
    })

    expect(store.currentFile).toMatchObject({
      filename: 'draft.md',
      pathname: '/workspace/saved/draft.md',
      isSaved: true
    })
    expect(window.DIRNAME).toBe('/workspace/saved')
  })

  it('marks a tab saved and records the saved history entry after tab-saved', () => {
    const store = useEditorStore()
    const tab = makeState('saved', '/workspace/saved.md')
    tab.isSaved = false
    tab.history = {
      stack: [{ id: 42 }],
      index: 0,
      lastEditIndex: 0,
      lastInitIndex: -1
    }
    store.tabs = [tab]
    store.currentFile = tab
    store.updateTabIdToIndex()

    store.LISTEN_FOR_SET_PATHNAME()
    const handleTabSaved = getIpcHandler('mt::tab-saved')
    handleTabSaved(undefined, tab.id)

    expect(store.tabs[0]?.isSaved).toBe(true)
    expect(store.tabs[0]?.lastSavedHistoryId).toBe(42)
  })

  it('restores tabs with remapped ids, selects the persisted current tab, and reattaches warnings', () => {
    const store = useEditorStore()

    store.RESTORE_BUFFERED_STATE({
      tabs: [
        makeBufferedTab('persisted-first', '/workspace/first.md', 'first.md', '# First'),
        makeBufferedTab('persisted-second', '/workspace/second.md', 'second.md', '# Second')
      ],
      currentFileId: 'persisted-second',
      restoreWarnings: [
        {
          tabId: 'persisted-first',
          pathname: '/workspace/first.md',
          msg: 'Recovered unsaved content',
          showConfirm: true,
          style: 'warn',
          exclusiveType: 'restore'
        }
      ],
      project: { rootDirectory: '/workspace' },
      layout: {
        rightColumn: 'files',
        showSideBar: true,
        showTabBar: true,
        sideBarWidth: 280
      }
    })

    const first = store.tabs[0]
    const second = store.tabs[1]
    expect(store.tabs).toHaveLength(2)
    expect(first?.id).not.toBe('persisted-first')
    expect(second?.id).not.toBe('persisted-second')
    expect(store.currentFile?.id).toBe(second?.id)
    expect(second && store.tabIdToIndex[second.id]).toBe(1)
    expect(window.DIRNAME).toBe('/workspace')
    expect(first?.notifications[0]).toMatchObject({
      msg: 'Recovered unsaved content',
      showConfirm: true,
      style: 'warn',
      exclusiveType: 'restore'
    })
  })

  it('ignores an invalid buffered restore without replacing the current editor state', () => {
    const store = useEditorStore()
    store.NEW_TAB_WITH_CONTENT({
      markdownDocument: makeDocument('current', '/workspace/current.md')
    })
    const currentId = store.currentFile?.id
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    store.RESTORE_BUFFERED_STATE({ tabs: 'not-an-array' })

    expect(store.currentFile?.id).toBe(currentId)
    expect(store.tabs).toHaveLength(1)
    expect(errorSpy).toHaveBeenCalledWith('RESTORE_BUFFERED_STATE: Invalid editor buffer state.')
    errorSpy.mockRestore()
  })
})
