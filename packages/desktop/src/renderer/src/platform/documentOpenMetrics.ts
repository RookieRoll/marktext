import { markRendererPerformance } from './performance'

/**
 * Renderer-side document-open instrumentation.
 *
 * The report needs to separate the phases a user can feel: the store receiving a
 * document, the Markdown actually being parsed into a block tree, the first
 * painted frame, and the deferred derived work (table of contents, statistics)
 * that follows. `first-document-loaded` already covers "the store has content";
 * this module adds the parse boundary and the deferred-work boundary, plus the
 * counters that let a report explain *why* a parse happened.
 *
 * Counters are cumulative for the process, because the Main reporter merges
 * counter payloads rather than summing them.
 */

let parsedDocuments = 0
let deferredDerivedWork = 0

/** Full Markdown parses performed by this renderer (cache misses only). */
export const parsedDocumentCount = (): number => parsedDocuments

/** Deferred derived passes (TOC / statistics) scheduled by this renderer. */
export const deferredDerivedWorkCount = (): number => deferredDerivedWork

/**
 * Counts one full Markdown parse and records the parse-complete boundary.
 *
 * Call this only when the engine actually re-parsed Markdown. A tab-switch cache
 * hit reuses an existing block tree and must not be counted, so the parse
 * workload a report sees always matches the real work.
 */
export const recordDocumentParsed = (): void => {
  parsedDocuments += 1
  markRendererPerformance('document-parsed', { counters: { parsedDocuments } })
}

/**
 * Counts one deferred derived pass moving out of the first-frame path.
 *
 * The counter is reported on the next boundary the renderer emits (the parse
 * marker or the convergence marker), so a report can tell deferred work apart
 * from parse work even though both belong to the same document open.
 */
export const recordDeferredDerivedWork = (): void => {
  deferredDerivedWork += 1
}

/** Records that the deferred derived work has converged for the active tab. */
export const markDerivedWorkComplete = (): void => {
  markRendererPerformance('derived-work-complete', {
    counters: { deferredDerivedWork, parsedDocuments }
  })
}
