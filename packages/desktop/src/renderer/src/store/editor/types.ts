import type { IFileState } from '@shared/types/files'

/** Options forwarded to the markdown writer when a document is persisted. */
export type SaveOptions = Pick<
  IFileState,
  'encoding' | 'lineEnding' | 'adjustLineEndingOnSave' | 'trimTrailingNewline'
>

export type SaveableFile = Pick<
  IFileState,
  | 'id'
  | 'filename'
  | 'pathname'
  | 'markdown'
  | 'encoding'
  | 'lineEnding'
  | 'adjustLineEndingOnSave'
  | 'trimTrailingNewline'
>

/** The data projection used by the renderer's save and save-as IPC calls. */
export interface SaveSnapshot {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: SaveOptions
  defaultPath: string
}

/** Save-as currently uses the same document snapshot as a regular save. */
export type SaveAsPayload = SaveSnapshot

/** The data projection used when main asks the renderer to save unsaved files. */
export interface UnsavedFilePayload {
  id: string
  filename: string
  pathname: string
  markdown: string
  options: SaveOptions
  defaultPath?: string
}

export interface ProjectTreeLike {
  pathname?: string
}
