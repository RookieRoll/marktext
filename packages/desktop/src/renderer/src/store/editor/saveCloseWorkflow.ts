import { createSaveSnapshot, createUnsavedFilePayload } from './documentPersistence'
import type { SaveSnapshot, SaveableFile, UnsavedFilePayload } from './types'

export type SaveCloseDecision = 'save' | 'discard' | 'cancel'
export type SaveCloseOutcome = 'closed' | 'cancelled' | 'skipped'
type MaybePromise<T> = T | PromiseLike<T>

/**
 * The smallest renderer-facing surface needed to compose save and close flows.
 *
 * The adapter owns the store, IPC, dialogs, and buffered-state implementation;
 * this workflow only sequences callbacks and passes narrow document payloads.
 */
export interface SaveCloseEffects {
  flushActiveEditor: () => MaybePromise<void>
  readFile: (fileId: string) => SaveableFile | null
  requestSave: (snapshot: SaveSnapshot) => MaybePromise<void>
  confirmClose: (files: readonly UnsavedFilePayload[]) => MaybePromise<SaveCloseDecision>
  requestCloseTabs: (tabIds: readonly string[]) => MaybePromise<void>
  requestCloseWindow: () => MaybePromise<void>
  scheduleBufferedState: () => void
}

export interface SaveCurrentInput {
  fileId: string
  defaultPath: string
}

export interface CloseTabsInput {
  tabIds: readonly string[]
  unsavedFileIds: readonly string[]
  defaultPath: string
}

export interface CloseWindowInput {
  unsavedFileIds: readonly string[]
  defaultPath: string
}

export interface SaveCurrentResult {
  outcome: 'saved' | 'skipped'
  snapshot?: SaveSnapshot
}

export interface CloseWorkflowResult {
  outcome: SaveCloseOutcome
}

interface PreparedUnsavedFile {
  file: SaveableFile
  payload: UnsavedFilePayload
}

/**
 * Build the confirmation payloads without exposing any store-shaped object.
 */
export const buildUnsavedFilePayloads = (
  files: readonly SaveableFile[],
  defaultPath?: string
): UnsavedFilePayload[] => files.map((file) => createUnsavedFilePayload(file, defaultPath))

const uniqueIds = (ids: readonly string[]): string[] => [...new Set(ids)]

/**
 * Compose the save/close workflow from narrow effects.
 *
 * Ordering guarantees:
 * - save: flush -> read -> build snapshot -> request save -> schedule buffer
 * - close tabs: flush/read/confirm -> save (when selected) -> close -> schedule buffer
 * - close window: schedule buffer -> flush/read/confirm -> save (when selected) -> close
 *
 * A cancelled confirmation never requests a close and never schedules a second
 * buffered-state write. Save failures propagate and therefore also prevent the
 * close effect from running.
 */
export const createSaveCloseWorkflow = (effects: SaveCloseEffects) => {
  const prepareUnsavedFiles = (
    fileIds: readonly string[],
    defaultPath: string
  ): PreparedUnsavedFile[] =>
    uniqueIds(fileIds).flatMap((fileId) => {
      const file = effects.readFile(fileId)
      return file ? [{ file, payload: createUnsavedFilePayload(file, defaultPath) }] : []
    })

  const savePreparedFiles = async(
    files: readonly PreparedUnsavedFile[],
    defaultPath: string
  ): Promise<void> => {
    for (const { file } of files) {
      await effects.requestSave(createSaveSnapshot(file, defaultPath))
    }
  }

  const saveCurrent = async({
    fileId,
    defaultPath
  }: SaveCurrentInput): Promise<SaveCurrentResult> => {
    await effects.flushActiveEditor()
    const file = effects.readFile(fileId)
    if (!file) return { outcome: 'skipped' }

    const snapshot = createSaveSnapshot(file, defaultPath)
    await effects.requestSave(snapshot)
    effects.scheduleBufferedState()
    return { outcome: 'saved', snapshot }
  }

  const closeTabs = async({
    tabIds,
    unsavedFileIds,
    defaultPath
  }: CloseTabsInput): Promise<CloseWorkflowResult> => {
    const idsToClose = uniqueIds(tabIds)
    if (idsToClose.length === 0) return { outcome: 'skipped' }

    const hasUnsavedCandidates = uniqueIds(unsavedFileIds).length > 0
    const prepared = hasUnsavedCandidates
      ? (await effects.flushActiveEditor(), prepareUnsavedFiles(unsavedFileIds, defaultPath))
      : []

    if (prepared.length > 0) {
      const decision = await effects.confirmClose(prepared.map(({ payload }) => payload))
      if (decision === 'cancel') return { outcome: 'cancelled' }
      if (decision === 'save') await savePreparedFiles(prepared, defaultPath)
    }

    await effects.requestCloseTabs(idsToClose)
    effects.scheduleBufferedState()
    return { outcome: 'closed' }
  }

  const closeWindow = async({
    unsavedFileIds,
    defaultPath
  }: CloseWindowInput): Promise<CloseWorkflowResult> => {
    // Persist the latest buffered snapshot before asking the host to close. A
    // cancelled dialog intentionally leaves this first scheduling request intact.
    effects.scheduleBufferedState()

    const hasUnsavedCandidates = uniqueIds(unsavedFileIds).length > 0
    const prepared = hasUnsavedCandidates
      ? (await effects.flushActiveEditor(), prepareUnsavedFiles(unsavedFileIds, defaultPath))
      : []

    if (prepared.length > 0) {
      const decision = await effects.confirmClose(prepared.map(({ payload }) => payload))
      if (decision === 'cancel') return { outcome: 'cancelled' }
      if (decision === 'save') await savePreparedFiles(prepared, defaultPath)
    }

    await effects.requestCloseWindow()
    return { outcome: 'closed' }
  }

  return { saveCurrent, closeTabs, closeWindow }
}
