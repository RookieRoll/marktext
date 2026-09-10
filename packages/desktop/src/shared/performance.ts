export const PERFORMANCE_REPORT_VERSION = 1 as const

export const PERFORMANCE_SCENARIOS = [
  'blank-editor',
  'cold-editor',
  'warm-editor',
  'settings-window',
  'restore-tabs',
  'multi-window',
  'large-document',
  'unknown'
] as const

export type PerformanceScenario = (typeof PERFORMANCE_SCENARIOS)[number]

export const PERFORMANCE_MILESTONES = [
  'main-process-start',
  'main-init',
  'app-ready',
  'first-window-created',
  'first-document-requested',
  'preload-ready',
  'renderer-start',
  'dom-ready',
  'first-paint',
  'editor-interactive',
  'first-document-loaded'
] as const

export type PerformanceMilestone = (typeof PERFORMANCE_MILESTONES)[number]

export interface PerformanceBuildIdentity {
  id: string
  version: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
}

export interface PerformanceResourceMetrics {
  initialJsBytes?: number
  initialCssBytes?: number
  dynamicChunkBytes?: number
  dynamicChunkLoadMs?: number
}

export interface PerformanceMemorySample {
  atMs: number
  process: 'main' | 'renderer' | 'preload'
  rssBytes?: number
  heapUsedBytes?: number
  heapTotalBytes?: number
  externalBytes?: number
}

export interface PerformanceCounters {
  windows?: number
  tabs?: number
}

export interface PerformanceSamplePayload {
  memory?: Omit<PerformanceMemorySample, 'atMs' | 'process'>
  resources?: PerformanceResourceMetrics
  counters?: PerformanceCounters
}

const normalizeMetric = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined

const normalizeMemory = (value: unknown): PerformanceSamplePayload['memory'] | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const memory: NonNullable<PerformanceSamplePayload['memory']> = {}
  const heapUsedBytes = normalizeMetric(source.heapUsedBytes)
  const heapTotalBytes = normalizeMetric(source.heapTotalBytes)
  const externalBytes = normalizeMetric(source.externalBytes)
  if (heapUsedBytes !== undefined) memory.heapUsedBytes = heapUsedBytes
  if (heapTotalBytes !== undefined) memory.heapTotalBytes = heapTotalBytes
  if (externalBytes !== undefined) memory.externalBytes = externalBytes
  return Object.keys(memory).length ? memory : undefined
}

const normalizeResources = (value: unknown): PerformanceResourceMetrics | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const resources: PerformanceResourceMetrics = {}
  for (const key of [
    'initialJsBytes',
    'initialCssBytes',
    'dynamicChunkBytes',
    'dynamicChunkLoadMs'
  ] as const) {
    const metric = normalizeMetric(source[key])
    if (metric !== undefined) resources[key] = metric
  }
  return Object.keys(resources).length ? resources : undefined
}

const normalizeCounters = (value: unknown): PerformanceCounters | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const counters: PerformanceCounters = {}
  for (const key of ['windows', 'tabs'] as const) {
    const metric = normalizeMetric(source[key])
    if (metric !== undefined) counters[key] = metric
  }
  return Object.keys(counters).length ? counters : undefined
}

/** Keep renderer-provided telemetry numeric and anonymous before it enters a report. */
export const normalizePerformanceSamplePayload = (value: unknown): PerformanceSamplePayload => {
  if (!value || typeof value !== 'object') return {}
  const source = value as Record<string, unknown>
  return {
    memory: normalizeMemory(source.memory),
    resources: normalizeResources(source.resources),
    counters: normalizeCounters(source.counters)
  }
}

export interface PerformanceReport {
  version: typeof PERFORMANCE_REPORT_VERSION
  runId: string
  scenario: PerformanceScenario
  startedAt: string
  build: PerformanceBuildIdentity
  milestones: Partial<Record<PerformanceMilestone, number>>
  resources: PerformanceResourceMetrics
  memory: PerformanceMemorySample[]
  counters: PerformanceCounters
}

export interface PerformanceReportInput {
  runId?: string
  scenario?: unknown
  startedAt?: string
  build?: Partial<PerformanceBuildIdentity>
  milestones?: Partial<Record<PerformanceMilestone, number>>
  resources?: PerformanceResourceMetrics
  memory?: PerformanceMemorySample[]
  counters?: PerformanceCounters
}

const DEFAULT_BUILD: PerformanceBuildIdentity = {
  id: 'unknown',
  version: 'unknown',
  platform: 'unknown',
  arch: 'unknown',
  electron: 'unknown',
  chrome: 'unknown',
  node: 'unknown'
}

export const normalizePerformanceScenario = (value: unknown): PerformanceScenario => {
  if (typeof value !== 'string') return 'blank-editor'

  const scenario = value.trim() as PerformanceScenario
  return PERFORMANCE_SCENARIOS.includes(scenario) ? scenario : 'unknown'
}

export const createPerformanceRunId = (now: number = Date.now()): string =>
  `run-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const createPerformanceReport = ({
  runId = createPerformanceRunId(),
  scenario,
  startedAt = new Date().toISOString(),
  build,
  milestones,
  resources,
  memory,
  counters
}: PerformanceReportInput = {}): PerformanceReport => ({
  version: PERFORMANCE_REPORT_VERSION,
  runId,
  scenario: normalizePerformanceScenario(scenario),
  startedAt,
  build: { ...DEFAULT_BUILD, ...build },
  milestones: { ...milestones },
  resources: { ...resources },
  memory: [...(memory ?? [])],
  counters: { ...counters }
})

export type PerformanceClock = () => number

const defaultClock: PerformanceClock = (): number => performance.now()

/**
 * Records first-seen milestone times relative to one process-local clock origin.
 * Cross-process milestones are recorded when their IPC event arrives in Main;
 * the report remains comparable without exposing process paths or data.
 */
export class PerformanceTrace {
  private readonly originMs: number
  private readonly startedAt: string
  private readonly milestones: Partial<Record<PerformanceMilestone, number>> = {}

  constructor(
    private readonly clock: PerformanceClock = defaultClock,
    startedAt?: string
  ) {
    this.originMs = clock()
    this.startedAt = startedAt ?? new Date().toISOString()
  }

  mark(milestone: PerformanceMilestone, atMs: number = this.clock()): void {
    if (this.milestones[milestone] !== undefined) return
    this.milestones[milestone] = this.elapsedMs(atMs)
  }

  elapsedMs(atMs: number = this.clock()): number {
    return Math.max(0, Math.round(atMs - this.originMs))
  }

  snapshot(
    input: Omit<PerformanceReportInput, 'startedAt' | 'milestones'> = {}
  ): PerformanceReport {
    return createPerformanceReport({
      ...input,
      startedAt: this.startedAt,
      milestones: this.milestones
    })
  }
}

export const isPerformanceMilestone = (value: unknown): value is PerformanceMilestone =>
  typeof value === 'string' && PERFORMANCE_MILESTONES.includes(value as PerformanceMilestone)
