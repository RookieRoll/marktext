import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The project store reads preload bridges at runtime. Stub them before the
// hoisted imports run so the store graph can load under jsdom.
vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: {
        sep: string
        normalize: (p: string) => string
        basename: (p: string) => string
        dirname: (p: string) => string
        relative: (from: string, to: string) => string
        isAbsolute: (p: string) => boolean
      }
      fileUtils?: {
        hasMarkdownExtension: (n: string) => boolean
        pathExists: (p: string) => Promise<boolean>
        isSamePathSync: (a: string, b: string) => boolean
      }
      electron?: {
        ipcRenderer: { send: (...a: unknown[]) => void; on: (...a: unknown[]) => void }
      }
    }
  }
  const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  w.window ??= {}
  w.window.path ??= {
    sep: '/',
    normalize,
    basename: (p: string) => normalize(p).split('/').pop() ?? '',
    dirname: (p: string) => {
      const parts = normalize(p).split('/')
      parts.pop()
      return parts.join('/') || '/'
    },
    relative: (from: string, to: string) => {
      const fromParts = normalize(from).split('/').filter(Boolean)
      const toParts = normalize(to).split('/').filter(Boolean)
      let shared = 0
      while (shared < fromParts.length && fromParts[shared] === toParts[shared]) shared++
      return [
        ...Array.from({ length: fromParts.length - shared }, () => '..'),
        ...toParts.slice(shared)
      ].join('/')
    },
    isAbsolute: (p: string) => p.startsWith('/')
  }
  w.window.fileUtils ??= {
    hasMarkdownExtension: (n: string) => n.endsWith('.md'),
    pathExists: () => Promise.resolve(false),
    isSamePathSync: (a, b) => normalize(a) === normalize(b)
  }
  w.window.electron ??= { ipcRenderer: { send: vi.fn(), on: vi.fn() } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))

vi.mock('@/util/fileSystem', async(orig) => {
  const actual = await orig<typeof fileSystemModule>()
  return { ...actual, create: vi.fn(() => Promise.resolve()) }
})

import type * as fileSystemModule from '@/util/fileSystem'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { getIpcRenderer } from '@/platform/electron'
import { useLayoutStore } from '@/store/layout'
import { create } from '@/util/fileSystem'

const createdPath = '/docs/fresh.md'

describe('new file first content load', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('marks the created path so the first watcher add seeds editor content', async() => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.OPEN_PROJECT('/docs')
    project.createCache = { dirname: '/docs', type: 'file' }

    await project.CREATE_FILE_DIRECTORY('fresh')

    expect(create).toHaveBeenCalledWith(createdPath, 'file')
    // The created path is remembered until the directory watcher reports it.
    expect(project.newFileNameCache).toBe(createdPath)

    const updateSpy = vi.spyOn(editor, 'UPDATE_CURRENT_FILE').mockImplementation(() => {})
    project.pendingTreeEvents.push({
      type: 'add',
      change: {
        pathname: createdPath,
        name: 'fresh.md',
        isDirectory: false,
        isFile: true,
        isMarkdown: true,
        data: { markdown: '# fresh', pathname: createdPath, filename: 'fresh.md' }
      } as never
    })
    project.OPEN_PROJECT('/docs')

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(project.newFileNameCache).toBe('')
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      markdown: '# fresh',
      pathname: createdPath
    })
  })

  it('keeps on-demand open-file loading intact for files discovered without content', async() => {
    const editor = useEditorStore()
    editor.tabs = []
    editor.OPEN_OR_SWITCH_FILE(createdPath)

    // The tree snapshot carries metadata only; selecting a row still asks Main
    // for the document, so encoding / newline handling stays on the existing
    // loadMarkdownFile path.
    expect(getIpcRenderer().send).toHaveBeenCalledWith('mt::open-file', createdPath, {})
  })

  it('does not reseed editor content for an unrelated later add', () => {
    const project = useProjectStore()
    const editor = useEditorStore()
    project.OPEN_PROJECT('/docs')
    project.newFileNameCache = createdPath

    const updateSpy = vi.spyOn(editor, 'UPDATE_CURRENT_FILE').mockImplementation(() => {})
    project.pendingTreeEvents.push({
      type: 'add',
      change: {
        pathname: '/docs/other.md',
        name: 'other.md',
        isDirectory: false,
        isFile: true,
        isMarkdown: true,
        data: { markdown: '# other' }
      } as never
    })
    project.OPEN_PROJECT('/docs')

    expect(updateSpy).not.toHaveBeenCalled()
    // The unrelated add must not consume the pending first-load marker.
    expect(project.newFileNameCache).toBe(createdPath)
  })
})

describe('sidebar width persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('clamps a drag past the minimum and persists the committed width', () => {
    const layout = useLayoutStore()

    layout.SET_SIDE_BAR_WIDTH(120)

    expect(layout.sideBarWidth).toBe(220)
    expect(localStorage.getItem('side-bar-width')).toBe('220')
  })

  it('restores a saved width through buffered state instead of falling back', () => {
    const layout = useLayoutStore()

    // Remounting the sidebar restores the width captured in buffered state.
    layout.RESTORE_BUFFERED_STATE({ sideBarWidth: 340 })

    expect(layout.sideBarWidth).toBe(340)
    expect(localStorage.getItem('side-bar-width')).toBe('340')
    expect(layout.CREATE_BUFFERED_STATE()?.sideBarWidth).toBe(340)
  })

  it('keeps the minimum width through buffered-state restore', () => {
    const layout = useLayoutStore()

    layout.RESTORE_BUFFERED_STATE({ sideBarWidth: 100 })

    expect(layout.sideBarWidth).toBe(220)
    expect(localStorage.getItem('side-bar-width')).toBe('220')
  })
})
