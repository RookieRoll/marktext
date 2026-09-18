import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import log from 'electron-log'
import {
  PerformanceTrace,
  type PerformanceMilestone,
  type PerformanceReport,
  type PerformanceResourceMetrics,
  type PerformanceMemorySample,
  type PerformanceCounters,
  type PerformanceSamplePayload
} from '@shared/performance'
import {
  createPerformanceRollbackState,
  type PerformanceRollbackSlice
} from '@shared/performanceRollback'

const isPerformanceTesting = (): boolean => process.env.PERF_TESTING === 'true'

const performanceRollback = createPerformanceRollbackState()

if (performanceRollback.rolledBack.length > 0) {
  log.info(`Performance slices rolled back: ${performanceRollback.rolledBack.join(', ')}`)
}

/** Whether a performance slice may use its optimized path in this process. */
export const isPerformanceSliceEnabled = (slice: PerformanceRollbackSlice): boolean =>
  performanceRollback.enabled(slice)

const getBuildIdentity = () => ({
  id: process.env.MARKTEXT_VERSION_STRING ?? 'unknown',
  version: process.env.MARKTEXT_VERSION ?? 'unknown',
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron ?? 'unknown',
  chrome: process.versions.chrome ?? 'unknown',
  node: process.versions.node ?? 'unknown'
})

const getReportDirectory = (): string | null => {
  const configuredDirectory = process.env.MARKTEXT_PERF_REPORT_DIR?.trim()
  if (configuredDirectory) return path.resolve(configuredDirectory)
  if (!app.isReady()) return null
  return path.join(app.getPath('userData'), 'performance-reports')
}

const getSafeReportName = (report: PerformanceReport): string =>
  `marktext-${report.scenario}-${report.runId}.json`

class MainPerformanceReporter {
  private readonly trace = new PerformanceTrace()
  private resources: PerformanceResourceMetrics = {}
  private memory: PerformanceMemorySample[] = []
  private counters: PerformanceCounters = {}
  private writePromise: Promise<string | null> | null = null
  private reportWritten = false

  mark(milestone: PerformanceMilestone): void {
    if (!isPerformanceTesting()) return
    this.trace.mark(milestone)
  }

  elapsedMs(): number {
    return this.trace.elapsedMs()
  }

  sampleMain(counters?: PerformanceCounters): void {
    if (!isPerformanceTesting()) return
    const usage = process.memoryUsage()
    this.addMemorySample({
      atMs: this.elapsedMs(),
      process: 'main',
      rssBytes: usage.rss,
      heapUsedBytes: usage.heapUsed,
      heapTotalBytes: usage.heapTotal,
      externalBytes: usage.external
    })
    if (counters) this.setCounters(counters)
  }

  sampleRenderer(payload: PerformanceSamplePayload): void {
    if (!isPerformanceTesting()) return
    if (payload.resources) this.setResources(payload.resources)
    if (payload.counters) this.setCounters(payload.counters)
    if (payload.memory) {
      this.addMemorySample({
        ...payload.memory,
        atMs: this.elapsedMs(),
        process: 'renderer'
      })
    }
  }

  setResources(resources: PerformanceResourceMetrics): void {
    if (!isPerformanceTesting()) return
    this.resources = { ...this.resources, ...resources }
  }

  addMemorySample(sample: PerformanceMemorySample): void {
    if (!isPerformanceTesting()) return
    this.memory.push({ ...sample })
  }

  setCounters(counters: PerformanceCounters): void {
    if (!isPerformanceTesting()) return
    this.counters = { ...this.counters, ...counters }
  }

  getReport(): PerformanceReport {
    return this.trace.snapshot({
      scenario: process.env.MARKTEXT_PERF_SCENARIO,
      build: getBuildIdentity(),
      resources: this.resources,
      memory: this.memory,
      counters: this.counters
    })
  }

  writeReport(): Promise<string | null> {
    if (!isPerformanceTesting()) return Promise.resolve(null)
    if (this.reportWritten) return Promise.resolve(null)
    if (this.writePromise) return this.writePromise

    this.writePromise = (async () => {
      const directory = getReportDirectory()
      if (!directory) return null

      try {
        const report = this.getReport()
        await fs.mkdir(directory, { recursive: true })
        const reportPath = path.join(directory, getSafeReportName(report))
        await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
        this.reportWritten = true
        return reportPath
      } catch (error) {
        log.error('Unable to write performance report:', error)
        return null
      }
    })().finally(() => {
      this.writePromise = null
    })

    return this.writePromise
  }
}

export const mainPerformance = new MainPerformanceReporter()
mainPerformance.mark('main-process-start')
