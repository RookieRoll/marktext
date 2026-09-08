import { describe, expect, it } from 'vitest'
import { isRipgrepRequest } from '@shared/types/ripgrep'
import { isUploadRequest } from '@shared/types/uploader'
import { isUserKeybindings } from '@shared/types/keybindings'
import { isBufferedState } from '@shared/types/bufferedState'
import {
  isEditorSelectionState,
  isImageAutoPathRequest,
  isKeybindingMap,
  isNotificationPayload,
  isObjectTreeChangePayload,
  isRendererErrorPayload,
  isUnsavedFileList,
  isWindowActiveStatus,
  isWindowDropPayload
} from '@shared/types/ipcValidators'

describe('IPC domain contracts', () => {
  it('accepts a valid ripgrep request and rejects malformed input', () => {
    expect(
      isRipgrepRequest({
        searchId: 'rg-1',
        mode: 'text',
        directories: ['/notes'],
        pattern: 'todo',
        options: { isCaseSensitive: true, inclusions: ['*.md'] }
      })
    ).toBe(true)

    expect(
      isRipgrepRequest({
        searchId: '',
        mode: 'text',
        directories: ['/notes'],
        pattern: 'todo',
        options: {}
      })
    ).toBe(false)
    expect(isRipgrepRequest(null)).toBe(false)
  })

  it('accepts both serializable image upload variants', () => {
    expect(
      isUploadRequest({
        pathname: '/notes/readme.md',
        image: './image.png',
        isPath: true,
        preferences: { currentUploader: 'picgo', cliScript: '' }
      })
    ).toBe(true)

    expect(
      isUploadRequest({
        pathname: '/notes/readme.md',
        image: { data: new Uint8Array([0, 255]), name: 'image.png' },
        isPath: false,
        preferences: { currentUploader: 'picgo', cliScript: '' }
      })
    ).toBe(true)
  })

  it('validates the buffered-state persistence shape', () => {
    expect(
      isBufferedState({
        version: 1,
        tabs: [
          {
            id: 'tab-1',
            pathname: '',
            filename: 'Untitled',
            markdown: '',
            isSaved: true,
            encoding: { encoding: 'utf-8', isBom: false },
            lineEnding: 'lf',
            trimTrailingNewline: 0,
            adjustLineEndingOnSave: false,
            cursor: null,
            wordCount: { paragraph: 0, word: 0, character: 0, all: 0 },
            muyaIndexCursor: null,
            scrollTop: 0
          }
        ],
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
    ).toBe(true)
    expect(isBufferedState({ version: '1', tabs: [] })).toBe(false)
    expect(isBufferedState({ version: 1, tabs: 'not-an-array' })).toBe(false)
  })
  it('validates keybindings as structured-clone-safe entries', () => {
    expect(isUserKeybindings(new Map([['file.save', 'Ctrl+S']]))).toBe(true)
    expect(isUserKeybindings([['file.save', 'Ctrl+S']])).toBe(true)
    expect(isUserKeybindings({ 'file.save': 'Ctrl+S' })).toBe(false)
    expect(isUserKeybindings([['file.save', 42] as never])).toBe(false)
  })

  it('rejects upload requests with an invalid discriminant or byte payload', () => {
    expect(
      isUploadRequest({
        pathname: '/notes/readme.md',
        image: './image.png',
        isPath: false,
        preferences: { currentUploader: 'picgo', cliScript: '' }
      })
    ).toBe(false)

    expect(
      isUploadRequest({
        pathname: '/notes/readme.md',
        image: { data: [0, 256], name: 'image.png' },
        isPath: false,
        preferences: { currentUploader: 'picgo', cliScript: '' }
      })
    ).toBe(false)
  })

  it('validates typed renderer requests and menu state payloads', () => {
    expect(
      isImageAutoPathRequest({
        id: 'image-1',
        pathname: '/notes/readme.md',
        src: './image.png',
        currentFile: { id: 'tab-1' }
      })
    ).toBe(true)
    expect(isImageAutoPathRequest({ id: 'image-1', pathname: '/notes/readme.md' })).toBe(false)

    expect(
      isEditorSelectionState({
        affiliation: { paragraph: true },
        isDisabled: false,
        isMultiline: true
      })
    ).toBe(true)
    expect(isEditorSelectionState({ affiliation: { paragraph: 'yes' } })).toBe(false)
  })

  it('validates typed event payloads at the IPC boundary', () => {
    expect(isRendererErrorPayload({ name: 'Error', message: 'boom', stack: 'stack' })).toBe(true)
    expect(isRendererErrorPayload({ name: 'Error', message: 42 })).toBe(false)

    expect(isKeybindingMap({ 'file.save': 'Ctrl+S' })).toBe(true)
    expect(isKeybindingMap({ 'file.save': 42 })).toBe(false)

    expect(isWindowActiveStatus({ status: true })).toBe(true)
    expect(isWindowActiveStatus(true)).toBe(false)

    expect(
      isObjectTreeChangePayload({ type: 'change', change: { pathname: '/notes/readme.md' } })
    ).toBe(true)
    expect(isObjectTreeChangePayload({ type: 'change', change: {} })).toBe(false)

    expect(isNotificationPayload({ title: 'Notice', type: 'warning' })).toBe(true)
    expect(isNotificationPayload({ type: 'unsupported' })).toBe(false)

    expect(isWindowDropPayload(['/notes/readme.md'])).toBe(true)
    expect(isWindowDropPayload(['/notes/readme.md', 42])).toBe(false)

    expect(
      isUnsavedFileList([
        {
          id: 'tab-1',
          filename: 'readme.md',
          pathname: '/notes/readme.md',
          markdown: '# Notes',
          options: { encoding: 'utf-8', lineEnding: 'lf' },
          defaultPath: '/notes'
        }
      ])
    ).toBe(true)
    expect(
      isUnsavedFileList([
        {
          id: 'tab-1',
          filename: 'readme.md',
          markdown: '# Notes',
          options: { encoding: { encoding: 'utf-8', isBom: 'no' } }
        }
      ])
    ).toBe(false)  })
})
