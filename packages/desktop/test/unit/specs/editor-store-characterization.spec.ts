import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
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

import { useEditorStore } from '@/store/editor'

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

describe('useEditorStore document lifecycle characterization', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.DIRNAME = ''
    vi.clearAllMocks()
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
    expect(window.DIRNAME).toBe('/workspace/docs')
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
})
