import type {
  EditorSelectionState,
  ImageAutoPathRequest,
  KeybindingMap,
  NotificationPayload,
  ObjectTreeChangePayload,
  ObjectTreeSnapshotPayload,
  RendererErrorPayload,
  UnsavedFile,
  WindowActiveStatus
} from './ipc'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isOptionalBoolean = (record: Record<string, unknown>, key: string): boolean =>
  record[key] === undefined || typeof record[key] === 'boolean'

const isOptionalString = (record: Record<string, unknown>, key: string): boolean =>
  record[key] === undefined || typeof record[key] === 'string'

const isSaveOptions = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  if (value.encoding !== undefined) {
    const encoding = value.encoding
    if (
      typeof encoding !== 'string' &&
      (!isRecord(encoding) ||
        typeof encoding.encoding !== 'string' ||
        typeof encoding.isBom !== 'boolean')
    ) {
      return false
    }
  }
  if (value.lineEnding !== undefined && typeof value.lineEnding !== 'string') return false
  if (
    value.adjustLineEndingOnSave !== undefined &&
    typeof value.adjustLineEndingOnSave !== 'boolean'
  ) {
    return false
  }
  return value.trimTrailingNewline === undefined || typeof value.trimTrailingNewline === 'number'
}

/** Validate one unsaved document snapshot used by save/close IPC requests. */
export const isUnsavedFile = (value: unknown): value is UnsavedFile => {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.filename === 'string' &&
    (value.pathname === undefined || typeof value.pathname === 'string') &&
    typeof value.markdown === 'string' &&
    isSaveOptions(value.options) &&
    (value.defaultPath === undefined || typeof value.defaultPath === 'string')
  )
}

/** Validate save/close batches before a main-process file workflow consumes them. */
export const isUnsavedFileList = (value: unknown): value is UnsavedFile[] =>
  Array.isArray(value) && value.every(isUnsavedFile)

/** Validate the renderer request used for relative image path lookup. */
export const isImageAutoPathRequest = (value: unknown): value is ImageAutoPathRequest => {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.pathname === 'string' &&
    typeof value.src === 'string' &&
    (value.currentFile === undefined || isRecord(value.currentFile))
  )
}

/** Validate the menu selection state received from the renderer. */
export const isEditorSelectionState = (value: unknown): value is EditorSelectionState => {
  if (!isRecord(value) || !isRecord(value.affiliation)) return false
  if (!Object.values(value.affiliation).every((entry) => typeof entry === 'boolean')) {
    return false
  }

  return [
    'isTable',
    'isLooseListItem',
    'isTaskList',
    'isDisabled',
    'isMultiline',
    'isCodeFences',
    'isCodeContent',
    'hasFrontMatter'
  ].every((key) => isOptionalBoolean(value, key))
}

/** Validate the structured-clone-safe renderer error payload. */
export const isRendererErrorPayload = (value: unknown): value is RendererErrorPayload => {
  if (!isRecord(value)) return false
  return (
    typeof value.message === 'string' &&
    typeof value.name === 'string' &&
    (value.stack === undefined || typeof value.stack === 'string')
  )
}

/** Validate the keybinding map broadcast to renderer windows. */
export const isKeybindingMap = (value: unknown): value is KeybindingMap =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string')

/** Validate a window focus event. */
export const isWindowActiveStatus = (value: unknown): value is WindowActiveStatus =>
  isRecord(value) && typeof value.status === 'boolean'

/** Validate watcher updates before applying them to the project tree. */
export const isObjectTreeChangePayload = (
  value: unknown
): value is ObjectTreeChangePayload => {
  if (!isRecord(value) || !isRecord(value.change)) return false
  return (
    (value.type === 'add' ||
      value.type === 'change' ||
      value.type === 'unlink' ||
      value.type === 'addDir' ||
      value.type === 'unlinkDir') &&
    typeof value.change.pathname === 'string'
  )
}

/** Validate the batched initial directory snapshot before applying it. */
export const isObjectTreeSnapshotPayload = (
  value: unknown
): value is ObjectTreeSnapshotPayload => {
  if (!isRecord(value) || value.type !== 'snapshot' || !isRecord(value.change)) return false
  const { pathname, entries } = value.change
  return (
    typeof pathname === 'string' &&
    Array.isArray(entries) &&
    entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.pathname === 'string' &&
        typeof entry.name === 'string' &&
        typeof entry.isDirectory === 'boolean' &&
        typeof entry.isFile === 'boolean' &&
        typeof entry.isMarkdown === 'boolean'
    )
  )
}

/** Validate either a batched snapshot or an incremental project-tree update. */
export const isObjectTreeUpdatePayload = (
  value: unknown
): value is ObjectTreeChangePayload | ObjectTreeSnapshotPayload =>
  isObjectTreeSnapshotPayload(value) || isObjectTreeChangePayload(value)

/** Validate the notification options sent from main to renderer. */
export const isNotificationPayload = (value: unknown): value is NotificationPayload => {
  if (!isRecord(value)) return false
  if (
    !isOptionalString(value, 'title') ||
    !isOptionalString(value, 'message') ||
    !isOptionalBoolean(value, 'showConfirm')
  ) {
    return false
  }
  if (value.time !== undefined && typeof value.time !== 'number') return false
  return (
    value.type === undefined ||
    value.type === 'primary' ||
    value.type === 'error' ||
    value.type === 'warning' ||
    value.type === 'info'
  )
}

/** Validate the dropped file path list sent from the renderer. */
export const isWindowDropPayload = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')
