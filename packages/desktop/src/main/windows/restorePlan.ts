/**
 * Planning and completion bookkeeping for the layered startup restore.
 *
 * The window restore path must make the active document available first and
 * only then hand non-active documents to a bounded background queue. Two pieces
 * of that policy are pure decisions and are kept here so they can be verified
 * without Electron:
 *
 *  1. Which restored tab is the active one (and therefore on the critical path).
 *  2. When "all restore work is finished" may be reported, which must account
 *     for the active document *and* every background task.
 *
 * Both were previously inline in `EditorWindow._restoreAllState`, where the
 * completion accounting reported `all-restore-complete` before the background
 * queue had even been given its task count.
 */

export interface RestorePlan<TTab> {
  /** The tab whose content gates the first window paint, if any. */
  activeTab: TTab | undefined
  /** Every other restored tab, refreshed by the background queue. */
  backgroundTabs: TTab[]
}

/**
 * Splits restored tabs into the active document and the background set.
 *
 * When the persisted `currentFileId` cannot be resolved (corrupt or migrated
 * state) the first tab is treated as active, matching the previous behaviour and
 * keeping the window usable instead of leaving it without a document.
 */
export const planRestore = <TTab extends { id: string }>(
  tabs: readonly TTab[],
  currentFileId: string | null | undefined
): RestorePlan<TTab> => {
  const activeIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === currentFileId)
  )

  return {
    activeTab: tabs[activeIndex],
    backgroundTabs: tabs.filter((_tab, index) => index !== activeIndex)
  }
}

export interface RestoreCompletionTracker {
  /** Records that active-document work has settled (success or isolation). */
  activeDocumentSettled(): void
  /** Declares how many background tasks must finish before completion. */
  startBackgroundTasks(count: number): void
  /** Records that one background task finished, successfully or not. */
  backgroundTaskFinished(): void
  /** Whether completion has already been reported. */
  readonly complete: boolean
  /** Number of background tasks still outstanding. */
  readonly pendingBackgroundTasks: number
}

/**
 * Reports completion exactly once, and only after the active document has
 * settled *and* no background task is outstanding.
 *
 * Callers may settle the active document and declare the background count in
 * either order; the tracker re-evaluates on every transition. Completion also
 * requires the background workload to have been declared at least once, so a
 * settled active document cannot finish the restore while the remaining tabs
 * are still unaccounted for. Tasks that are cancelled (window closed) never
 * report completion, which is intended: a cancelled run has no restore to
 * complete.
 */
export const createRestoreCompletionTracker = (
  onComplete: () => void
): RestoreCompletionTracker => {
  let activeSettled = false
  let backgroundDeclared = false
  let pendingBackgroundTasks = 0
  let complete = false

  const evaluate = (): void => {
    if (complete || !activeSettled || !backgroundDeclared || pendingBackgroundTasks > 0) return
    complete = true
    onComplete()
  }

  return {
    activeDocumentSettled(): void {
      activeSettled = true
      evaluate()
    },
    startBackgroundTasks(count: number): void {
      if (!Number.isInteger(count) || count < 0) {
        throw new RangeError('Background restore task count must be a non-negative integer.')
      }
      backgroundDeclared = true
      pendingBackgroundTasks = count
      evaluate()
    },
    backgroundTaskFinished(): void {
      pendingBackgroundTasks = Math.max(0, pendingBackgroundTasks - 1)
      evaluate()
    },
    get complete(): boolean {
      return complete
    },
    get pendingBackgroundTasks(): number {
      return pendingBackgroundTasks
    }
  }
}

export default planRestore
