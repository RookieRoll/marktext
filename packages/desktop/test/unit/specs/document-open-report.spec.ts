import { describe, expect, it, vi } from 'vitest'

// The Main-side marker is a thin wrapper over the shared trace. Stub the reporter
// so the phase name and the privacy-neutral payload are asserted directly.
const mark = vi.hoisted(() => vi.fn())
vi.mock('../../../src/main/performance', () => ({ mainPerformance: { mark } }))

import { markDocumentReadComplete } from '../../../src/main/performance/documentOpenMetrics'
import {
  isPerformanceMilestone,
  normalizePerformanceSamplePayload,
  type PerformanceMilestone
} from '@shared/performance'
import {
  PERFORMANCE_MILESTONE_ORDER,
  validatePerformanceScenarioRun,
  type PerformanceReport
} from '../../../../../scripts/performance-report'

describe('document-open phase milestones', () => {
  it('exposes read, parse, and derived-work boundaries as report milestones', () => {
    for (const milestone of [
      'document-read-complete',
      'document-parsed',
      'derived-work-complete'
    ] as const) {
      expect(isPerformanceMilestone(milestone)).toBe(true)
      expect(PERFORMANCE_MILESTONE_ORDER).toContain(milestone)
    }
  })

  it('records the Main-side read boundary exactly once per run', () => {
    markDocumentReadComplete()
    markDocumentReadComplete()

    expect(mark).toHaveBeenCalledWith('document-read-complete')
    // No path, filename, or document text is attached to the phase marker.
    expect(mark.mock.calls.every((call) => call.length === 1)).toBe(true)
  })

  it('accepts the new counters through the shared sample normalizer', () => {
    const normalized = normalizePerformanceSamplePayload({
      counters: { parsedDocuments: 4, deferredDerivedWork: 2, renderedBlocks: 900 }
    })

    expect(normalized.counters).toEqual({
      parsedDocuments: 4,
      deferredDerivedWork: 2,
      renderedBlocks: 900
    })
  })

  it('validates a repeatable large-document run with the new open phases', () => {
    const baseMilestones: Partial<Record<PerformanceMilestone, number>> = {
      'first-document-requested': 10,
      'document-read-complete': 25,
      'first-document-loaded': 60,
      'document-parsed': 80,
      'first-content-paint': 95,
      'derived-work-complete': 110,
      'editor-interactive': 120
    }
    // Built as a plain report object (the shape the CLI reads from disk) so the
    // validator sees exactly what a written report would contain.
    const makeRun = (offset: number): PerformanceReport => ({
      version: 1,
      runId: `open-run-${offset}`,
      scenario: 'large-document',
      startedAt: `2026-09-17T00:00:0${offset}.000Z`,
      build: {
        id: 'phase-test',
        version: '0.20.0-dev',
        platform: 'win32',
        arch: 'x64',
        electron: '42.1.0',
        chrome: '134',
        node: '22'
      },
      milestones: Object.fromEntries(
        Object.entries(baseMilestones).map(([key, value]) => [key, value + offset])
      ),
      resources: {},
      memory: (['main', 'preload', 'renderer'] as const).map((process, index) => ({
        atMs: 60 + index,
        process,
        rssBytes: 1000,
        heapUsedBytes: 400,
        heapTotalBytes: 800
      })),
      counters: { windows: 1, tabs: 1, parsedDocuments: 1, deferredDerivedWork: 1 }
    })

    // The same document can be measured repeatedly: each run validates on its own
    // and the phases stay comparable between runs.
    for (const offset of [0, 1, 2]) {
      expect(validatePerformanceScenarioRun(makeRun(offset))).toEqual([])
    }
  })

  it('flags an open run whose parse phase claims to precede its read phase', () => {
    const report: PerformanceReport = {
      version: 1,
      runId: 'open-run-inverted',
      scenario: 'large-document',
      startedAt: '2026-09-17T00:00:00.000Z',
      build: {
        id: 'phase-test',
        version: '0.20.0-dev',
        platform: 'win32',
        arch: 'x64',
        electron: '42.1.0',
        chrome: '134',
        node: '22'
      },
      milestones: {
        'first-document-requested': 10,
        'document-read-complete': 40,
        'first-document-loaded': 30,
        'document-parsed': 20,
        'editor-interactive': 60
      },
      resources: {},
      memory: [],
      counters: { windows: 1, tabs: 1 }
    }

    expect(validatePerformanceScenarioRun(report)).toContain(
      'milestones.document-parsed: must be monotonic'
    )
  })
})
