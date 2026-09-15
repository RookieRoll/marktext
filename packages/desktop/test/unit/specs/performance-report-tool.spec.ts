import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectChunkSizes,
  PERFORMANCE_SCENARIO_DEFINITIONS,
  createBlankEditorReport,
  createPerformanceBaseline,
  comparePerformanceBaseline,
  getPerformanceScenario,
  PERFORMANCE_SLICE_ROLLBACK_CONTRACTS,
  validatePerformanceSliceRollbackContract,
  readPerformanceReports,
  summarizeReports,
  validatePerformanceBaseline,
  validatePerformanceScenarioRun,
  validateReportPrivacy,
  writePerformanceReport,
  percentile,
  type PerformanceReport
} from '../../../../../scripts/performance-report'

const temporaryDirectories: string[] = []

const makeReport = (
  runId: string,
  startedAt: string,
  appReady: number,
  rssBytes: number
): PerformanceReport => ({
  version: 1,
  runId,
  scenario: 'cold-editor',
  startedAt,
  build: {
    id: 'build-a',
    version: '0.20.0-dev',
    platform: 'win32',
    arch: 'x64',
    electron: '42.1.0',
    chrome: '134',
    node: '22'
  },
  milestones: { 'app-ready': appReady },
  resources: { initialJsBytes: appReady },
  memory: [{ atMs: appReady, process: 'main', rssBytes }],
  counters: { windows: 1, tabs: 1 }
})

const makeComparableReport = (
  runId: string,
  startedAt: string,
  buildId: string,
  scale: number
): PerformanceReport => ({
  version: 1,
  runId,
  scenario: 'multi-tab',
  startedAt,
  build: {
    id: buildId,
    version: '0.20.0-dev',
    platform: 'win32',
    arch: 'x64',
    electron: '42.1.0',
    chrome: '134',
    node: '22'
  },
  milestones: {
    'app-ready': 100 * scale,
    'first-window-created': 120 * scale,
    'editor-interactive': 180 * scale
  },
  resources: {
    initialJsBytes: 1000 * scale,
    initialCssBytes: 200 * scale,
    dynamicChunkLoadMs: 50 * scale
  },
  memory: (['main', 'preload', 'renderer'] as const).map((process, index) => ({
    atMs: 200 * scale + index,
    process,
    rssBytes: (1000 + index * 100) * scale,
    heapUsedBytes: (400 + index * 40) * scale,
    heapTotalBytes: (800 + index * 80) * scale
  })),
  counters: { windows: 1, tabs: 4 }
})

const makeTempDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(join(process.env.TEMP ?? process.cwd(), 'marktext-perf-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('performance report tool', () => {
  it('defines repeatable scenarios and validates the anonymous blank-editor smoke report', async () => {
    const scenario = getPerformanceScenario('large-document')
    expect(scenario).toMatchObject({
      name: 'large-document',
      repeat: { minimumRuns: 3, restartBetweenRuns: true },
      fixedInputs: { windows: 1, tabs: 1, documentSizeKiB: 1024 }
    })

    const report = createBlankEditorReport({
      runId: 'smoke-run',
      startedAt: '2026-09-09T03:00:00.000Z',
      buildId: 'build-smoke'
    })
    expect(validatePerformanceScenarioRun(report)).toEqual([])
    expect(JSON.stringify(report)).not.toMatch(/path|markdown|body|content|text/i)

    const directory = await makeTempDirectory()
    const output = join(directory, 'blank-editor.json')
    await writePerformanceReport(report, output)
    expect(JSON.parse(await fs.readFile(output, 'utf8'))).toMatchObject({
      scenario: 'blank-editor',
      build: { id: 'build-smoke' }
    })
  })

  it('defines complete memory measurement contracts for all lifecycle scenarios', () => {
    const expected = new Map([
      ['blank-editor', { windows: 1, tabs: 1, minimumSamplesPerProcess: 1 }],
      ['multi-tab', { windows: 1, tabs: 4, minimumSamplesPerProcess: 1 }],
      ['large-document', { windows: 1, tabs: 1, minimumSamplesPerProcess: 1 }],
      ['close-tab', { windows: 1, tabs: 2, minimumSamplesPerProcess: 2 }],
      ['close-window', { windows: 1, tabs: 2, minimumSamplesPerProcess: 2 }],
      ['app-recovery', { windows: 1, tabs: 3, minimumSamplesPerProcess: 1 }]
    ])

    for (const [name, inputs] of expected) {
      const scenario = getPerformanceScenario(name)
      expect(scenario?.memoryMeasurement, name).toMatchObject({
        requiredProcesses: ['main', 'preload', 'renderer'],
        requiredMemoryMetrics: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
        requiredHeapMetrics: ['heapUsedBytes', 'heapTotalBytes'],
        minimumSamplesPerProcess: inputs.minimumSamplesPerProcess
      })
      expect(scenario?.fixedInputs).toMatchObject({
        windows: inputs.windows,
        tabs: inputs.tabs
      })
    }

    expect(
      PERFORMANCE_SCENARIO_DEFINITIONS.filter((scenario) => scenario.memoryMeasurement).map(
        (scenario) => scenario.name
      )
    ).toEqual(expect.arrayContaining([...expected.keys()]))
  })

  it('strictly validates process memory, JS heap, windows, and tab measurements', () => {
    const scenario = getPerformanceScenario('close-tab')
    expect(scenario).toBeDefined()
    const milestones = Object.fromEntries(
      (scenario?.requiredMilestones ?? []).map((milestone, index) => [milestone, index + 1])
    )
    const sample = (process: 'main' | 'preload' | 'renderer', atMs: number) => ({
      atMs,
      process,
      rssBytes: 100 + atMs,
      heapUsedBytes: 40 + atMs,
      heapTotalBytes: 80 + atMs
    })
    const complete: PerformanceReport = {
      ...makeReport('close-tab-run', '2026-09-09T07:00:00.000Z', 1, 100),
      scenario: 'close-tab',
      milestones,
      memory: [
        sample('main', 1),
        sample('main', 2),
        sample('preload', 1),
        sample('preload', 2),
        sample('renderer', 1),
        sample('renderer', 2)
      ],
      counters: { windows: 1, tabs: 2 }
    }

    expect(validatePerformanceScenarioRun(complete)).toEqual([])

    const duplicateTimestamp = {
      ...complete,
      memory: complete.memory.map((entry) => ({ ...entry, atMs: 1 }))
    }
    expect(validatePerformanceScenarioRun(duplicateTimestamp)).toContain(
      'memory.main: requires distinct before/after timestamps for close-tab'
    )

    const missingPreload = {
      ...complete,
      memory: complete.memory.filter((entry) => entry.process !== 'preload')
    }
    expect(validatePerformanceScenarioRun(missingPreload)).toContain(
      'memory.preload: requires at least 2 sample(s) for close-tab'
    )

    const missingHeap = {
      ...complete,
      memory: complete.memory.map((entry) =>
        entry.process === 'renderer'
          ? { ...entry, heapUsedBytes: undefined, heapTotalBytes: undefined }
          : entry
      )
    }
    expect(validatePerformanceScenarioRun(missingHeap)).toEqual(
      expect.arrayContaining([
        'memory.renderer.heapUsedBytes: required for every sample of close-tab',
        'memory.renderer.heapTotalBytes: required for every sample of close-tab'
      ])
    )

    expect(
      validatePerformanceScenarioRun({ ...complete, counters: { windows: 2, tabs: 3 } })
    ).toEqual(
      expect.arrayContaining([
        'counters.windows: expected 1 for close-tab',
        'counters.tabs: expected 2 for close-tab'
      ])
    )

    const invalidHeap = {
      ...complete,
      memory: complete.memory.map((entry, index) =>
        index === 0 ? { ...entry, heapUsedBytes: 1000, heapTotalBytes: 10 } : entry
      )
    }
    expect(validatePerformanceScenarioRun(invalidHeap)).toContain(
      'memory.main: heapUsedBytes must not exceed heapTotalBytes'
    )
  })

  it('marks incomplete repeated samples exploratory and records outlier candidates', () => {
    const reports = [100, 110, 105, 1000].map((value, index) =>
      makeReport(`run-${index}`, `2026-09-09T01:0${index}:00.000Z`, value, value * 10)
    )
    const baseline = createPerformanceBaseline(reports, {
      environment: 'developer',
      machineClass: 'windows-dev',
      generatedAt: '2026-09-09T04:00:00.000Z'
    })
    expect(baseline.environment).toEqual({ kind: 'developer', machineClass: 'windows-dev' })
    expect(baseline.strategy).toEqual({
      purpose: 'fixed-machine local comparison',
      regressionGate: false,
      machineClassRequired: true,
      minimumRuns: 3
    })
    expect(baseline.provenance).toMatchObject({
      reportCount: 4,
      buildIds: ['build-a'],
      scenarios: ['cold-editor'],
      runIds: ['run-0', 'run-1', 'run-2', 'run-3']
    })
    expect(baseline.policy).toMatchObject({
      minimumRuns: 3,
      startupP95RegressionFraction: 0.1,
      memoryAndSizeP95RegressionFraction: 0.15
    })
    expect(baseline.groups[0]).toMatchObject({
      status: 'exploratory',
      sampleCount: 4,
      validation: { requiredMilestonesPresent: false }
    })
    expect(baseline.groups[0].milestones['app-ready'].outlierCandidateIndexes).toEqual([3])
    expect(validatePerformanceBaseline(baseline)).toEqual([])
  })

  it('uses a stricter CI sample policy and rejects broken provenance or outlier indexes', () => {
    const reports = [0, 1, 2].map((index) =>
      createBlankEditorReport({
        runId: `ci-run-${index}`,
        startedAt: `2026-09-09T02:0${index}:00.000Z`,
        buildId: 'build-ci'
      })
    )
    const baseline = createPerformanceBaseline(reports, {
      environment: 'ci',
      machineClass: 'windows-ci',
      generatedAt: '2026-09-09T04:30:00.000Z'
    })
    expect(baseline.strategy).toEqual({
      purpose: 'dedicated-runner regression gate',
      regressionGate: true,
      machineClassRequired: true,
      minimumRuns: 5
    })
    expect(baseline.policy.minimumRuns).toBe(5)
    expect(baseline.groups[0].status).toBe('exploratory')
    expect(validatePerformanceBaseline(baseline)).toEqual([])

    const broken = JSON.parse(JSON.stringify(baseline)) as typeof baseline
    broken.provenance.buildIds = ['different-build']
    broken.groups[0].milestones['main-process-start'].outlierCandidateIndexes = [99]
    const errors = validatePerformanceBaseline(broken)
    expect(errors).toContain('baseline.provenance.buildIds: must match group build identities')
    expect(errors).toContain(
      'baseline.groups[0].milestones.main-process-start.outlierCandidateIndexes: expected indexes within samples'
    )
  })

  it('requires all scenario milestones before a baseline can be a candidate', () => {
    const incomplete = makeReport('run-incomplete', '2026-09-09T01:00:00.000Z', 100, 1000)
    const errors = validatePerformanceScenarioRun(incomplete)
    expect(errors).toContain('milestones.main-process-start: required for cold-editor')
    const baseline = createPerformanceBaseline([incomplete, incomplete, incomplete])
    expect(baseline.groups[0].status).toBe('exploratory')
    expect(baseline.groups[0].validation.requiredMilestonesPresent).toBe(false)
  })
  it('compares candidate slices against a reproducible baseline with p95 thresholds', () => {
    const baselineReports = [1, 1.05, 0.95].map((scale, index) =>
      makeComparableReport(
        `baseline-${index}`,
        `2026-09-09T08:0${index}:00.000Z`,
        'build-a',
        scale
      )
    )
    const candidateReports = [0.8, 0.82, 0.78].map((scale, index) =>
      makeComparableReport(
        `candidate-${index}`,
        `2026-09-09T09:0${index}:00.000Z`,
        'build-b',
        scale
      )
    )
    const baseline = createPerformanceBaseline(baselineReports, {
      environment: 'developer',
      machineClass: 'windows-dev',
      generatedAt: '2026-09-09T10:00:00.000Z'
    })

    const comparison = comparePerformanceBaseline(baseline, candidateReports, {
      environment: 'developer',
      machineClass: 'windows-dev',
      generatedAt: '2026-09-09T10:01:00.000Z'
    })

    expect(comparison).toMatchObject({
      valid: true,
      regression: false,
      comparisonBasis: 'relative-to-baseline-p95',
      baseline: { buildIds: ['build-a'], runIds: ['baseline-0', 'baseline-1', 'baseline-2'] },
      candidate: { buildIds: ['build-b'], runIds: ['candidate-0', 'candidate-1', 'candidate-2'] }
    })
    expect(comparison.slices).toHaveLength(1)
    expect(comparison.slices[0]).toMatchObject({
      scenario: 'multi-tab',
      baselineKey: 'multi-tab/build-a',
      baselineRunIds: ['baseline-0', 'baseline-1', 'baseline-2'],
      candidateRunIds: ['candidate-0', 'candidate-1', 'candidate-2'],
      regression: false
    })
    expect(comparison.slices[0].metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: 'resources.initialJsBytes', regressed: false }),
        expect.objectContaining({ metric: 'resources.dynamicChunkLoadMs', kind: 'first-use' }),
        expect.objectContaining({ metric: 'memory.main.rssBytes', kind: 'memory' })
      ])
    )
  })

  it('rejects mismatched runtime identity, fixed inputs, and missing comparison metrics', () => {
    const baselineReports = [1, 1.01, 0.99].map((scale, index) =>
      makeComparableReport(
        `baseline-mismatch-${index}`,
        `2026-09-09T11:0${index}:00.000Z`,
        'build-a',
        scale
      )
    )
    const baseline = createPerformanceBaseline(baselineReports, {
      environment: 'developer',
      machineClass: 'windows-dev'
    })
    const mismatchedCandidate = [1, 1.01, 0.99].map((scale, index) => ({
      ...makeComparableReport(
        `candidate-mismatch-${index}`,
        `2026-09-09T12:0${index}:00.000Z`,
        'build-b',
        scale
      ),
      build: {
        ...makeComparableReport('unused', '2026-09-09T00:00:00.000Z', 'build-b', scale).build,
        chrome: 'different'
      },
      counters: { windows: 2, tabs: 4 },
      resources: { initialJsBytes: 1000 * scale, dynamicChunkLoadMs: 50 * scale }
    }))
    const missingResource = {
      ...makeComparableReport('candidate-missing', '2026-09-09T12:03:00.000Z', 'build-b', 1),
      resources: { initialJsBytes: 1000, dynamicChunkLoadMs: 50 }
    }

    const comparison = comparePerformanceBaseline(
      baseline,
      [...mismatchedCandidate.slice(0, 2), missingResource],
      { environment: 'developer', machineClass: 'windows-dev' }
    )

    expect(comparison.valid).toBe(false)
    expect(comparison.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('build runtime mismatch for chrome'),
        expect.stringContaining('fixed input windows mismatch'),
        expect.stringContaining('missing comparable metric resources.initialCssBytes')
      ])
    )
  })

  it('records a rollback contract for the sidebar large-project optimization', () => {
    const sidebar = PERFORMANCE_SLICE_ROLLBACK_CONTRACTS.find(
      (contract) => contract.name === 'sidebar-large-project'
    )
    expect(sidebar).toBeDefined()
    // The optimized watcher / tree / virtualization files are isolated, so a
    // regression can roll the slice back without losing the measurement or
    // behavior evidence that diagnosed it.
    expect(sidebar!.optimizationFiles).toContain(
      'packages/desktop/src/main/filesystem/watcher.ts'
    )
    expect(sidebar!.optimizationFiles).toContain(
      'packages/desktop/src/renderer/src/components/sideBar/tree.vue'
    )
    expect(sidebar!.measurementFiles).toContain(
      'packages/desktop/test/unit/specs/sidebar-virtual-rows.spec.ts'
    )
    expect(sidebar!.measurementFiles).toContain(
      'packages/desktop/test/unit/specs/watcher-initial-snapshot.spec.ts'
    )
    expect(sidebar!.behaviorTests).toContain(
      'packages/desktop/test/unit/specs/sidebar-new-file-content.spec.ts'
    )
    expect(sidebar!.behaviorTests).toContain(
      'packages/desktop/test/unit/specs/project-tree-snapshot.spec.ts'
    )
  })

  it('records a rollback contract for the sidebar large-project optimization', () => {
    const sidebar = PERFORMANCE_SLICE_ROLLBACK_CONTRACTS.find(
      (contract) => contract.name === 'sidebar-large-project'
    )
    expect(sidebar).toBeDefined()
    // The optimized watcher / tree / virtualization files are isolated, so a
    // regression can roll the slice back without losing the measurement or
    // behavior evidence that diagnosed it.
    expect(sidebar?.optimizationFiles).toContain(
      'packages/desktop/src/main/filesystem/watcher.ts'
    )
    expect(sidebar?.optimizationFiles).toContain(
      'packages/desktop/src/renderer/src/components/sideBar/tree.vue'
    )
    expect(sidebar?.measurementFiles).toContain(
      'packages/desktop/test/unit/specs/sidebar-virtual-rows.spec.ts'
    )
    expect(sidebar?.measurementFiles).toContain(
      'packages/desktop/test/unit/specs/watcher-initial-snapshot.spec.ts'
    )
    expect(sidebar?.behaviorTests).toContain(
      'packages/desktop/test/unit/specs/sidebar-new-file-content.spec.ts'
    )
    expect(sidebar?.behaviorTests).toContain(
      'packages/desktop/test/unit/specs/project-tree-snapshot.spec.ts'
    )
  })

  it('keeps measurement and behavior evidence outside optimization slice rollback boundaries', () => {
    expect(validatePerformanceSliceRollbackContract()).toEqual([])
    for (const contract of PERFORMANCE_SLICE_ROLLBACK_CONTRACTS) {
      const optimizationFiles = new Set(contract.optimizationFiles)
      expect([...contract.measurementFiles, ...contract.behaviorTests]).not.toEqual(
        expect.arrayContaining([...optimizationFiles])
      )
    }
  })
  it('uses deterministic percentiles and keeps empty metrics empty', () => {
    expect(percentile([30, 10, 20], 0.5)).toBe(20)
    expect(percentile([10, 20, 30, 40], 0.95)).toBe(38.5)
    expect(percentile([], 0.95)).toBeNull()
  })

  it('groups raw runs by scenario and build and summarizes metrics', () => {
    const summary = summarizeReports(
      [
        makeReport('run-2', '2026-09-09T01:01:00.000Z', 110, 1200),
        makeReport('run-1', '2026-09-09T01:00:00.000Z', 100, 1000)
      ],
      '2026-09-09T02:00:00.000Z'
    )

    expect(summary.sourceDirectory).toBe('<report-dir>')
    expect(summary.groups).toHaveLength(1)
    expect(summary.groups[0].key).toBe('cold-editor/build-a')
    expect(summary.groups[0].runs.map((run) => run.runId)).toEqual(['run-1', 'run-2'])
    expect(summary.groups[0].milestones['app-ready']).toEqual({
      samples: [100, 110],
      p50: 105,
      p95: 109.5
    })
    expect(summary.groups[0].memory['main.rssBytes']).toEqual({
      samples: [1000, 1200],
      p50: 1100,
      p95: 1190
    })
  })

  it('keeps every repeated raw sample and produces a deterministic summary for one build', async () => {
    const directory = await makeTempDirectory()
    const reports = [100, 110, 105].map((value, index) =>
      makeReport(`repeat-${index + 1}`, `2026-09-09T05:0${index}:00.000Z`, value, value * 10)
    )
    await Promise.all(
      reports.map((report) =>
        fs.writeFile(join(directory, `${report.runId}.json`), `${JSON.stringify(report)}\n`)
      )
    )

    const loaded = await readPerformanceReports(directory)
    const summary = summarizeReports(loaded, '2026-09-09T06:00:00.000Z')
    expect(loaded.map((report) => report.runId)).toEqual(['repeat-1', 'repeat-2', 'repeat-3'])
    expect(summary.groups[0]).toMatchObject({
      key: 'cold-editor/build-a',
      sampleCount: 3,
      runs: reports,
      milestones: {
        'app-ready': { samples: [100, 110, 105], p50: 105, p95: 109.5 }
      }
    })
  })
  it('reads JSON reports, ignores non-JSON files, and rejects privacy violations', async () => {
    const directory = await makeTempDirectory()
    await fs.writeFile(
      join(directory, 'run.json'),
      JSON.stringify(makeReport('run-1', '2026-09-09T01:00:00.000Z', 100, 1000))
    )
    await fs.writeFile(join(directory, 'notes.txt'), 'ignored')
    expect((await readPerformanceReports(directory)).map((report) => report.runId)).toEqual([
      'run-1'
    ])

    expect(
      validateReportPrivacy({
        resources: { documentPath: 'C:\\Users\\alice\\Documents\\private.md' }
      })
    ).toHaveLength(1)
    await fs.writeFile(
      join(directory, 'private.json'),
      JSON.stringify({
        ...makeReport('run-2', '2026-09-09T01:01:00.000Z', 110, 1100),
        documentPath: 'C:\\private.md'
      })
    )
    await expect(readPerformanceReports(directory)).rejects.toThrow(
      /Privacy validation failed for 'private\.json'/
    )
  })

  it('classifies HTML entry JS/CSS separately from dynamic assets using relative paths', async () => {
    const directory = await makeTempDirectory()
    await fs.mkdir(join(directory, 'assets'))
    await fs.writeFile(
      join(directory, 'index.html'),
      '<script type="module" src="./assets/index.js"></script><link rel="stylesheet" href="./assets/index.css">'
    )
    await fs.writeFile(join(directory, 'assets', 'index.js'), '12345')
    await fs.writeFile(join(directory, 'assets', 'index.css'), '123')
    await fs.writeFile(join(directory, 'assets', 'settings.js'), '1234567')
    await fs.writeFile(join(directory, 'assets', 'settings.css'), '12')

    const report = await collectChunkSizes(directory)
    expect(report.entryFiles.map((file) => file.path)).toEqual([
      'assets/index.css',
      'assets/index.js'
    ])
    expect(report.dynamicChunks.map((file) => file.path)).toEqual([
      'assets/settings.css',
      'assets/settings.js'
    ])
    expect(report.totals).toMatchObject({
      initialJsBytes: 5,
      initialCssBytes: 3,
      dynamicJsBytes: 7,
      dynamicCssBytes: 2
    })
    expect(report.sourceDirectory).toBe('<renderer-dir>')
    expect(
      report.files.every((file) => !file.path.includes('\\') && !file.path.match(/^[A-Za-z]:/))
    ).toBe(true)
  })
})
