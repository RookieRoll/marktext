import { describe, expect, it } from 'vitest'
import {
  createSaveAsPayload,
  createSaveSnapshot,
  createUnsavedFilePayload,
  getDefaultPath,
  getSaveOptions
} from '@/store/editor/documentPersistence'
import type { SaveableFile } from '@/store/editor/types'

const makeFile = (): SaveableFile => ({
  id: 'tab-1',
  filename: 'note.md',
  pathname: '/workspace/note.md',
  markdown: '# Note',
  encoding: { encoding: 'utf8', isBom: false },
  lineEnding: 'lf',
  adjustLineEndingOnSave: false,
  trimTrailingNewline: 3
})

describe('editor document persistence projections', () => {
  it('projects only the markdown writer options from a file state', () => {
    const file = makeFile()

    expect(getSaveOptions(file)).toEqual({
      encoding: { encoding: 'utf8', isBom: false },
      lineEnding: 'lf',
      adjustLineEndingOnSave: false,
      trimTrailingNewline: 3
    })
  })

  it('builds save and save-as snapshots with the same stable document shape', () => {
    const file = makeFile()

    expect(createSaveSnapshot(file, '/workspace')).toEqual({
      id: 'tab-1',
      filename: 'note.md',
      pathname: '/workspace/note.md',
      markdown: '# Note',
      options: getSaveOptions(file),
      defaultPath: '/workspace'
    })
    expect(createSaveAsPayload(file, '/workspace')).toEqual(createSaveSnapshot(file, '/workspace'))
  })

  it('builds an unsaved-file payload and keeps defaultPath optional', () => {
    const file = makeFile()

    expect(createUnsavedFilePayload(file, '/workspace')).toMatchObject({
      id: 'tab-1',
      filename: 'note.md',
      pathname: '/workspace/note.md',
      markdown: '# Note',
      options: getSaveOptions(file),
      defaultPath: '/workspace'
    })
    expect(createUnsavedFilePayload(file)).not.toHaveProperty('defaultPath')
  })

  it('normalizes a missing project tree to an empty default path', () => {
    expect(getDefaultPath({ pathname: '/workspace' })).toBe('/workspace')
    expect(getDefaultPath({})).toBe('')
    expect(getDefaultPath(null)).toBe('')
  })
})
