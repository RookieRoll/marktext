import type {
  ProjectTreeLike,
  SaveAsPayload,
  SaveOptions,
  SaveSnapshot,
  SaveableFile,
  UnsavedFilePayload
} from './types'

export const getSaveOptions = (file: SaveableFile): SaveOptions => {
  const { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline } = file
  return { encoding, lineEnding, adjustLineEndingOnSave, trimTrailingNewline }
}

export const getDefaultPath = (projectTree: ProjectTreeLike | null | undefined): string =>
  projectTree?.pathname ?? ''

export const createSaveSnapshot = (file: SaveableFile, defaultPath: string): SaveSnapshot => {
  const { id, filename, pathname, markdown } = file
  return {
    id,
    filename,
    pathname,
    markdown,
    options: getSaveOptions(file),
    defaultPath
  }
}

export const createSaveAsPayload = (file: SaveableFile, defaultPath: string): SaveAsPayload =>
  createSaveSnapshot(file, defaultPath)

export const createUnsavedFilePayload = (
  file: SaveableFile,
  defaultPath?: string
): UnsavedFilePayload => {
  const { id, filename, pathname, markdown } = file
  const payload: UnsavedFilePayload = {
    id,
    filename,
    pathname,
    markdown,
    options: getSaveOptions(file)
  }

  if (defaultPath !== undefined) {
    payload.defaultPath = defaultPath
  }

  return payload
}
