/**
 * Defers a tab's persisted engine history until the engine is idle.
 *
 * Restoring a tab used to deep-clone the whole serialized undo/redo stack inside
 * the tab-switch handler, on the first-frame path: `History.setHistory` maps
 * every entry through `structuredClone`, and the stacks only grow with editing
 * history, so switching between two long-edited documents paid a cost that had
 * nothing to do with what the user sees.
 *
 * Switching back must still restore undo/redo, so instead of dropping the work
 * this defers it:
 *
 *  - the persisted stack is handed to the engine once the switch has painted,
 *  - keystrokes typed in between are preserved because the engine *adopts* the
 *    persisted entries underneath the live ones rather than replacing them,
 *  - undo/redo (and leaving the tab) flush immediately, so the user can never
 *    observe a partially restored stack.
 *
 * This module is the policy half and has no engine or DOM dependency, so the
 * defer/flush/cancel rules can be tested directly.
 */

export interface HistoryRestoreScheduler {
  /** Runs `run` once the renderer is idle. Cancels any previous request. */
  schedule: (run: () => void) => void
  /** Cancels a scheduled run that has not fired yet. */
  cancel: () => void
}

/**
 * Prefer an idle callback so the clone happens after the switch has painted, and
 * fall back to a macrotask where `requestIdleCallback` is unavailable (jsdom,
 * older runtimes). The timeout keeps the restore from being starved on a busy
 * renderer.
 */
export const createIdleHistoryScheduler = (timeoutMs = 200): HistoryRestoreScheduler => {
  let idleHandle: number | null = null
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  const clear = (): void => {
    const w = globalThis as unknown as {
      cancelIdleCallback?: (handle: number) => void
    }
    if (idleHandle !== null && typeof w.cancelIdleCallback === 'function') {
      w.cancelIdleCallback(idleHandle)
    }
    idleHandle = null
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle)
      timeoutHandle = null
    }
  }

  return {
    schedule(run: () => void): void {
      clear()
      const w = globalThis as unknown as {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
      }
      if (typeof w.requestIdleCallback === 'function') {
        idleHandle = w.requestIdleCallback(
          () => {
            idleHandle = null
            run()
          },
          { timeout: timeoutMs }
        )
        return
      }
      timeoutHandle = setTimeout(() => {
        timeoutHandle = null
        run()
      }, 0)
    },
    cancel: clear
  }
}

export class DeferredHistoryRestore {
  private pending: { tabId: string; history: unknown } | null = null

  constructor(
    private readonly scheduler: HistoryRestoreScheduler,
    /** The tab the engine is currently rendering, or `null`. */
    private readonly activeTabId: () => string | null,
    /** Hands the persisted stack to the engine (adopt, never replace). */
    private readonly apply: (tabId: string, history: unknown) => void
  ) {}

  get hasPending(): boolean {
    return this.pending !== null
  }

  get pendingTabId(): string | null {
    return this.pending?.tabId ?? null
  }

  /**
   * Queue `history` for `tabId` and apply it once the renderer is idle.
   *
   * A restore queued for a tab the user has already left is applied straight
   * away: there is no first-frame cost left to protect, and dropping it would
   * lose the tab's undo entries.
   */
  defer(tabId: string, history: unknown): void {
    this.scheduler.cancel()
    this.pending = { tabId, history }

    if (this.activeTabId() !== tabId) {
      this.flush()
      return
    }

    this.scheduler.schedule(() => {
      // A queued restore must never touch a document it does not belong to —
      // `adoptHistory` merges into whatever stack is live, so applying tab A's
      // entries while tab B renders would pollute B. The entry stays in the
      // caller's per-tab map, so the next activation defers it again.
      if (this.pending?.tabId !== tabId || this.activeTabId() !== tabId) {
        this.cancel(tabId)
        return
      }
      this.flush()
    })
  }

  /**
   * Apply the queued restore now.
   *
   * Called when the stack is about to be read (undo/redo), when the tab is about
   * to be left (so capturing the outgoing history sees the merged stack), and by
   * the idle callback. Returns whether anything was applied.
   */
  flush(): boolean {
    this.scheduler.cancel()
    const pending = this.pending
    if (!pending) return false
    this.pending = null
    this.apply(pending.tabId, pending.history)
    return true
  }

  /** Drop the queued restore without applying it (teardown, closed tab). */
  cancel(tabId?: string): void {
    if (tabId !== undefined && this.pending?.tabId !== tabId) return
    this.scheduler.cancel()
    this.pending = null
  }

  /**
   * Drop the queued restore when its tab is no longer live.
   *
   * Needed because a pending restore for a CLOSED tab may not match the tab the
   * caller is currently cancelling for, and closing a tab does not otherwise
   * touch the queue — the entry would sit there until an unrelated switch
   * flushed it against a document that no longer exists.
   */
  cancelOrphaned(liveTabIds: ReadonlySet<string>): void {
    if (this.pending && !liveTabIds.has(this.pending.tabId)) this.cancel()
  }
}
