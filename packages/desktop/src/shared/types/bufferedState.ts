// Buffered editor state (persisted across window close/reopen).

import type { FileEncoding, FileWordCount, LineEnding } from './files'

export const BUFFERED_STATE_VERSION = 1

export interface BufferedTabState {
  id: string
  pathname: string
  filename: string
  markdown: string
  isSaved: boolean
  encoding: FileEncoding
  lineEnding: LineEnding | string
  trimTrailingNewline: number
  adjustLineEndingOnSave: boolean
  cursor: unknown
  wordCount: FileWordCount
  muyaIndexCursor: unknown
  scrollTop: number
}

export interface BufferedRestoreWarning {
  tabId: string | null
  pathname: string
  msg: string
  showConfirm: boolean
  style: string
  exclusiveType: string
}

export interface BufferedEditorState {
  tabs: BufferedTabState[]
  currentFileId: string | null
  restoreWarnings: BufferedRestoreWarning[]
}

export interface BufferedProjectState {
  rootDirectory: string
}

export interface BufferedLayoutState {
  rightColumn: string | undefined
  showSideBar: boolean
  showTabBar: boolean
  sideBarWidth: number
}

export interface BufferedState {
  version?: number
  /** Root-level editor fields are used by the current persistence format. */
  tabs: BufferedTabState[]
  currentFileId?: string | null
  restoreWarnings?: BufferedRestoreWarning[]
  /** Legacy restore payloads nested editor fields under this property. */
  editor?: BufferedEditorState
  project?: BufferedProjectState | null
  layout?: BufferedLayoutState | null
  [key: string]: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFileEncoding = (value: unknown): value is FileEncoding =>
  isRecord(value) && typeof value.encoding === 'string' && typeof value.isBom === 'boolean'

const isFileWordCount = (value: unknown): value is FileWordCount =>
  isRecord(value) &&
  typeof value.paragraph === 'number' &&
  typeof value.word === 'number' &&
  typeof value.character === 'number' &&
  typeof value.all === 'number'

const isBufferedRestoreWarning = (value: unknown): value is BufferedRestoreWarning =>
  isRecord(value) &&
  (value.tabId === null || typeof value.tabId === 'string') &&
  typeof value.pathname === 'string' &&
  typeof value.msg === 'string' &&
  typeof value.showConfirm === 'boolean' &&
  typeof value.style === 'string' &&
  typeof value.exclusiveType === 'string'

const isBufferedTabState = (value: unknown): value is BufferedTabState => {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.pathname === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.markdown === 'string' &&
    typeof value.isSaved === 'boolean' &&
    isFileEncoding(value.encoding) &&
    typeof value.lineEnding === 'string' &&
    typeof value.trimTrailingNewline === 'number' &&
    typeof value.adjustLineEndingOnSave === 'boolean' &&
    isFileWordCount(value.wordCount) &&
    typeof value.scrollTop === 'number'
  )
}

const isBufferedProjectState = (value: unknown): value is BufferedProjectState =>
  isRecord(value) && typeof value.rootDirectory === 'string'

const isBufferedLayoutState = (value: unknown): value is BufferedLayoutState =>
  isRecord(value) &&
  (value.rightColumn === undefined || typeof value.rightColumn === 'string') &&
  typeof value.showSideBar === 'boolean' &&
  typeof value.showTabBar === 'boolean' &&
  typeof value.sideBarWidth === 'number'

/** Validate the current root-level persistence shape before writing untrusted renderer input. */
export const isBufferedState = (value: unknown): value is BufferedState => {
  if (!isRecord(value) || !Array.isArray(value.tabs)) return false
  if (!value.tabs.every(isBufferedTabState)) return false
  if (value.version !== undefined && typeof value.version !== 'number') return false
  if (
    value.currentFileId !== undefined &&
    value.currentFileId !== null &&
    typeof value.currentFileId !== 'string'
  ) {
    return false
  }
  if (
    value.restoreWarnings !== undefined &&
    (!Array.isArray(value.restoreWarnings) ||
      !value.restoreWarnings.every(isBufferedRestoreWarning))
  ) {
    return false
  }
  if (
    value.project !== undefined &&
    value.project !== null &&
    !isBufferedProjectState(value.project)
  ) {
    return false
  }
  if (value.layout !== undefined && value.layout !== null && !isBufferedLayoutState(value.layout)) {
    return false
  }
  if (
    value.editor !== undefined &&
    (!isRecord(value.editor) ||
      !Array.isArray(value.editor.tabs) ||
      !value.editor.tabs.every(isBufferedTabState))
  ) {
    return false
  }
  return true
}

/**
 * Convert current and legacy restore payloads into the root-level persistence shape.
 *
 * Older buffer files stored the editor snapshot under `editor`. The renderer still
 * knows how to consume both shapes, but the restore boundary can normalize them
 * once so invalid files fall back without partially restoring state.
 */
export const normalizeBufferedState = (value: unknown): BufferedState | null => {
  if (!isRecord(value)) return null

  if (Array.isArray(value.tabs)) {
    if (!isBufferedState(value)) return null

    const version = typeof value.version === 'number' ? value.version : BUFFERED_STATE_VERSION
    return {
      version,
      tabs: value.tabs,
      currentFileId: value.currentFileId ?? null,
      restoreWarnings: value.restoreWarnings ?? [],
      ...(value.project !== undefined ? { project: value.project } : {}),
      ...(value.layout !== undefined ? { layout: value.layout } : {})
    }
  }

  const legacyEditor = value.editor
  if (!isRecord(legacyEditor) || !Array.isArray(legacyEditor.tabs)) return null

  const version = typeof value.version === 'number' ? value.version : BUFFERED_STATE_VERSION
  if (typeof version !== 'number' || !legacyEditor.tabs.every(isBufferedTabState)) return null

  const currentFileId = legacyEditor.currentFileId
  if (
    currentFileId !== undefined &&
    currentFileId !== null &&
    typeof currentFileId !== 'string'
  ) {
    return null
  }

  const restoreWarnings = legacyEditor.restoreWarnings
  if (
    restoreWarnings !== undefined &&
    (!Array.isArray(restoreWarnings) || !restoreWarnings.every(isBufferedRestoreWarning))
  ) {
    return null
  }

  const project = value.project
  if (project !== undefined && project !== null && !isBufferedProjectState(project)) return null

  const layout = value.layout
  if (layout !== undefined && layout !== null && !isBufferedLayoutState(layout)) return null

  return {
    version,
    tabs: legacyEditor.tabs,
    currentFileId: currentFileId ?? null,
    restoreWarnings: restoreWarnings ?? [],
    ...(project !== undefined ? { project } : {}),
    ...(layout !== undefined ? { layout } : {})
  }
}
