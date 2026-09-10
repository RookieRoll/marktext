import { describe, expect, it } from 'vitest'
import {
  createPerformanceReport,
  normalizePerformanceScenario,
  PerformanceTrace,
  normalizePerformanceSamplePayload,
  type PerformanceReportInput
} from '@shared/performance'

describe('performance telemetry model', () => {
  it('creates a report with normalized scenario and supplied measurements', () => {
    const report = createPerformanceReport({
      runId: 'run-test',
      scenario: '  cold-editor ',
      startedAt: '2026-09-08T00:00:00.000Z',
      build: {
        id: 'dev-build',
        platform: 'win32'
      },
      milestones: {
        'main-init': 18
      },
      resources: {
        initialJsBytes: 1024
      },
      memory: [
        {
          atMs: 25,
          process: 'main',
          rssBytes: 2048
        }
      ],
      counters: {
        windows: 1,
        tabs: 2
      }
    })

    expect(report).toMatchObject({
      version: 1,
      runId: 'run-test',
      scenario: 'cold-editor',
      startedAt: '2026-09-08T00:00:00.000Z',
      build: {
        id: 'dev-build',
        platform: 'win32',
        version: 'unknown',
        arch: 'unknown',
        electron: 'unknown',
        chrome: 'unknown',
        node: 'unknown'
      },
      milestones: { 'main-init': 18 },
      resources: { initialJsBytes: 1024 },
      memory: [{ atMs: 25, process: 'main', rssBytes: 2048 }],
      counters: { windows: 1, tabs: 2 }
    })
  })

  it('keeps only the first timestamp for each milestone', () => {
    const trace = new PerformanceTrace(() => 1_000, '2026-09-08T00:00:00.000Z')

    trace.mark('renderer-start', 1_049.6)
    trace.mark('renderer-start', 1_250)
    trace.mark('first-paint', 1_100)

    const report = trace.snapshot({
      runId: 'run-trace',
      scenario: 'cold-editor'
    })

    expect(report.startedAt).toBe('2026-09-08T00:00:00.000Z')
    expect(report.milestones).toEqual({
      'renderer-start': 50,
      'first-paint': 100
    })
  })

  it('normalizes supported, padded, unknown, and non-string scenarios', () => {
    expect(normalizePerformanceScenario('  large-document ')).toBe('large-document')
    expect(normalizePerformanceScenario('not-a-scenario')).toBe('unknown')
    expect(normalizePerformanceScenario('')).toBe('unknown')
    expect(normalizePerformanceScenario(undefined)).toBe('blank-editor')
  })

  it('sanitizes renderer samples to anonymous finite metrics', () => {
    expect(
      normalizePerformanceSamplePayload({
        memory: { heapUsedBytes: 12.8, externalBytes: -1, documentPath: 'C:\\private.md' },
        resources: { initialJsBytes: 42, initialCssBytes: Number.NaN, markdown: '# secret' },
        counters: { windows: 2, tabs: Infinity, pathname: '/private' },
        body: '# secret'
      })
    ).toEqual({
      memory: { heapUsedBytes: 13 },
      resources: { initialJsBytes: 42 },
      counters: { windows: 2 }
    })
  })

  it('does not include document paths or Markdown bodies in the report shape or JSON', () => {
    const documentPath = 'C:\\Users\\alice\\Documents\\private.md'
    const markdownBody = '# Private document content'
    const input = {
      runId: 'run-private',
      scenario: 'blank-editor',
      path: documentPath,
      body: markdownBody,
      documentPath,
      markdown: markdownBody
    } as unknown as PerformanceReportInput

    const report = createPerformanceReport(input)
    const serializedReport = JSON.stringify(report)

    expect(Object.keys(report)).not.toEqual(
      expect.arrayContaining(['path', 'body', 'documentPath', 'markdown'])
    )
    expect(serializedReport).not.toContain(documentPath)
    expect(serializedReport).not.toContain(markdownBody)
  })
})
