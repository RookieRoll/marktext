/**
 * Coalesces the per-keystroke content commit.
 *
 * The engine's `json-change` handler used to run two full-document passes
 * synchronously — serialize the whole block tree to Markdown, then hash that
 * Markdown for the synthetic save-tracking history. Measured on a 400-block
 * document the pair costs ~5.3ms per call, and the cost tracks DOCUMENT size,
 * not edit size (see `jsonChangeDerivedCost.spec.ts`), so a fast typist pays it
 * repeatedly per keystroke.
 *
 * Nothing about a keystroke needs that work immediately:
 *
 *  - The caret is persisted separately (`PERSIST_CURSOR`), so it never lags.
 *  - Everything that READS `tab.markdown` / `tab.history` — saving, closing,
 *    switching tabs, taking a buffered-state snapshot — already routes through
 *    `flushActiveEditor()`.
 *
 * So the commit is deferred to the next frame and coalesced per tab: several
 * batched ops inside one frame serialize the document once, and the last
 * snapshot wins because later `defer()` calls overwrite earlier ones.
 *
 * This module is the policy half (no Vue, no engine, no DOM), so the coalescing,
 * flush and drop rules are directly testable.
 */

export interface PendingContentCommit {
  markdown: string
  cursor: unknown
}

export interface FrameScheduler {
  schedule: (run: () => void) => number
  cancel: (handle: number) => void
}

/** `requestAnimationFrame`-backed scheduler; falls back to a macrotask. */
export const createFrameScheduler = (): FrameScheduler => ({
  schedule(run: () => void): number {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => run())
    return setTimeout(() => run(), 0) as unknown as number
  },
  cancel(handle: number): void {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle)
    else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)
  }
})

export class ContentCommitScheduler {
  private readonly pending = new Map<string, PendingContentCommit>()
  private frame: number | null = null

  constructor(
    private readonly scheduler: FrameScheduler,
    private readonly commit: (id: string, state: PendingContentCommit) => void
  ) {}

  get size(): number {
    return this.pending.size
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  pendingFor(id: string): PendingContentCommit | undefined {
    return this.pending.get(id)
  }

  /** Queue the latest snapshot for `id`, coalescing within the same frame. */
  defer(id: string, state: PendingContentCommit): void {
    this.pending.set(id, state)
    if (this.frame !== null) return
    this.frame = this.scheduler.schedule(() => {
      this.frame = null
      for (const tabId of [...this.pending.keys()]) this.commitPending(tabId)
    })
  }

  /**
   * Commit `id` now, or every pending tab when `id` is omitted.
   *
   * Returns whether anything was committed, so callers can tell a real flush
   * from a no-op.
   */
  flush(id?: string): boolean {
    if (id === undefined) {
      if (this.pending.size === 0) return false
      for (const tabId of [...this.pending.keys()]) this.commitPending(tabId)
      return true
    }

    if (!this.pending.has(id)) return false
    this.commitPending(id)
    return true
  }

  /**
   * Discard a queued snapshot without committing it.
   *
   * Used when the tab's content is about to be replaced from disk: the queued
   * snapshot describes the PREVIOUS document, and committing it afterwards would
   * write stale Markdown over the freshly loaded file.
   */
  drop(id: string): void {
    this.pending.delete(id)
    if (this.pending.size === 0) this.cancelFrame()
  }

  /** Drop entries for tabs that no longer exist. */
  retain(liveIds: ReadonlySet<string>): void {
    for (const id of [...this.pending.keys()]) {
      if (!liveIds.has(id)) this.pending.delete(id)
    }
    if (this.pending.size === 0) this.cancelFrame()
  }

  /** Drop everything (teardown) and cancel the queued frame. */
  clear(): void {
    this.pending.clear()
    this.cancelFrame()
  }

  private commitPending(id: string): void {
    const state = this.pending.get(id)
    if (!state) return
    this.pending.delete(id)
    if (this.pending.size === 0) this.cancelFrame()
    this.commit(id, state)
  }

  private cancelFrame(): void {
    if (this.frame === null) return
    this.scheduler.cancel(this.frame)
    this.frame = null
  }
}
