import type {
  PerformanceCounters,
  PerformanceMilestone,
  PerformanceResourceMetrics,
  PerformanceSamplePayload
} from '@shared/performance'
import { createPerformanceRollbackState } from '@shared/performanceRollback'
import type { PerformanceRollbackSlice } from '@shared/performanceRollback'
import { getIpcRenderer, getProcessBridge, hasElectronBridge } from './electron'

interface RendererMemoryInfo {
  usedJSHeapSize?: number
  totalJSHeapSize?: number
  jsHeapSizeLimit?: number
}

const isPerformanceTesting = (): boolean => {
  if (!hasElectronBridge()) return false
  return getProcessBridge().env.PERF_TESTING === 'true'
}

let rollbackState: ReturnType<typeof createPerformanceRollbackState> | null = null

/**
 * Whether a performance slice may use its optimized path in this renderer.
 *
 * Reads the same `MARKTEXT_PERF_ROLLBACK` value Main does (surfaced through the
 * boot-info env allowlist). Rollback affects behaviour only — milestone and
 * counter emission is never gated on it, so a rolled-back run stays measurable.
 */
export const isPerformanceSliceEnabled = (slice: PerformanceRollbackSlice): boolean => {
  if (!hasElectronBridge()) return true
  rollbackState ??= createPerformanceRollbackState(getProcessBridge().env.MARKTEXT_PERF_ROLLBACK)
  return rollbackState.enabled(slice)
}

const getRendererMemory = (): RendererMemoryInfo | undefined => {
  if (typeof performance === 'undefined') return undefined
  const memory = (performance as Performance & { memory?: RendererMemoryInfo }).memory
  if (!memory) return undefined
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit
  }
}

const getResourceMetrics = (): PerformanceResourceMetrics => {
  if (typeof performance === 'undefined') return {}

  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
  let initialJsBytes = 0
  let initialCssBytes = 0

  for (const resource of resources) {
    const url = resource.name.split('?')[0]?.toLowerCase() ?? ''
    const bytes = resource.transferSize || resource.encodedBodySize || resource.decodedBodySize || 0
    if (!Number.isFinite(bytes) || bytes <= 0) continue
    if (url.endsWith('.js')) initialJsBytes += bytes
    if (url.endsWith('.css')) initialCssBytes += bytes
  }

  return {
    initialJsBytes: initialJsBytes || undefined,
    initialCssBytes: initialCssBytes || undefined
  }
}

export const markRendererPerformance = (
  milestone: PerformanceMilestone,
  payload?: PerformanceSamplePayload
): void => {
  if (!isPerformanceTesting()) return
  getIpcRenderer().send('mt::performance-mark', milestone, payload)
}

export const sampleRendererPerformance = (counters?: PerformanceCounters): void => {
  if (!isPerformanceTesting()) return

  const memory = getRendererMemory()
  const payload: PerformanceSamplePayload = {
    resources: getResourceMetrics(),
    counters
  }

  if (memory) {
    payload.memory = {
      heapUsedBytes: memory.usedJSHeapSize,
      heapTotalBytes: memory.totalJSHeapSize,
    }
  }

  markRendererPerformance('dom-ready', payload)
}