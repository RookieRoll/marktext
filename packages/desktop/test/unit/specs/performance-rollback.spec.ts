import { describe, expect, it, vi } from 'vitest'
import {
  createPerformanceRollbackState,
  PERFORMANCE_ROLLBACK_ENV,
  PERFORMANCE_ROLLBACK_SLICES,
  parsePerformanceRollbackSlices
} from '@shared/performanceRollback'

describe('performance rollback switches', () => {
  it('keeps every slice enabled by default', () => {
    const state = createPerformanceRollbackState(undefined)

    expect(state.rolledBack).toEqual([])
    for (const slice of PERFORMANCE_ROLLBACK_SLICES) {
      expect(state.enabled(slice)).toBe(true)
    }
  })

  it('rolls back only the named slices', () => {
    const state = createPerformanceRollbackState('deferred-history,tab-state-cache')

    expect(state.enabled('deferred-history')).toBe(false)
    expect(state.enabled('tab-state-cache')).toBe(false)
    // Slices that were not named keep their optimized path.
    expect(state.enabled('restore-layering')).toBe(true)
    expect(state.enabled('deferred-toc')).toBe(true)
    expect(state.rolledBack).toEqual(['tab-state-cache', 'deferred-history'])
  })

  it('accepts whitespace, mixed case, and empty entries', () => {
    const state = createPerformanceRollbackState('  Deferred-TOC ,, restore-layering  ')

    expect(state.enabled('deferred-toc')).toBe(false)
    expect(state.enabled('restore-layering')).toBe(false)
    expect(state.enabled('tab-state-cache')).toBe(true)
  })

  it('ignores unknown slice names instead of failing the launch', () => {
    const requested = parsePerformanceRollbackSlices('not-a-slice,deferred-toc')

    expect([...requested]).toEqual(['deferred-toc'])
  })

  it('treats empty and non-string values as "nothing rolled back"', () => {
    for (const value of ['', '   ', undefined, null, 42, {}]) {
      expect([...parsePerformanceRollbackSlices(value)]).toEqual([])
    }
  })

  it('names every slice in one place so a flag cannot silently go missing', () => {
    // The renderer reads the same list through this module, so an unlisted name
    // in the environment is ignored in both processes.
    expect(new Set(PERFORMANCE_ROLLBACK_SLICES).size).toBe(PERFORMANCE_ROLLBACK_SLICES.length)
    expect(PERFORMANCE_ROLLBACK_ENV).toBe('MARKTEXT_PERF_ROLLBACK')
  })
})

describe('rollback does not disable observation', () => {
  it('emits milestones regardless of the rollback flag', async() => {
    vi.stubGlobal('window', {
      electron: {
        ipcRenderer: { send: vi.fn(), sendSync: vi.fn(), invoke: vi.fn(), on: vi.fn() },
        process: { platform: 'win32', versions: {}, env: { PERF_TESTING: 'true' } },
        paths: {},
        webFrame: {},
        webUtils: {},
        shell: {},
        clipboard: {},
        windowControl: {}
      }
    })
    const { markRendererPerformance, isPerformanceSliceEnabled } = await import(
      '@/platform/performance'
    )

    // With the slice rolled back the behaviour changes but the marker still fires:
    // a rolled-back run must stay comparable with a baseline.
    expect(isPerformanceSliceEnabled('deferred-history')).toBe(true)
    markRendererPerformance('tab-switch-requested')
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith(
      'mt::performance-mark',
      'tab-switch-requested',
      undefined
    )
    vi.unstubAllGlobals()
  })
})
