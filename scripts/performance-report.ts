import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

export const PERFORMANCE_REPORT_VERSION = 1 as const

const findRepoRoot = (): string => {
  const cwd = resolve(process.cwd())
  if (existsSync(join(cwd, 'packages'))) return cwd
  const candidate = resolve(cwd, '..', '..')
  return existsSync(join(candidate, 'packages')) ? candidate : cwd
}

const repoRoot = findRepoRoot()
const resolveInputPath = (value: string): string => {
  if (path.isAbsolute(value)) return value
  const fromCwd = resolve(value)
  return existsSync(fromCwd) ? fromCwd : resolve(repoRoot, value)
}

export interface PerformanceReport {
  version: typeof PERFORMANCE_REPORT_VERSION
  runId: string
  scenario: string
  startedAt: string
  build: {
    id: string
    version: string
    platform: string
    arch: string
    electron: string
    chrome: string
    node: string
  }
  milestones: Record<string, number>
  resources: Record<string, number>
  memory: Array<{
    atMs: number
    process: 'main' | 'renderer' | 'preload'
    rssBytes?: number
    heapUsedBytes?: number
    heapTotalBytes?: number
    externalBytes?: number
  }>
  counters: Record<string, number>
}

export interface MetricSummary {
  samples: number[]
  p50: number | null
  p95: number | null
}

export interface PerformanceSummaryGroup {
  key: string
  scenario: string
  build: PerformanceReport['build']
  sampleCount: number
  runs: PerformanceReport[]
  milestones: Record<string, MetricSummary>
  resources: Record<string, MetricSummary>
  memory: Record<string, MetricSummary>
  counters: Record<string, MetricSummary>
}

export interface PerformanceSummary {
  version: typeof PERFORMANCE_REPORT_VERSION
  generatedAt: string
  sourceDirectory: '<report-dir>'
  groups: PerformanceSummaryGroup[]
}

export interface ChunkFile {
  path: string
  kind: 'js' | 'css'
  bytes: number
  isEntry: boolean
}

export interface PerformanceScenarioDefinition {
  name: Exclude<PerformanceScenarioName, 'unknown'>
  purpose: string
  repeat: {
    minimumRuns: number
    restartBetweenRuns: boolean
    warmupRuns: number
  }
  setup: readonly string[]
  fixedInputs: {
    windows: number
    tabs: number
    documentSizeKiB?: number
  }
  requiredMilestones: readonly string[]
  memoryMeasurement?: {
    requiredProcesses: readonly ('main' | 'preload' | 'renderer')[]
    requiredMemoryMetrics: readonly ('rssBytes' | 'heapUsedBytes' | 'heapTotalBytes')[]
    requiredHeapMetrics: readonly ('heapUsedBytes' | 'heapTotalBytes')[]
    minimumSamplesPerProcess: number
  }
}

export type PerformanceScenarioName =
  | 'blank-editor'
  | 'cold-editor'
  | 'warm-editor'
  | 'settings-window'
  | 'restore-tabs'
  | 'multi-window'
  | 'large-document'
  | 'multi-tab'
  | 'close-tab'
  | 'close-window'
  | 'app-recovery'
  | 'unknown'

export const PERFORMANCE_SCENARIO_DEFINITIONS: readonly PerformanceScenarioDefinition[] = [
  {
    name: 'blank-editor',
    purpose: '验证空白编辑器报告能够生成且不包含正文、路径或偏好内容。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['使用生产等价构建启动一个空白编辑器窗口。'],
    fixedInputs: { windows: 1, tabs: 1 },
    requiredMilestones: [
      'main-process-start',
      'app-ready',
      'first-window-created',
      'editor-interactive'
    ],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 1
    }
  },
  {
    name: 'cold-editor',
    purpose: '测量清理应用缓存后的首次编辑器启动。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['每次运行前退出应用并清理本次测量使用的应用缓存。'],
    fixedInputs: { windows: 1, tabs: 1 },
    requiredMilestones: [
      'main-process-start',
      'app-ready',
      'first-window-created',
      'editor-interactive'
    ]
  },
  {
    name: 'warm-editor',
    purpose: '测量应用已启动且缓存已预热时的编辑器启动/重载。',
    repeat: { minimumRuns: 3, restartBetweenRuns: false, warmupRuns: 1 },
    setup: ['先完成一次不计入样本的启动，再在同一构建和同一应用会话中重复测量。'],
    fixedInputs: { windows: 1, tabs: 1 },
    requiredMilestones: ['renderer-start', 'dom-ready', 'editor-interactive']
  },
  {
    name: 'settings-window',
    purpose: '测量首次打开设置窗口，不把设置内容写入报告。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['启动编辑器后只打开一个设置窗口，固定窗口布局和显示缩放。'],
    fixedInputs: { windows: 2, tabs: 1 },
    requiredMilestones: ['first-window-created', 'dom-ready', 'first-paint']
  },
  {
    name: 'restore-tabs',
    purpose: '测量恢复固定数量的匿名会话 tab。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['准备固定数量的测试会话 tab；只记录 tab 数，不记录 tab 名称、路径或正文。'],
    fixedInputs: { windows: 1, tabs: 3 },
    requiredMilestones: [
      'app-ready',
      'first-window-created',
      'first-document-loaded',
      'editor-interactive'
    ]
  },
  {
    name: 'multi-window',
    purpose: '测量固定数量编辑器窗口同时创建时的启动资源。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['使用同一构建创建两个编辑器窗口，固定每个窗口的 tab 数。'],
    fixedInputs: { windows: 2, tabs: 2 },
    requiredMilestones: ['app-ready', 'first-window-created', 'editor-interactive']
  },
  {
    name: 'large-document',
    purpose: '测量固定大小的合成大文档编辑，不采集文档内容。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['使用固定 1024 KiB 的合成 Markdown fixture；fixture 内容不得进入报告。'],
    fixedInputs: { windows: 1, tabs: 1, documentSizeKiB: 1024 },
    requiredMilestones: ['first-document-requested', 'first-document-loaded', 'editor-interactive'],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 1
    }
  },
  {
    name: 'multi-tab',
    purpose: '测量固定数量 tab 同时打开后的稳定期内存，不采集 tab 名称、路径或正文。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['启动一个编辑器窗口并打开固定 4 个匿名测试 tab；稳定后采样。'],
    fixedInputs: { windows: 1, tabs: 4 },
    requiredMilestones: ['app-ready', 'first-window-created', 'editor-interactive'],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 1
    }
  },
  {
    name: 'close-tab',
    purpose: '测量关闭一个 tab 后的稳定期内存，验证可释放 tab 不改变剩余 tab 计数。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['先打开 3 个匿名测试 tab，关闭其中 1 个，等待一个采样周期后记录最终状态。'],
    fixedInputs: { windows: 1, tabs: 2 },
    requiredMilestones: ['app-ready', 'first-window-created', 'editor-interactive'],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 2
    }
  },
  {
    name: 'close-window',
    purpose: '测量关闭一个窗口后的稳定期内存，验证窗口计数和剩余 tab 状态。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['先创建 2 个编辑器窗口，关闭其中 1 个，等待一个采样周期后记录最终状态。'],
    fixedInputs: { windows: 1, tabs: 2 },
    requiredMilestones: ['app-ready', 'first-window-created', 'editor-interactive'],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 2
    }
  },
  {
    name: 'app-recovery',
    purpose: '测量应用恢复固定匿名 tab 后的稳定期内存，不记录恢复内容或路径。',
    repeat: { minimumRuns: 3, restartBetweenRuns: true, warmupRuns: 0 },
    setup: ['准备固定 3 个匿名恢复 tab，重启应用并等待恢复完成后记录稳定期样本。'],
    fixedInputs: { windows: 1, tabs: 3 },
    requiredMilestones: [
      'app-ready',
      'first-window-created',
      'first-document-loaded',
      'editor-interactive'
    ],
    memoryMeasurement: {
      requiredProcesses: ['main', 'preload', 'renderer'],
      requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
      requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
      minimumSamplesPerProcess: 1
    }
  }
] as const

export const PERFORMANCE_BASELINE_VERSION = 1 as const

export const PERFORMANCE_BASELINE_POLICY = {
  minimumRuns: 3,
  outlierRule: 'flag-tukey-1.5-iqr-retain-by-default',
  outlierIqrMultiplier: 1.5,
  comparisonBasis: 'relative-to-baseline-p95' as const,
  startupP95RegressionFraction: 0.1,
  memoryAndSizeP95RegressionFraction: 0.15,
  validInterruptionReasons: ['background-update', 'debugger-pause', 'system-load'] as const
} as const

export const PERFORMANCE_BASELINE_STRATEGIES = {
  developer: {
    purpose: 'fixed-machine local comparison',
    regressionGate: false,
    machineClassRequired: true,
    minimumRuns: 3
  },
  ci: {
    purpose: 'dedicated-runner regression gate',
    regressionGate: true,
    machineClassRequired: true,
    minimumRuns: 5
  },
  unknown: {
    purpose: 'exploratory comparison only',
    regressionGate: false,
    machineClassRequired: false,
    minimumRuns: 3
  }
} as const

export interface PerformanceBaselineMetric extends MetricSummary {
  outlierCandidateIndexes: number[]
}

export interface PerformanceBaseline {
  version: typeof PERFORMANCE_BASELINE_VERSION
  generatedAt: string
  sourceDirectory: '<report-dir>'
  environment: {
    kind: 'ci' | 'developer' | 'unknown'
    machineClass: string
  }
  strategy: {
    purpose: string
    regressionGate: boolean
    machineClassRequired: boolean
    minimumRuns: number
  }
  policy: {
    minimumRuns: number
    outlierRule: string
    outlierIqrMultiplier: number
    comparisonBasis: 'relative-to-baseline-p95'
    startupP95RegressionFraction: number
    memoryAndSizeP95RegressionFraction: number
    validInterruptionReasons: readonly string[]
  }
  provenance: {
    reportCount: number
    buildIds: string[]
    scenarios: string[]
    runIds: string[]
  }
  groups: Array<{
    key: string
    scenario: string
    build: PerformanceReport['build']
    status: 'candidate' | 'exploratory'
    sampleCount: number
    validation: {
      requiredMilestonesPresent: boolean
      missingMilestones: string[]
    }
    runIds: string[]
    startedAt: string[]
    milestones: Record<string, PerformanceBaselineMetric>
    resources: Record<string, PerformanceBaselineMetric>
    memory: Record<string, PerformanceBaselineMetric>
    counters: Record<string, PerformanceBaselineMetric>
  }>
}
export type PerformanceComparisonMetricKind = 'startup' | 'resource' | 'first-use' | 'memory'

export interface PerformanceComparisonMetric {
  kind: PerformanceComparisonMetricKind
  metric: string
  baselineP95: number
  candidateP95: number
  deltaFraction: number
  thresholdFraction: number
  regressed: boolean
}

export interface PerformanceComparisonSlice {
  scenario: string
  baselineKey: string
  baselineBuild: PerformanceReport['build']
  candidateBuild: PerformanceReport['build']
  baselineRunIds: string[]
  candidateRunIds: string[]
  metrics: PerformanceComparisonMetric[]
  regression: boolean
}

export interface PerformanceComparison {
  version: typeof PERFORMANCE_REPORT_VERSION
  generatedAt: string
  valid: boolean
  regression: boolean
  comparisonBasis: typeof PERFORMANCE_BASELINE_POLICY.comparisonBasis
  baseline: {
    environment: PerformanceBaseline['environment']
    buildIds: string[]
    runIds: string[]
  }
  candidate: {
    buildIds: string[]
    runIds: string[]
  }
  slices: PerformanceComparisonSlice[]
  errors: string[]
}

export interface ChunkSizeReport {
  version: typeof PERFORMANCE_REPORT_VERSION
  generatedAt: string
  sourceDirectory: '<renderer-dir>'
  entryFiles: ChunkFile[]
  dynamicChunks: ChunkFile[]
  totals: {
    initialJsBytes: number
    initialCssBytes: number
    dynamicJsBytes: number
    dynamicCssBytes: number
    totalJsBytes: number
    totalCssBytes: number
    initialBytes: number
    dynamicBytes: number
  }
  files: ChunkFile[]
  largestChunks: ChunkFile[]
}

const REPORT_KEYS = new Set([
  'version',
  'runId',
  'scenario',
  'startedAt',
  'build',
  'milestones',
  'resources',
  'memory',
  'counters'
])
const BUILD_KEYS = new Set(['id', 'version', 'platform', 'arch', 'electron', 'chrome', 'node'])
const RESOURCE_KEYS = new Set([
  'initialJsBytes',
  'initialCssBytes',
  'dynamicChunkBytes',
  'dynamicChunkLoadMs'
])
const COUNTER_KEYS = new Set(['windows', 'tabs'])
const MEMORY_KEYS = new Set([
  'atMs',
  'process',
  'rssBytes',
  'heapUsedBytes',
  'heapTotalBytes',
  'externalBytes'
])
const FORBIDDEN_KEYS = new Set([
  'path',
  'filepath',
  'documentpath',
  'filename',
  'markdown',
  'body',
  'content',
  'contents',
  'text'
])
const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\/]|[\/]{2}|\/)/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const isFiniteMetric = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

const keyName = (key: string): string => key.replace(/[-_]/g, '').toLowerCase()

const collectPrivacyViolations = (
  value: unknown,
  location = 'report',
  violations: string[] = []
): string[] => {
  if (typeof value === 'string') {
    if (
      ABSOLUTE_PATH.test(value) ||
      /(?:[\/]Users[\/]|[\/]home[\/]|[\/]Documents[\/])/i.test(value)
    ) {
      violations.push(`${location}: absolute or user path`)
    }
    return violations
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectPrivacyViolations(item, `${location}[${index}]`, violations)
    )
    return violations
  }
  if (!isRecord(value)) return violations

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`
    if (FORBIDDEN_KEYS.has(keyName(key))) violations.push(`${childLocation}: sensitive field`)
    collectPrivacyViolations(child, childLocation, violations)
  }
  return violations
}

/** Returns privacy violations without exposing the offending value or full input path. */
export const validateReportPrivacy = (value: unknown): string[] => collectPrivacyViolations(value)

const validateObjectKeys = (
  value: Record<string, unknown>,
  allowed: Set<string>,
  location: string,
  errors: string[]
): void => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${location}: unsupported field '${key}'`)
  }
}

const validateMetricMap = (
  value: unknown,
  allowed: Set<string> | null,
  location: string,
  errors: string[]
): value is Record<string, number> => {
  if (!isRecord(value)) {
    errors.push(`${location}: expected object`)
    return false
  }
  if (allowed) validateObjectKeys(value, allowed, location, errors)
  for (const [key, metric] of Object.entries(value)) {
    if (!isFiniteMetric(metric)) errors.push(`${location}.${key}: expected non-negative number`)
  }
  return true
}

/** Validates the version 1 report shape before it is included in a summary. */
export const validatePerformanceReport = (value: unknown): string[] => {
  const errors: string[] = []
  if (!isRecord(value)) return ['report: expected object']
  validateObjectKeys(value, REPORT_KEYS, 'report', errors)
  if (value.version !== PERFORMANCE_REPORT_VERSION) errors.push('report.version: expected 1')
  for (const key of ['runId', 'scenario', 'startedAt']) {
    if (typeof value[key] !== 'string' || value[key].trim() === '')
      errors.push(`report.${key}: expected non-empty string`)
  }

  if (!isRecord(value.build)) {
    errors.push('report.build: expected object')
  } else {
    validateObjectKeys(value.build, BUILD_KEYS, 'report.build', errors)
    for (const key of BUILD_KEYS) {
      if (typeof value.build[key] !== 'string') errors.push(`report.build.${key}: expected string`)
    }
  }
  validateMetricMap(value.milestones, null, 'report.milestones', errors)
  validateMetricMap(value.resources, RESOURCE_KEYS, 'report.resources', errors)
  validateMetricMap(value.counters, COUNTER_KEYS, 'report.counters', errors)

  if (!Array.isArray(value.memory)) {
    errors.push('report.memory: expected array')
  } else {
    value.memory.forEach((sample, index) => {
      const location = `report.memory[${index}]`
      if (!isRecord(sample)) {
        errors.push(`${location}: expected object`)
        return
      }
      validateObjectKeys(sample, MEMORY_KEYS, location, errors)
      if (!isFiniteMetric(sample.atMs))
        errors.push(`${location}.atMs: expected non-negative number`)
      if (!['main', 'renderer', 'preload'].includes(String(sample.process))) {
        errors.push(`${location}.process: expected main, renderer, or preload`)
      }
      for (const key of ['rssBytes', 'heapUsedBytes', 'heapTotalBytes', 'externalBytes']) {
        if (sample[key] !== undefined && !isFiniteMetric(sample[key])) {
          errors.push(`${location}.${key}: expected non-negative number`)
        }
      }
    })
  }
  return errors
}

export const percentile = (values: readonly number[], probability: number): number | null => {
  if (values.length === 0) return null
  if (probability < 0 || probability > 1)
    throw new RangeError('probability must be between 0 and 1')
  const sorted = [...values].sort((a, b) => a - b)
  const index = (sorted.length - 1) * probability
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

export const summarizeSamples = (samples: readonly number[]): MetricSummary => ({
  samples: [...samples],
  p50: percentile(samples, 0.5),
  p95: percentile(samples, 0.95)
})

const summarizeMetricMap = (values: Map<string, number[]>): Record<string, MetricSummary> =>
  Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, samples]) => [key, summarizeSamples(samples)])
  )

const addMetric = (values: Map<string, number[]>, key: string, value: unknown): void => {
  if (!isFiniteMetric(value)) return
  const samples = values.get(key) ?? []
  samples.push(value)
  values.set(key, samples)
}

const addMetricMap = (values: Map<string, number[]>, source: Record<string, number>): void => {
  for (const [key, value] of Object.entries(source)) addMetric(values, key, value)
}

const buildGroupKey = (report: PerformanceReport): string => `${report.scenario}/${report.build.id}`

export const summarizeReports = (
  reports: readonly PerformanceReport[],
  generatedAt = new Date().toISOString()
): PerformanceSummary => {
  const groups = new Map<string, PerformanceReport[]>()
  for (const report of reports) {
    const key = buildGroupKey(report)
    const group = groups.get(key) ?? []
    group.push(report)
    groups.set(key, group)
  }

  const summarizedGroups = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupReports]) => {
      const orderedRuns = [...groupReports].sort((left, right) =>
        `${left.startedAt}\u0000${left.runId}`.localeCompare(
          `${right.startedAt}\u0000${right.runId}`
        )
      )
      const milestones = new Map<string, number[]>()
      const resources = new Map<string, number[]>()
      const memory = new Map<string, number[]>()
      const counters = new Map<string, number[]>()
      for (const report of orderedRuns) {
        addMetricMap(milestones, report.milestones)
        addMetricMap(resources, report.resources)
        addMetricMap(counters, report.counters)
        for (const sample of report.memory) {
          for (const metric of ['rssBytes', 'heapUsedBytes', 'heapTotalBytes', 'externalBytes']) {
            addMetric(memory, `${sample.process}.${metric}`, sample[metric as keyof typeof sample])
          }
        }
      }
      return {
        key,
        scenario: orderedRuns[0].scenario,
        build: orderedRuns[0].build,
        sampleCount: orderedRuns.length,
        runs: orderedRuns,
        milestones: summarizeMetricMap(milestones),
        resources: summarizeMetricMap(resources),
        memory: summarizeMetricMap(memory),
        counters: summarizeMetricMap(counters)
      }
    })

  return {
    version: PERFORMANCE_REPORT_VERSION,
    generatedAt,
    sourceDirectory: '<report-dir>',
    groups: summarizedGroups
  }
}

export const createBlankEditorReport = (
  options: {
    runId?: string
    startedAt?: string
    buildId?: string
  } = {}
): PerformanceReport => ({
  version: PERFORMANCE_REPORT_VERSION,
  runId: options.runId ?? 'schema-smoke-test',
  scenario: 'blank-editor',
  startedAt: options.startedAt ?? new Date().toISOString(),
  build: {
    id: options.buildId?.trim() || 'schema-smoke-test',
    version: 'unknown',
    platform: 'unknown',
    arch: 'unknown',
    electron: 'unknown',
    chrome: 'unknown',
    node: 'unknown'
  },
  milestones: {
    'main-process-start': 0,
    'app-ready': 1,
    'first-window-created': 2,
    'renderer-start': 3,
    'dom-ready': 4,
    'first-paint': 5,
    'editor-interactive': 6
  },
  resources: {},
  memory: [
    { atMs: 6, process: 'main', rssBytes: 0, heapUsedBytes: 0, heapTotalBytes: 0 },
    { atMs: 6, process: 'preload', rssBytes: 0, heapUsedBytes: 0, heapTotalBytes: 0 },
    { atMs: 6, process: 'renderer', rssBytes: 0, heapUsedBytes: 0, heapTotalBytes: 0 }
  ],
  counters: { windows: 1, tabs: 1 }
})

const PERFORMANCE_MILESTONE_ORDER = [
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
const validateScenarioMemory = (
  report: PerformanceReport,
  scenario: PerformanceScenarioDefinition,
  errors: string[]
): void => {
  const requirements = scenario.memoryMeasurement
  if (!requirements) return

  const samplesByProcess = new Map<
    PerformanceReport['memory'][number]['process'],
    PerformanceReport['memory'][number][]
  >()
  for (const sample of report.memory) {
    const samples = samplesByProcess.get(sample.process) ?? []
    samples.push(sample)
    samplesByProcess.set(sample.process, samples)
  }

  for (const process of requirements.requiredProcesses) {
    const samples = samplesByProcess.get(process) ?? []
    if (samples.length < requirements.minimumSamplesPerProcess) {
      errors.push(
        `memory.${process}: requires at least ${requirements.minimumSamplesPerProcess} sample(s) for ${scenario.name}`
      )
    }
    if (
      new Set(samples.map((sample) => sample.atMs)).size < requirements.minimumSamplesPerProcess
    ) {
      errors.push(
        `memory.${process}: requires distinct before/after timestamps for ${scenario.name}`
      )
    }
    for (const metric of requirements.requiredMemoryMetrics) {
      if (samples.some((sample) => !isFiniteMetric(sample[metric]))) {
        errors.push(`memory.${process}.${metric}: required for every sample of ${scenario.name}`)
      }
    }
    for (const sample of samples) {
      if (
        isFiniteMetric(sample.heapUsedBytes) &&
        isFiniteMetric(sample.heapTotalBytes) &&
        sample.heapUsedBytes > sample.heapTotalBytes
      ) {
        errors.push(`memory.${process}: heapUsedBytes must not exceed heapTotalBytes`)
        break
      }
    }
  }
}

export const validatePerformanceScenarioRun = (report: PerformanceReport): string[] => {
  const scenario = getPerformanceScenario(report.scenario)
  if (!scenario) return [`scenario: unsupported scenario '${report.scenario}'`]
  const errors: string[] = []
  for (const milestone of scenario.requiredMilestones) {
    if (!isFiniteMetric(report.milestones[milestone])) {
      errors.push(`milestones.${milestone}: required for ${scenario.name}`)
    }
  }
  let previousMilestone = -1
  for (const milestone of PERFORMANCE_MILESTONE_ORDER) {
    const timestamp = report.milestones[milestone]
    if (timestamp === undefined) continue
    if (timestamp < previousMilestone) {
      errors.push(`milestones.${milestone}: must be monotonic`)
    }
    previousMilestone = timestamp
  }
  const expectedWindows = scenario.fixedInputs.windows
  const expectedTabs = scenario.fixedInputs.tabs
  if (report.counters.windows !== expectedWindows) {
    errors.push(`counters.windows: expected ${expectedWindows} for ${scenario.name}`)
  }
  if (report.counters.tabs !== expectedTabs) {
    errors.push(`counters.tabs: expected ${expectedTabs} for ${scenario.name}`)
  }
  validateScenarioMemory(report, scenario, errors)
  return errors
}

export const getPerformanceScenario = (name: string): PerformanceScenarioDefinition | undefined =>
  PERFORMANCE_SCENARIO_DEFINITIONS.find((scenario) => scenario.name === name)

const metricSamplesForReports = (
  reports: readonly PerformanceReport[]
): {
  milestones: Map<string, number[]>
  resources: Map<string, number[]>
  memory: Map<string, number[]>
  counters: Map<string, number[]>
} => {
  const milestones = new Map<string, number[]>()
  const resources = new Map<string, number[]>()
  const memory = new Map<string, number[]>()
  const counters = new Map<string, number[]>()
  for (const report of reports) {
    addMetricMap(milestones, report.milestones)
    addMetricMap(resources, report.resources)
    addMetricMap(counters, report.counters)
    for (const sample of report.memory) {
      for (const metric of ['rssBytes', 'heapUsedBytes', 'heapTotalBytes', 'externalBytes']) {
        addMetric(memory, `${sample.process}.${metric}`, sample[metric as keyof typeof sample])
      }
    }
  }
  return { milestones, resources, memory, counters }
}

const outlierCandidateIndexes = (samples: readonly number[]): number[] => {
  if (samples.length < 4) return []
  const q1 = percentile(samples, 0.25)
  const q3 = percentile(samples, 0.75)
  if (q1 === null || q3 === null) return []
  const iqr = q3 - q1
  const lower = q1 - iqr * PERFORMANCE_BASELINE_POLICY.outlierIqrMultiplier
  const upper = q3 + iqr * PERFORMANCE_BASELINE_POLICY.outlierIqrMultiplier
  // Keep all samples; this index list flags review candidates without hiding a real regression.
  return samples.flatMap((sample, index) => (sample < lower || sample > upper ? [index] : []))
}

const summarizeBaselineMetricMap = (
  values: Map<string, number[]>
): Record<string, PerformanceBaselineMetric> =>
  Object.fromEntries(
    [...values.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, samples]) => [
        key,
        {
          ...summarizeSamples(samples),
          outlierCandidateIndexes: outlierCandidateIndexes(samples)
        }
      ])
  )

export const createPerformanceBaseline = (
  reports: readonly PerformanceReport[],
  options: {
    environment?: 'ci' | 'developer' | 'unknown'
    machineClass?: string
    generatedAt?: string
  } = {}
): PerformanceBaseline => {
  const environmentKind = options.environment ?? 'unknown'
  const strategy = PERFORMANCE_BASELINE_STRATEGIES[environmentKind]
  const groups = new Map<string, PerformanceReport[]>()
  for (const report of reports) {
    const key = buildGroupKey(report)
    const group = groups.get(key) ?? []
    group.push(report)
    groups.set(key, group)
  }

  const baselineGroups: PerformanceBaseline['groups'] = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, groupReports]) => {
      const orderedRuns = [...groupReports].sort((left, right) =>
        `${left.startedAt}\u0000${left.runId}`.localeCompare(
          `${right.startedAt}\u0000${right.runId}`
        )
      )
      const metrics = metricSamplesForReports(orderedRuns)
      const missingMilestones = [
        ...new Set(
          orderedRuns.flatMap((run) =>
            validatePerformanceScenarioRun(run)
              .filter((error) => error.startsWith('milestones.'))
              .map((error) => error.split(':', 1)[0].replace(/^milestones\./, ''))
          )
        )
      ].sort()
      return {
        key,
        scenario: orderedRuns[0].scenario,
        build: orderedRuns[0].build,
        status:
          orderedRuns.length >= strategy.minimumRuns && missingMilestones.length === 0
            ? 'candidate'
            : 'exploratory',
        sampleCount: orderedRuns.length,
        validation: {
          requiredMilestonesPresent: missingMilestones.length === 0,
          missingMilestones
        },
        runIds: orderedRuns.map((run) => run.runId),
        startedAt: orderedRuns.map((run) => run.startedAt),
        milestones: summarizeBaselineMetricMap(metrics.milestones),
        resources: summarizeBaselineMetricMap(metrics.resources),
        memory: summarizeBaselineMetricMap(metrics.memory),
        counters: summarizeBaselineMetricMap(metrics.counters)
      }
    })

  const orderedReports = [...reports].sort((left, right) =>
    `${left.startedAt}\u0000${left.runId}`.localeCompare(`${right.startedAt}\u0000${right.runId}`)
  )
  const buildIds = [...new Set(orderedReports.map((report) => report.build.id))].sort()
  const scenarios = [...new Set(orderedReports.map((report) => report.scenario))].sort()

  return {
    version: PERFORMANCE_BASELINE_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    sourceDirectory: '<report-dir>',
    environment: {
      kind: environmentKind,
      machineClass: options.machineClass?.trim() || 'unspecified'
    },
    strategy,
    policy: {
      minimumRuns: strategy.minimumRuns,
      outlierRule: PERFORMANCE_BASELINE_POLICY.outlierRule,
      outlierIqrMultiplier: PERFORMANCE_BASELINE_POLICY.outlierIqrMultiplier,
      comparisonBasis: PERFORMANCE_BASELINE_POLICY.comparisonBasis,
      startupP95RegressionFraction: PERFORMANCE_BASELINE_POLICY.startupP95RegressionFraction,
      memoryAndSizeP95RegressionFraction:
        PERFORMANCE_BASELINE_POLICY.memoryAndSizeP95RegressionFraction,
      validInterruptionReasons: PERFORMANCE_BASELINE_POLICY.validInterruptionReasons
    },
    provenance: {
      reportCount: orderedReports.length,
      buildIds,
      scenarios,
      runIds: orderedReports.map((report) => report.runId)
    },
    groups: baselineGroups
  }
}

const validateBaselineMetricMap = (value: unknown, location: string, errors: string[]): void => {
  if (!isRecord(value)) {
    errors.push(`${location}: expected object`)
    return
  }
  for (const [key, metric] of Object.entries(value)) {
    if (!isRecord(metric)) {
      errors.push(`${location}.${key}: expected object`)
      continue
    }
    if (
      !Array.isArray(metric.samples) ||
      metric.samples.some((sample) => !isFiniteMetric(sample))
    ) {
      errors.push(`${location}.${key}.samples: expected non-negative numbers`)
    }
    for (const percentileName of ['p50', 'p95']) {
      if (metric[percentileName] !== null && !isFiniteMetric(metric[percentileName])) {
        errors.push(`${location}.${key}.${percentileName}: expected number or null`)
      }
    }
    const sampleCount = Array.isArray(metric.samples) ? metric.samples.length : 0
    if (
      !Array.isArray(metric.outlierCandidateIndexes) ||
      metric.outlierCandidateIndexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= sampleCount
      )
    ) {
      errors.push(`${location}.${key}.outlierCandidateIndexes: expected indexes within samples`)
    }
  }
}

export const validatePerformanceBaseline = (value: unknown): string[] => {
  const errors: string[] = []
  if (!isRecord(value)) return ['baseline: expected object']
  if (value.version !== PERFORMANCE_BASELINE_VERSION) errors.push('baseline.version: expected 1')
  if (typeof value.generatedAt !== 'string' || value.generatedAt.trim() === '') {
    errors.push('baseline.generatedAt: expected non-empty string')
  }
  if (value.sourceDirectory !== '<report-dir>') {
    errors.push('baseline.sourceDirectory: expected <report-dir>')
  }
  if (!isRecord(value.environment)) {
    errors.push('baseline.environment: expected object')
  } else {
    if (!['ci', 'developer', 'unknown'].includes(String(value.environment.kind))) {
      errors.push('baseline.environment.kind: expected ci, developer, or unknown')
    }
    if (
      typeof value.environment.machineClass !== 'string' ||
      !value.environment.machineClass.trim()
    ) {
      errors.push('baseline.environment.machineClass: expected non-empty string')
    }
  }
  if (!isRecord(value.strategy)) {
    errors.push('baseline.strategy: expected object')
  } else {
    for (const key of ['purpose']) {
      if (typeof value.strategy[key] !== 'string' || !value.strategy[key].trim()) {
        errors.push(`baseline.strategy.${key}: expected non-empty string`)
      }
    }
    for (const key of ['regressionGate', 'machineClassRequired']) {
      if (typeof value.strategy[key] !== 'boolean') {
        errors.push(`baseline.strategy.${key}: expected boolean`)
      }
    }
    if (
      !isFiniteMetric(value.strategy.minimumRuns) ||
      !Number.isInteger(value.strategy.minimumRuns)
    ) {
      errors.push('baseline.strategy.minimumRuns: expected integer')
    }
    const environmentKind =
      isRecord(value.environment) && typeof value.environment.kind === 'string'
        ? value.environment.kind
        : undefined
    if (environmentKind && environmentKind in PERFORMANCE_BASELINE_STRATEGIES) {
      const expected =
        PERFORMANCE_BASELINE_STRATEGIES[
          environmentKind as keyof typeof PERFORMANCE_BASELINE_STRATEGIES
        ]
      for (const key of [
        'purpose',
        'regressionGate',
        'machineClassRequired',
        'minimumRuns'
      ] as const) {
        if (value.strategy[key] !== expected[key]) {
          errors.push(`baseline.strategy.${key}: does not match environment strategy`)
        }
      }
    }
  }
  if (!isRecord(value.policy)) {
    errors.push('baseline.policy: expected object')
  } else {
    for (const key of [
      'minimumRuns',
      'outlierIqrMultiplier',
      'startupP95RegressionFraction',
      'memoryAndSizeP95RegressionFraction'
    ]) {
      if (!isFiniteMetric(value.policy[key])) errors.push(`baseline.policy.${key}: expected number`)
    }
    if (value.policy.comparisonBasis !== 'relative-to-baseline-p95') {
      errors.push('baseline.policy.comparisonBasis: expected relative-to-baseline-p95')
    }
    if (typeof value.policy.outlierRule !== 'string' || !value.policy.outlierRule.trim()) {
      errors.push('baseline.policy.outlierRule: expected non-empty string')
    }
    if (
      !Array.isArray(value.policy.validInterruptionReasons) ||
      value.policy.validInterruptionReasons.some((reason) => typeof reason !== 'string')
    ) {
      errors.push('baseline.policy.validInterruptionReasons: expected strings')
    }
  }
  if (!isRecord(value.provenance)) {
    errors.push('baseline.provenance: expected object')
  } else {
    if (
      !isFiniteMetric(value.provenance.reportCount) ||
      !Number.isInteger(value.provenance.reportCount)
    ) {
      errors.push('baseline.provenance.reportCount: expected integer')
    }
    for (const key of ['buildIds', 'scenarios', 'runIds']) {
      if (
        !Array.isArray(value.provenance[key]) ||
        value.provenance[key].some((item) => typeof item !== 'string' || !item.trim())
      ) {
        errors.push(`baseline.provenance.${key}: expected non-empty strings`)
      }
    }
  }
  if (!Array.isArray(value.groups)) {
    errors.push('baseline.groups: expected array')
    return errors
  }
  const groupBuildIds: string[] = []
  const groupScenarios: string[] = []
  const groupRunIds: string[] = []
  let groupSampleCount = 0
  value.groups.forEach((group, index) => {
    const location = `baseline.groups[${index}]`
    if (!isRecord(group)) {
      errors.push(`${location}: expected object`)
      return
    }
    if (typeof group.scenario === 'string') groupScenarios.push(group.scenario)
    if (isRecord(group.build) && typeof group.build.id === 'string')
      groupBuildIds.push(group.build.id)
    if (isFiniteMetric(group.sampleCount) && Number.isInteger(group.sampleCount))
      groupSampleCount += group.sampleCount
    if (Array.isArray(group.runIds)) {
      groupRunIds.push(
        ...group.runIds.filter((runId): runId is string => typeof runId === 'string')
      )
    }
    for (const key of ['key', 'scenario', 'status']) {
      if (typeof group[key] !== 'string' || group[key].trim() === '') {
        errors.push(`${location}.${key}: expected non-empty string`)
      }
    }
    if (!isRecord(group.build)) {
      errors.push(`${location}.build: expected object`)
    } else {
      for (const key of BUILD_KEYS) {
        if (typeof group.build[key] !== 'string' || !group.build[key].trim()) {
          errors.push(`${location}.build.${key}: expected non-empty string`)
        }
      }
      if (
        typeof group.scenario === 'string' &&
        group.key !== `${group.scenario}/${group.build.id}`
      ) {
        errors.push(`${location}.key: expected scenario/build.id`)
      }
    }
    if (!isFiniteMetric(group.sampleCount) || !Number.isInteger(group.sampleCount)) {
      errors.push(`${location}.sampleCount: expected integer`)
    }
    if (!isRecord(group.validation)) {
      errors.push(`${location}.validation: expected object`)
    } else {
      if (typeof group.validation.requiredMilestonesPresent !== 'boolean') {
        errors.push(`${location}.validation.requiredMilestonesPresent: expected boolean`)
      }
      if (
        !Array.isArray(group.validation.missingMilestones) ||
        group.validation.missingMilestones.some((milestone) => typeof milestone !== 'string')
      ) {
        errors.push(`${location}.validation.missingMilestones: expected strings`)
      }
    }
    if (
      !Array.isArray(group.runIds) ||
      group.runIds.some((runId) => typeof runId !== 'string' || !runId.trim())
    ) {
      errors.push(`${location}.runIds: expected non-empty strings`)
    } else if (group.runIds.length !== group.sampleCount) {
      errors.push(`${location}.runIds: expected one run id per sample`)
    }
    if (
      !Array.isArray(group.startedAt) ||
      group.startedAt.some((startedAt) => typeof startedAt !== 'string' || !startedAt.trim())
    ) {
      errors.push(`${location}.startedAt: expected non-empty strings`)
    } else if (group.startedAt.length !== group.sampleCount) {
      errors.push(`${location}.startedAt: expected one timestamp per sample`)
    }
    validateBaselineMetricMap(group.milestones, `${location}.milestones`, errors)
    validateBaselineMetricMap(group.resources, `${location}.resources`, errors)
    validateBaselineMetricMap(group.memory, `${location}.memory`, errors)
    validateBaselineMetricMap(group.counters, `${location}.counters`, errors)
  })
  if (isRecord(value.provenance)) {
    const expectedBuildIds = [...new Set(groupBuildIds)].sort()
    const expectedScenarios = [...new Set(groupScenarios)].sort()
    const expectedRunIds = [...groupRunIds].sort()
    if (value.provenance.reportCount !== groupSampleCount) {
      errors.push('baseline.provenance.reportCount: must equal group sample count')
    }
    if (JSON.stringify(value.provenance.buildIds) !== JSON.stringify(expectedBuildIds)) {
      errors.push('baseline.provenance.buildIds: must match group build identities')
    }
    if (JSON.stringify(value.provenance.scenarios) !== JSON.stringify(expectedScenarios)) {
      errors.push('baseline.provenance.scenarios: must match group scenarios')
    }
    const actualRunIds = Array.isArray(value.provenance.runIds)
      ? value.provenance.runIds.filter((runId): runId is string => typeof runId === 'string').sort()
      : []
    if (JSON.stringify(actualRunIds) !== JSON.stringify(expectedRunIds)) {
      errors.push('baseline.provenance.runIds: must match group run ids')
    }
  }
  return errors
}

const COMPARISON_RUNTIME_FIELDS = [
  'version',
  'platform',
  'arch',
  'electron',
  'chrome',
  'node'
] as const

const uniqueSorted = (values: readonly string[]): string[] => [...new Set(values)].sort()

const comparisonDeltaFraction = (baselineP95: number, candidateP95: number): number => {
  if (baselineP95 === 0) return candidateP95 === 0 ? 0 : 1
  return (candidateP95 - baselineP95) / baselineP95
}

/**
 * Compare one candidate build with a validated, reproducible baseline.
 * Build ids are intentionally allowed to differ; runtime identity and fixed
 * scenario inputs must match so an optimization slice is compared in place.
 */
export const comparePerformanceBaseline = (
  baseline: PerformanceBaseline,
  candidateReports: readonly PerformanceReport[],
  options: {
    environment?: 'ci' | 'developer' | 'unknown'
    machineClass?: string
    generatedAt?: string
  } = {}
): PerformanceComparison => {
  const generatedAt = options.generatedAt ?? new Date().toISOString()
  const errors: string[] = [
    ...validateReportPrivacy(baseline),
    ...validatePerformanceBaseline(baseline)
  ]
  const candidateValidationErrors = candidateReports.flatMap((report) => {
    const prefix = 'candidate.' + report.runId
    const shapeErrors = validatePerformanceReport(report)
    const privacyErrors = validateReportPrivacy(report)
    const scenarioErrors = shapeErrors.length ? [] : validatePerformanceScenarioRun(report)
    return [...shapeErrors, ...privacyErrors, ...scenarioErrors].map(
      (error) => prefix + ': ' + error
    )
  })
  errors.push(...candidateValidationErrors)

  if (options.environment !== baseline.environment.kind) {
    errors.push(
      'candidate environment mismatch: expected ' +
        baseline.environment.kind +
        ', got ' +
        (options.environment ?? 'unspecified')
    )
  }
  if (baseline.environment.machineClass !== 'unspecified') {
    if (options.machineClass !== baseline.environment.machineClass) {
      errors.push(
        'candidate machine class mismatch: expected ' +
          baseline.environment.machineClass +
          ', got ' +
          (options.machineClass ?? 'unspecified')
      )
    }
  }

  const candidateByScenario = new Map<string, PerformanceReport[]>()
  for (const report of candidateReports) {
    const reports = candidateByScenario.get(report.scenario) ?? []
    reports.push(report)
    candidateByScenario.set(report.scenario, reports)
  }

  const baselineScenarios = baseline.groups.map((group) => group.scenario)
  const candidateScenarios = [...candidateByScenario.keys()]
  const baselineScenarioSet = new Set(baselineScenarios)
  const candidateScenarioSet = new Set(candidateScenarios)
  if (baselineScenarioSet.size !== baselineScenarios.length) {
    errors.push('baseline: each scenario must have exactly one build group')
  }
  for (const scenario of baselineScenarioSet) {
    if (!candidateScenarioSet.has(scenario)) {
      errors.push('candidate: missing scenario ' + scenario)
    }
  }
  for (const scenario of candidateScenarioSet) {
    if (!baselineScenarioSet.has(scenario)) {
      errors.push('candidate: unexpected scenario ' + scenario)
    }
  }

  const slices: PerformanceComparisonSlice[] = []
  for (const baselineGroup of baseline.groups) {
    const scenario = getPerformanceScenario(baselineGroup.scenario)
    const candidates = candidateByScenario.get(baselineGroup.scenario) ?? []
    if (!scenario || candidates.length === 0) continue

    const candidateBuildIds = uniqueSorted(candidates.map((report) => report.build.id))
    if (candidateBuildIds.length !== 1) {
      errors.push(
        'candidate.' + baselineGroup.scenario + ': expected one candidate build id, got ' +
          candidateBuildIds.join(', ')
      )
      continue
    }
    const candidateBuild = candidates[0].build
    for (const field of COMPARISON_RUNTIME_FIELDS) {
      if (baselineGroup.build[field] !== candidateBuild[field]) {
        errors.push(
          baselineGroup.scenario + ': build runtime mismatch for ' + field +
            ' (baseline=' + baselineGroup.build[field] + ', candidate=' + candidateBuild[field] + ')'
        )
      }
    }
    if (baselineGroup.status !== 'candidate') {
      errors.push(baselineGroup.key + ': baseline group is exploratory, not a candidate')
    }
    const minimumRuns = Math.max(scenario.repeat.minimumRuns, baseline.strategy.minimumRuns)
    if (candidates.length < minimumRuns) {
      errors.push(
        baselineGroup.scenario + ': candidate requires at least ' + minimumRuns +
          ' runs, got ' + candidates.length
      )
    }

    for (const counter of ['windows', 'tabs'] as const) {
      const baselineCounter = baselineGroup.counters[counter]?.p50
      if (!isFiniteMetric(baselineCounter)) {
        errors.push(baselineGroup.key + ': missing baseline counter ' + counter)
        continue
      }
      for (const report of candidates) {
        if (report.counters[counter] !== baselineCounter) {
          errors.push(
            baselineGroup.scenario + ': fixed input ' + counter + ' mismatch (expected ' +
              baselineCounter + ', got ' + report.counters[counter] + ')'
          )
        }
      }
    }

    const candidateMetrics = metricSamplesForReports(candidates)
    const metrics: PerformanceComparisonMetric[] = []
    const addComparisonMetric = (
      kind: PerformanceComparisonMetricKind,
      metric: string,
      baselineP95: number | null | undefined,
      candidateP95: number | null | undefined,
      thresholdFraction: number,
      required = true
    ): void => {
      const baselinePresent = isFiniteMetric(baselineP95)
      const candidatePresent = isFiniteMetric(candidateP95)
      if (!baselinePresent || !candidatePresent) {
        if (required || baselinePresent !== candidatePresent) {
          errors.push(baselineGroup.scenario + ': missing comparable metric ' + metric)
        }
        return
      }
      const deltaFraction = comparisonDeltaFraction(baselineP95, candidateP95)
      metrics.push({
        kind,
        metric,
        baselineP95,
        candidateP95,
        deltaFraction,
        thresholdFraction,
        regressed: baselineP95 === 0 ? candidateP95 > 0 : deltaFraction > thresholdFraction
      })
    }

    for (const milestone of scenario.requiredMilestones) {
      addComparisonMetric(
        'startup',
        'milestones.' + milestone,
        baselineGroup.milestones[milestone]?.p95,
        summarizeSamples(candidateMetrics.milestones.get(milestone) ?? []).p95,
        PERFORMANCE_BASELINE_POLICY.startupP95RegressionFraction
      )
    }
    addComparisonMetric(
      'resource',
      'resources.initialJsBytes',
      baselineGroup.resources.initialJsBytes?.p95,
      summarizeSamples(candidateMetrics.resources.get('initialJsBytes') ?? []).p95,
      PERFORMANCE_BASELINE_POLICY.memoryAndSizeP95RegressionFraction
    )
    addComparisonMetric(
      'resource',
      'resources.initialCssBytes',
      baselineGroup.resources.initialCssBytes?.p95,
      summarizeSamples(candidateMetrics.resources.get('initialCssBytes') ?? []).p95,
      PERFORMANCE_BASELINE_POLICY.memoryAndSizeP95RegressionFraction
    )
    addComparisonMetric(
      'first-use',
      'resources.dynamicChunkLoadMs',
      baselineGroup.resources.dynamicChunkLoadMs?.p95,
      summarizeSamples(candidateMetrics.resources.get('dynamicChunkLoadMs') ?? []).p95,
      PERFORMANCE_BASELINE_POLICY.startupP95RegressionFraction,
      false
    )

    const memoryRequirements = scenario.memoryMeasurement
    if (memoryRequirements) {
      const requiredMemoryMetrics: readonly (
        | 'rssBytes'
        | 'heapUsedBytes'
        | 'heapTotalBytes'
      )[] = memoryRequirements.requiredMemoryMetrics
      for (const process of memoryRequirements.requiredProcesses) {
        for (const memoryMetric of requiredMemoryMetrics) {
          const key = process + '.' + memoryMetric
          addComparisonMetric(
            'memory',
            'memory.' + key,
            baselineGroup.memory[key]?.p95,
            summarizeSamples(candidateMetrics.memory.get(key) ?? []).p95,
            PERFORMANCE_BASELINE_POLICY.memoryAndSizeP95RegressionFraction
          )
        }
      }
    }

    slices.push({
      scenario: baselineGroup.scenario,
      baselineKey: baselineGroup.key,
      baselineBuild: { ...baselineGroup.build },
      candidateBuild: { ...candidateBuild },
      baselineRunIds: [...baselineGroup.runIds],
      candidateRunIds: candidates.map((report) => report.runId),
      metrics,
      regression: metrics.some((metric) => metric.regressed)
    })
  }

  return {
    version: PERFORMANCE_REPORT_VERSION,
    generatedAt,
    valid: errors.length === 0,
    regression: slices.some((slice) => slice.regression),
    comparisonBasis: PERFORMANCE_BASELINE_POLICY.comparisonBasis,
    baseline: {
      environment: { ...baseline.environment },
      buildIds: uniqueSorted(baseline.provenance.buildIds),
      runIds: [...baseline.provenance.runIds]
    },
    candidate: {
      buildIds: uniqueSorted(candidateReports.map((report) => report.build.id)),
      runIds: candidateReports.map((report) => report.runId)
    },
    slices,
    errors
  }
}


export interface PerformanceSliceRollbackContract {
  name: string
  optimizationFiles: readonly string[]
  measurementFiles: readonly string[]
  behaviorTests: readonly string[]
}

/**
 * Files that must survive a feature-slice rollback. Optimization files are
 * intentionally kept separate from measurement and behavior evidence so a
 * reverted slice cannot remove the tools used to diagnose the regression.
 */
export const PERFORMANCE_SLICE_ROLLBACK_CONTRACTS: readonly PerformanceSliceRollbackContract[] = [
  {
    name: 'main-startup',
    optimizationFiles: [
      'packages/desktop/src/main/app/index.ts',
      'packages/desktop/src/main/app/applicationStartup.ts'
    ],
    measurementFiles: [
      'scripts/performance-report.ts',
      'packages/desktop/src/main/performance/index.ts',
      'packages/desktop/src/renderer/src/platform/performance.ts',
      'packages/desktop/test/unit/specs/performance-report-tool.spec.ts',
      'packages/desktop/test/unit/specs/performance.spec.ts'
    ],
    behaviorTests: [
      'packages/desktop/test/unit/specs/app-startup-idempotence.spec.ts',
      'packages/desktop/test/unit/specs/startup-request-integration.spec.ts'
    ]
  },
  {
    name: 'renderer-loading',
    optimizationFiles: [
      'packages/desktop/src/renderer/src/main.ts',
      'packages/desktop/src/renderer/src/router/index.ts'
    ],
    measurementFiles: [
      'scripts/performance-report.ts',
      'packages/desktop/test/unit/specs/renderer-lazy-loading-boundaries.spec.ts',
      'packages/desktop/test/unit/specs/renderer-startup-dependency-boundaries.spec.ts'
    ],
    behaviorTests: [
      'packages/desktop/test/unit/specs/renderer-route-loading.spec.ts'
    ]
  },
  {
    name: 'window-memory-lifecycle',
    optimizationFiles: [
      'packages/desktop/src/main/windows/editor.ts',
      'packages/desktop/src/main/windows/setting.ts',
      'packages/desktop/src/main/app/windowManager.ts'
    ],
    measurementFiles: [
      'scripts/performance-report.ts',
      'packages/desktop/test/unit/specs/performance-report-tool.spec.ts'
    ],
    behaviorTests: [
      'packages/desktop/test/unit/specs/editor-window-lifecycle.spec.ts',
      'packages/desktop/test/unit/specs/settings-window-lifecycle.spec.ts'
    ]
  },
  {
    name: 'sidebar-large-project',
    optimizationFiles: [
      'packages/desktop/src/main/filesystem/watcher.ts',
      'packages/desktop/src/renderer/src/store/project.ts',
      'packages/desktop/src/renderer/src/store/treeCtrl.ts',
      'packages/desktop/src/renderer/src/components/sideBar/tree.vue',
      'packages/desktop/src/renderer/src/components/sideBar/treeRow.vue',
      'packages/desktop/src/renderer/src/components/sideBar/visibleRows.ts',
      'packages/desktop/src/renderer/src/components/sideBar/focusRegistry.ts',
      'packages/desktop/src/renderer/src/components/sideBar/index.vue'
    ],
    measurementFiles: [
      'packages/desktop/test/unit/specs/sidebar-virtual-rows.spec.ts',
      'packages/desktop/test/unit/specs/watcher-initial-snapshot.spec.ts'
    ],
    behaviorTests: [
      'packages/desktop/test/unit/specs/project-tree-snapshot.spec.ts',
      'packages/desktop/test/unit/specs/sidebar-new-file-content.spec.ts',
      'packages/desktop/test/unit/specs/sidebar-lifecycle.spec.ts',
      'packages/desktop/test/e2e/issue-2421-sidebar-state.spec.ts'
    ]
  },
  {
    name: 'source-code-search',
    optimizationFiles: ['packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue'],
    measurementFiles: [
      'scripts/performance-report.ts',
      'packages/desktop/test/unit/specs/renderer-lazy-loading-boundaries.spec.ts'
    ],
    behaviorTests: ['packages/desktop/test/e2e/source-mode-find-replace.spec.ts']
  }
] as const

export const validatePerformanceSliceRollbackContract = (
  root = repoRoot
): string[] => {
  const errors: string[] = []
  for (const contract of PERFORMANCE_SLICE_ROLLBACK_CONTRACTS) {
    const retained = [...contract.measurementFiles, ...contract.behaviorTests]
    const optimization = new Set(contract.optimizationFiles)
    for (const retainedFile of retained) {
      if (optimization.has(retainedFile)) {
        errors.push(contract.name + ': retained file overlaps optimization file ' + retainedFile)
      }
      if (!existsSync(join(root, retainedFile))) {
        errors.push(contract.name + ': missing retained file ' + retainedFile)
      }
    }
  }
  return errors
}

const readCandidatePerformanceReports = async (source: string): Promise<PerformanceReport[]> => {
  const input = resolveInputPath(source)
  const stats = await fs.stat(input)
  if (stats.isDirectory()) return readPerformanceReports(input)

  let parsed: unknown
  try {
    parsed = JSON.parse(await fs.readFile(input, 'utf8'))
  } catch {
    throw new Error('Invalid candidate performance JSON file')
  }
  if (Array.isArray(parsed)) return parsed as PerformanceReport[]
  if (isRecord(parsed) && Array.isArray(parsed.groups)) {
    const reports: PerformanceReport[] = []
    for (const group of parsed.groups) {
      if (!isRecord(group) || !Array.isArray(group.runs)) {
        throw new Error('Candidate summary groups must include runs')
      }
      reports.push(...(group.runs as PerformanceReport[]))
    }
    return reports
  }
  return [parsed as PerformanceReport]
}

export const readPerformanceReports = async (
  reportDirectory: string
): Promise<PerformanceReport[]> => {
  const directory = resolveInputPath(reportDirectory)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const reports: PerformanceReport[] = []
  for (const entry of entries
    .filter((item) => item.isFile() && extname(item.name).toLowerCase() === '.json')
    .sort((a, b) => a.name.localeCompare(b.name))) {
    let parsed: unknown
    try {
      parsed = JSON.parse(await fs.readFile(join(directory, entry.name), 'utf8'))
    } catch {
      throw new Error(`Invalid JSON in report file '${basename(entry.name)}'`)
    }
    const privacyErrors = validateReportPrivacy(parsed)
    if (privacyErrors.length) {
      throw new Error(
        `Privacy validation failed for '${basename(entry.name)}': ${privacyErrors.join('; ')}`
      )
    }
    const shapeErrors = validatePerformanceReport(parsed)
    if (shapeErrors.length) {
      throw new Error(
        `Invalid performance report '${basename(entry.name)}': ${shapeErrors.join('; ')}`
      )
    }
    reports.push(parsed as PerformanceReport)
  }
  return reports
}

const normalizeRelativePath = (value: string): string =>
  value.split(sep).join('/').replace(/^\.\//, '')

const isInside = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate)
  return (
    relativePath === '' ||
    (relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !relativePath.startsWith('/'))
  )
}

const htmlAttribute = (tag: string, name: string): string | null => {
  const match =
    name === 'src'
      ? tag.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)
      : tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)
  return match?.[2] ?? null
}

const entryReferences = (html: string, root: string): Set<string> => {
  const entries = new Set<string>()
  const tagPattern = /<(script|link)\b[^>]*>/gi
  for (const match of html.matchAll(tagPattern)) {
    const tag = match[0]
    const tagName = match[1].toLowerCase()
    const attribute = tagName === 'script' ? htmlAttribute(tag, 'src') : htmlAttribute(tag, 'href')
    if (!attribute || /^(?:[a-z]+:|\/\/|data:|#)/i.test(attribute)) continue
    if (tagName === 'link' && !/\brel=["'][^"']*stylesheet/i.test(tag)) continue
    const clean = attribute.split(/[?#]/, 1)[0]
    const candidate = resolve(root, clean.replace(/^\//, ''))
    if (isInside(root, candidate)) entries.add(normalizeRelativePath(relative(root, candidate)))
  }
  return entries
}

const listFiles = async (directory: string, root: string): Promise<string[]> => {
  const result: string[] = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await listFiles(absolutePath, root)))
    else if (entry.isFile() && /\.(?:js|css)$/i.test(entry.name)) {
      result.push(normalizeRelativePath(relative(root, absolutePath)))
    }
  }
  return result
}

export const collectChunkSizes = async (rendererDirectory: string): Promise<ChunkSizeReport> => {
  const root = resolveInputPath(rendererDirectory)
  const html = await fs.readFile(join(root, 'index.html'), 'utf8')
  const entryPaths = entryReferences(html, root)
  const paths = (await listFiles(root, root)).sort((left, right) => left.localeCompare(right))
  const files = await Promise.all(
    paths.map(async (filePath) => {
      const bytes = (await fs.stat(join(root, filePath))).size
      return {
        path: filePath,
        kind: extname(filePath).toLowerCase() === '.js' ? ('js' as const) : ('css' as const),
        bytes,
        isEntry: entryPaths.has(filePath)
      }
    })
  )
  const entryFiles = files.filter((file) => file.isEntry)
  const dynamicChunks = files.filter((file) => !file.isEntry)
  const total = (items: ChunkFile[], kind: ChunkFile['kind']): number =>
    items.filter((file) => file.kind === kind).reduce((sum, file) => sum + file.bytes, 0)
  const initialJsBytes = total(entryFiles, 'js')
  const initialCssBytes = total(entryFiles, 'css')
  const dynamicJsBytes = total(dynamicChunks, 'js')
  const dynamicCssBytes = total(dynamicChunks, 'css')

  return {
    version: PERFORMANCE_REPORT_VERSION,
    generatedAt: new Date().toISOString(),
    sourceDirectory: '<renderer-dir>',
    entryFiles,
    dynamicChunks,
    totals: {
      initialJsBytes,
      initialCssBytes,
      dynamicJsBytes,
      dynamicCssBytes,
      totalJsBytes: initialJsBytes + dynamicJsBytes,
      totalCssBytes: initialCssBytes + dynamicCssBytes,
      initialBytes: initialJsBytes + initialCssBytes,
      dynamicBytes: dynamicJsBytes + dynamicCssBytes
    },
    files,
    largestChunks: [...files]
      .sort((left, right) => right.bytes - left.bytes || left.path.localeCompare(right.path))
      .slice(0, 20)
  }
}

const writeJson = async (value: unknown, output?: string): Promise<void> => {
  const serialized = `${JSON.stringify(value, null, 2)}\n`
  if (!output) {
    process.stdout.write(serialized)
    return
  }
  const outputPath = resolve(output)
  await fs.mkdir(resolve(outputPath, '..'), { recursive: true })
  await fs.writeFile(outputPath, serialized, 'utf8')
  process.stdout.write(`Wrote ${basename(outputPath)}\n`)
}

export const writePerformanceReport = async (
  report: PerformanceReport,
  output: string
): Promise<string> => {
  const outputPath = resolve(output)
  const shapeErrors = validatePerformanceReport(report)
  const privacyErrors = validateReportPrivacy(report)
  if (shapeErrors.length || privacyErrors.length) {
    throw new Error(
      `Cannot write performance report: ${[...shapeErrors, ...privacyErrors].join('; ')}`
    )
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return outputPath
}

const usage = (): string =>
  `Usage:\n  pnpm run perf:report -- scenarios [--output file]\n  pnpm run perf:report -- smoke [--output file]\n  pnpm run perf:report -- summarize [report-dir] [--output file]\n  pnpm run perf:report -- baseline [report-dir] [--environment ci|developer] [--machine-class name] [--output file]\n  pnpm run perf:report -- validate [report-dir]\n  pnpm run perf:report -- scenario-validate [report-file]\n  pnpm run perf:report -- baseline-validate [baseline-file] [--output file]\n  pnpm run perf:report -- compare [baseline-file] --candidate report-dir [--environment ci|developer|unknown] [--machine-class name] [--output file]\n  pnpm run perf:report -- chunks [renderer-dir] [--output file]\n\nWhen report-dir is omitted, MARKTEXT_PERF_REPORT_DIR is used.\n`

export const runCli = async (argv: string[] = process.argv.slice(2)): Promise<void> => {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv]
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'summarize'
  let source: string | undefined
  let output: string | undefined
  let environment: 'ci' | 'developer' | 'unknown' | undefined
  let machineClass: string | undefined
  let candidateSource: string | undefined
  while (args.length) {
    const argument = args.shift() as string
    if (argument === '--output' || argument === '-o') output = args.shift()
    else if (argument.startsWith('--output=')) output = argument.slice('--output='.length)
    else if (argument === '--environment') environment = args.shift() as typeof environment
    else if (argument.startsWith('--environment='))
      environment = argument.slice('--environment='.length) as typeof environment
    else if (argument === '--machine-class') machineClass = args.shift()
    else if (argument.startsWith('--machine-class='))
      machineClass = argument.slice('--machine-class='.length)
    else if (argument === '--candidate' || argument === '--candidate-dir') candidateSource = args.shift()
    else if (argument.startsWith('--candidate=') || argument.startsWith('--candidate-dir='))
      candidateSource = argument.slice(argument.indexOf('=') + 1)
    else if (!argument.startsWith('-') && !source) source = argument
    else throw new Error(`Unknown argument '${argument}'\n${usage()}`)
  }

  if (command === 'scenarios') {
    await writeJson(
      { version: PERFORMANCE_REPORT_VERSION, scenarios: PERFORMANCE_SCENARIO_DEFINITIONS },
      output
    )
    return
  }
  if (command === 'smoke') {
    const report = createBlankEditorReport()
    if (output) {
      await writePerformanceReport(report, output)
      process.stdout.write(`Wrote ${basename(resolve(output))}\n`)
    } else {
      await writeJson(report)
    }
    return
  }
  if (command === 'scenario-validate') {
    if (!source) throw new Error(`A report file is required.\n${usage()}`)
    const parsed = JSON.parse(await fs.readFile(resolveInputPath(source), 'utf8')) as unknown
    const shapeErrors = validatePerformanceReport(parsed)
    const privacyErrors = validateReportPrivacy(parsed)
    const scenarioErrors = shapeErrors.length
      ? []
      : validatePerformanceScenarioRun(parsed as PerformanceReport)
    const errors = [...shapeErrors, ...privacyErrors, ...scenarioErrors]
    await writeJson(
      { version: PERFORMANCE_REPORT_VERSION, valid: errors.length === 0, errors },
      output
    )
    if (errors.length) throw new Error(`Scenario validation failed: ${errors.join('; ')}`)
    return
  }
  if (command === 'baseline-validate') {
    if (!source) throw new Error(`A baseline file is required.\n${usage()}`)
    const parsed = JSON.parse(await fs.readFile(resolveInputPath(source), 'utf8')) as unknown
    const errors = [...validateReportPrivacy(parsed), ...validatePerformanceBaseline(parsed)]
    await writeJson(
      { version: PERFORMANCE_BASELINE_VERSION, valid: errors.length === 0, errors },
      output
    )
    if (errors.length) throw new Error(`Baseline validation failed: ${errors.join('; ')}`)
    return
  }
  if (command === 'summarize' || command === 'summary') {
    const reportDirectory = source ?? process.env.MARKTEXT_PERF_REPORT_DIR
    if (!reportDirectory)
      throw new Error(
        `A report directory is required (or set MARKTEXT_PERF_REPORT_DIR).\n${usage()}`
      )
    const reports = await readPerformanceReports(reportDirectory)
    await writeJson(summarizeReports(reports), output)
    return
  }
  if (command === 'baseline') {
    const reportDirectory = source ?? process.env.MARKTEXT_PERF_REPORT_DIR
    if (!reportDirectory)
      throw new Error(
        `A report directory is required (or set MARKTEXT_PERF_REPORT_DIR).\n${usage()}`
      )
    if (environment && !['ci', 'developer', 'unknown'].includes(environment)) {
      throw new Error(`Environment must be ci, developer, or unknown.\n${usage()}`)
    }
    const reports = await readPerformanceReports(reportDirectory)
    await writeJson(createPerformanceBaseline(reports, { environment, machineClass }), output)
    return
  }
  if (command === 'compare') {
    if (!source || !candidateSource) {
      throw new Error(`A baseline file and --candidate report directory are required.\n${usage()}`)
    }
    const baseline = JSON.parse(await fs.readFile(resolveInputPath(source), 'utf8')) as PerformanceBaseline
    const candidateReports = await readCandidatePerformanceReports(candidateSource)
    const comparison = comparePerformanceBaseline(baseline, candidateReports, {
      environment: environment ?? baseline.environment.kind,
      machineClass: machineClass ?? baseline.environment.machineClass
    })
    await writeJson(comparison, output)
    if (!comparison.valid) throw new Error('Performance comparison validation failed')
    if (comparison.regression) throw new Error('Performance regression detected')
    return
  }
  if (command === 'validate') {
    const reportDirectory = source ?? process.env.MARKTEXT_PERF_REPORT_DIR
    if (!reportDirectory)
      throw new Error(
        `A report directory is required (or set MARKTEXT_PERF_REPORT_DIR).\n${usage()}`
      )
    const reports = await readPerformanceReports(reportDirectory)
    await writeJson(
      {
        version: PERFORMANCE_REPORT_VERSION,
        valid: true,
        sourceDirectory: '<report-dir>',
        reportCount: reports.length
      },
      output
    )
    return
  }
  if (command === 'chunks' || command === 'chunk-report') {
    await writeJson(await collectChunkSizes(source ?? 'packages/desktop/out/renderer'), output)
    return
  }
  throw new Error(`Unknown command '${command}'\n${usage()}`)
}
if (process.argv[1] && /performance-report(?:\.ts|\.js)$/.test(process.argv[1])) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
