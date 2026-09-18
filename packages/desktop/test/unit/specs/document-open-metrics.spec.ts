import { beforeEach, describe, expect, it, vi } from 'vitest'

// `documentOpenMetrics` reads the Electron bridge through `@/platform/performance`.
// Stub it before the module is imported so the counters can be asserted without a
// preload global, and so each call shape is visible.
const markRendererPerformance = vi.hoisted(() => vi.fn())
vi.mock('@/platform/performance', () => ({ markRendererPerformance }))

const loadModule = async () => {
  vi.resetModules()
  return import('@/platform/documentOpenMetrics')
}

describe('renderer document-open metrics', () => {
  beforeEach(() => {
    markRendererPerformance.mockClear()
  })

  it('counts only real full parses and reports them cumulatively', async () => {
    const metrics = await loadModule()
    expect(metrics.parsedDocumentCount()).toBe(0)

    metrics.recordDocumentParsed()
    metrics.recordDocumentParsed()
    metrics.recordDocumentParsed()

    expect(metrics.parsedDocumentCount()).toBe(3)
    const [, payload] = markRendererPerformance.mock.calls.at(-1) ?? []
    // Main merges counter payloads instead of summing them, so the renderer
    // must report a running total.
    expect(payload).toEqual({ counters: { parsedDocuments: 3 } })
    expect(markRendererPerformance.mock.calls.map(([milestone]) => milestone)).toEqual([
      'document-parsed',
      'document-parsed',
      'document-parsed'
    ])
  })

  it('counts deferred derived passes without inflating parse counts', async () => {
    const metrics = await loadModule()

    metrics.recordDeferredDerivedWork()
    metrics.recordDeferredDerivedWork()
    metrics.markDerivedWorkComplete()

    expect(metrics.parsedDocumentCount()).toBe(0)
    expect(metrics.deferredDerivedWorkCount()).toBe(2)
    expect(markRendererPerformance).toHaveBeenCalledWith('derived-work-complete', {
      counters: { deferredDerivedWork: 2, parsedDocuments: 0 }
    })
  })

  it('keeps parse and derived counters independent across a document open', async () => {
    const metrics = await loadModule()

    metrics.recordDocumentParsed()
    metrics.recordDeferredDerivedWork()
    metrics.recordDocumentParsed()
    metrics.markDerivedWorkComplete()

    expect(metrics.parsedDocumentCount()).toBe(2)
    expect(metrics.deferredDerivedWorkCount()).toBe(1)
    expect(markRendererPerformance).toHaveBeenLastCalledWith('derived-work-complete', {
      counters: { deferredDerivedWork: 1, parsedDocuments: 2 }
    })
  })
})
