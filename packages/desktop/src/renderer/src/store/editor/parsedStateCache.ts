/**
 * Small LRU for parsed editor states.
 *
 * Tab switching used to re-run the full Markdown parser and rebuild the whole
 * block tree on every activation. The live engine only holds one document at a
 * time, so the renderer keeps the parsed state of the most recently used tabs
 * here and re-injects it when switching back.
 *
 * Entries are keyed by the tab id plus the complete document revision that
 * produced the state. Markdown, pathname, file identity, and encoding are all
 * part of that revision so external changes cannot reuse a stale tree.
 */
export interface ParsedStateRevision {
  markdown: string
  pathname: string
  fileIdentity: string
  encoding: string
}

interface CacheEntry<TState> {
  revision: ParsedStateRevision
  state: TState
}

export interface ParsedStateTabLike {
  id: string
  markdown: string
  pathname: string
  fileIdentity?: string
  encoding: {
    encoding: string
    isBom: boolean
  }
}

export interface HeapMemorySnapshot {
  usedJSHeapSize: number
  jsHeapSizeLimit: number
}

const revisionsMatch = (
  left: ParsedStateRevision,
  right: ParsedStateRevision
): boolean =>
  left.markdown === right.markdown &&
  left.pathname === right.pathname &&
  left.fileIdentity === right.fileIdentity &&
  left.encoding === right.encoding

/**
 * Convert the store's document metadata into the cache revision key.
 *
 * The store currently identifies a saved document by its pathname; using that
 * value for `fileIdentity` keeps the key explicit and lets a future stat-based
 * identity replace it without weakening path/encoding invalidation.
 */
export const getParsedStateRevision = (tab: ParsedStateTabLike): ParsedStateRevision => ({
  markdown: tab.markdown,
  pathname: tab.pathname,
  // `fileIdentity` is populated from watcher mtimeMs updates. Tabs that have
  // never received one fall back to their pathname.
  fileIdentity: tab.fileIdentity ?? tab.pathname,
  encoding: `${tab.encoding.encoding}:${tab.encoding.isBom ? 'bom' : 'no-bom'}`
})

/**
 * Detect Chromium's non-standard heap-pressure signal when it is available.
 * A missing memory API must never disable the cache.
 */
export const isMemoryPressureHigh = (
  memory: HeapMemorySnapshot | null | undefined,
  threshold = 0.8
): boolean => {
  if (
    !memory ||
    !Number.isFinite(memory.usedJSHeapSize) ||
    !Number.isFinite(memory.jsHeapSizeLimit) ||
    memory.jsHeapSizeLimit <= 0
  ) {
    return false
  }

  return memory.usedJSHeapSize / memory.jsHeapSizeLimit >= threshold
}

export class ParsedStateCache<TState = unknown> {
  private readonly states = new Map<string, CacheEntry<TState>>()

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('ParsedStateCache capacity must be a positive integer')
    }
  }

  get size(): number {
    return this.states.size
  }

  has(id: string, revision: ParsedStateRevision): boolean {
    const entry = this.states.get(id)
    return entry !== undefined && revisionsMatch(entry.revision, revision)
  }

  get(id: string, revision: ParsedStateRevision): TState | undefined {
    const entry = this.states.get(id)
    if (!entry || !revisionsMatch(entry.revision, revision)) return undefined

    // Refresh recency.
    this.states.delete(id)
    this.states.set(id, entry)
    return entry.state
  }

  set(id: string, revision: ParsedStateRevision, state: TState): void {
    this.states.delete(id)
    this.states.set(id, { revision, state })
    while (this.states.size > this.capacity) {
      const oldestId = this.states.keys().next().value as string | undefined
      if (oldestId === undefined) break
      this.states.delete(oldestId)
    }
  }

  invalidate(id: string): void {
    this.states.delete(id)
  }

  retain(liveIds: ReadonlySet<string>): void {
    for (const id of this.states.keys()) {
      if (!liveIds.has(id)) this.states.delete(id)
    }
  }

  /** Drop all parsed state while leaving tab content and metadata untouched. */
  clear(): void {
    this.states.clear()
  }
}

export const MAX_PARSED_TAB_STATES = 4
