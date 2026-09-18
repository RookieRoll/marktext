/**
 * Rollback switches for the editor-latency optimizations.
 *
 * This change moves work off three user-visible critical paths (startup restore,
 * tab switching, first-frame derived work). Each slice is independently
 * switchable back to its previous synchronous behaviour so a regression can be
 * narrowed down — or reverted in production — without losing the measurement
 * layer that diagnosed it.
 *
 * Contract: turning a slice OFF restores the previous behaviour but MUST NOT
 * disable performance observation. Milestones and counters are emitted
 * regardless of these flags; a report from a rolled-back run is still
 * comparable with a baseline.
 *
 * The flag is read from the same environment variable in both processes
 * (`MARKTEXT_PERF_ROLLBACK`) so one launch can roll back a slice end to end.
 */

export const PERFORMANCE_ROLLBACK_SLICES = [
  /**
   * 2.x startup restore layering: active-document-first restore plus the bounded
   * background queue. OFF restores the original "await every restored tab, then
   * send state" path.
   */
  'restore-layering',
  /** 4.x parsed-state reuse across tab switches. OFF always re-parses. */
  'tab-state-cache',
  /** 4.5 deferred engine-history restore. OFF restores the stack synchronously. */
  'deferred-history',
  /** 1.2 / 5.2 deferred TOC traversal off the first-frame path. OFF runs it inline. */
  'deferred-toc',
  /**
   * 5.2 deferred content commit (full Markdown serialization + synthetic-history
   * hash). OFF commits every `json-change` synchronously, exactly as before.
   */
  'deferred-content-commit'
] as const

export type PerformanceRollbackSlice = (typeof PERFORMANCE_ROLLBACK_SLICES)[number]

/** Environment variable both processes read. Comma-separated slice names. */
export const PERFORMANCE_ROLLBACK_ENV = 'MARKTEXT_PERF_ROLLBACK'

/**
 * Parse the rollback list. Unknown names are ignored rather than rejected: a
 * typo must not crash startup, and silently ignoring it keeps the default
 * (optimized) behaviour in place.
 */
export const parsePerformanceRollbackSlices = (value: unknown): Set<PerformanceRollbackSlice> => {
  const requested = new Set<PerformanceRollbackSlice>()
  if (typeof value !== 'string' || value.trim() === '') return requested

  const known = new Set<string>(PERFORMANCE_ROLLBACK_SLICES)
  for (const entry of value.split(',')) {
    const name = entry.trim().toLowerCase()
    if (known.has(name)) requested.add(name as PerformanceRollbackSlice)
  }
  return requested
}

export interface PerformanceRollbackState {
  requested: Set<PerformanceRollbackSlice>
  /** True when `slice` may use its optimized path. */
  enabled: (slice: PerformanceRollbackSlice) => boolean
  /** Slice names that were rolled back, sorted, for logging/diagnostics. */
  readonly rolledBack: PerformanceRollbackSlice[]
}

export const createPerformanceRollbackState = (
  value: unknown = process.env?.[PERFORMANCE_ROLLBACK_ENV]
): PerformanceRollbackState => {
  const requested = parsePerformanceRollbackSlices(value)
  return {
    requested,
    enabled: (slice) => !requested.has(slice),
    rolledBack: PERFORMANCE_ROLLBACK_SLICES.filter((slice) => requested.has(slice))
  }
}
