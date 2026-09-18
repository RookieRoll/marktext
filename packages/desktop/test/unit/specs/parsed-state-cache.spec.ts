import { describe, expect, it } from 'vitest'
import {
  getParsedStateRevision,
  isMemoryPressureHigh,
  ParsedStateCache,
  type ParsedStateRevision,
  type ParsedStateTabLike
} from '../../../src/renderer/src/store/editor/parsedStateCache'

const makeTab = (overrides: Partial<ParsedStateTabLike> = {}): ParsedStateTabLike => ({
  id: 'tab-a',
  markdown: '# A',
  pathname: '/notes/a.md',
  encoding: { encoding: 'utf8', isBom: false },
  ...overrides
})

const revision = (overrides: Partial<ParsedStateTabLike> = {}): ParsedStateRevision =>
  getParsedStateRevision(makeTab(overrides))

describe('ParsedStateCache', () => {
  it('reuses a parsed state only for the exact document revision', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('tab-a', revision(), 'state-a')

    expect(cache.get('tab-a', revision())).toBe('state-a')
    expect(cache.get('tab-a', revision({ markdown: '# A changed' }))).toBeUndefined()
    expect(cache.has('tab-a', revision())).toBe(true)
  })

  it('misses when the pathname changes for the same content', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('tab-a', revision(), 'state-a')

    expect(cache.get('tab-a', revision({ pathname: '/notes/renamed.md' }))).toBeUndefined()
  })

  it('misses when the file identity changes even if path and content match', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('tab-a', revision({ fileIdentity: '/notes/a.md:1' }), 'state-a')

    expect(
      cache.get('tab-a', revision({ fileIdentity: '/notes/a.md:2' }))
    ).toBeUndefined()
    expect(
      cache.get('tab-a', revision({ fileIdentity: '/notes/a.md:1' }))
    ).toBe('state-a')
  })

  it('misses when the encoding or BOM marker changes', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('tab-a', revision(), 'state-a')

    expect(
      cache.get('tab-a', revision({ encoding: { encoding: 'gbk', isBom: false } }))
    ).toBeUndefined()
    expect(
      cache.get('tab-a', revision({ encoding: { encoding: 'utf8', isBom: true } }))
    ).toBeUndefined()
  })

  it('falls back to the pathname when no watcher identity is known', () => {
    expect(revision().fileIdentity).toBe('/notes/a.md')
  })

  it('evicts the least recently used entry past capacity', () => {
    const cache = new ParsedStateCache<string>(2)
    cache.set('a', revision({ pathname: '/a.md' }), 'state-a')
    cache.set('b', revision({ pathname: '/b.md' }), 'state-b')
    // Touch `a` so `b` becomes the least recently used entry.
    expect(cache.get('a', revision({ pathname: '/a.md' }))).toBe('state-a')
    cache.set('c', revision({ pathname: '/c.md' }), 'state-c')

    expect(cache.size).toBe(2)
    expect(cache.get('a', revision({ pathname: '/a.md' }))).toBe('state-a')
    expect(cache.get('b', revision({ pathname: '/b.md' }))).toBeUndefined()
    expect(cache.get('c', revision({ pathname: '/c.md' }))).toBe('state-c')
  })

  it('invalidates a tab when its live content changes', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('a', revision(), 'state-a')
    cache.invalidate('a')

    expect(cache.get('a', revision())).toBeUndefined()
    expect(cache.size).toBe(0)
  })

  it('drops state for tabs that are no longer open', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('a', revision({ pathname: '/a.md' }), 'state-a')
    cache.set('b', revision({ pathname: '/b.md' }), 'state-b')
    cache.retain(new Set(['b']))

    expect(cache.get('a', revision({ pathname: '/a.md' }))).toBeUndefined()
    expect(cache.get('b', revision({ pathname: '/b.md' }))).toBe('state-b')
  })

  it('clear() releases parsed state without touching the revision contract', () => {
    const cache = new ParsedStateCache<string>(4)
    cache.set('a', revision(), 'state-a')
    cache.clear()

    expect(cache.size).toBe(0)
    expect(cache.get('a', revision())).toBeUndefined()
    // The same revision can be rebuilt and reused after a pressure release.
    cache.set('a', revision(), 'state-a-rebuilt')
    expect(cache.get('a', revision())).toBe('state-a-rebuilt')
  })

  it('rejects an unusable capacity', () => {
    expect(() => new ParsedStateCache(0)).toThrow(RangeError)
    expect(() => new ParsedStateCache(1.5)).toThrow(RangeError)
  })
})

describe('isMemoryPressureHigh', () => {
  it('is false when the non-standard memory API is unavailable', () => {
    expect(isMemoryPressureHigh(undefined)).toBe(false)
    expect(isMemoryPressureHigh(null)).toBe(false)
  })

  it('is false below the threshold and true at or above it', () => {
    expect(isMemoryPressureHigh({ usedJSHeapSize: 79, jsHeapSizeLimit: 100 })).toBe(false)
    expect(isMemoryPressureHigh({ usedJSHeapSize: 80, jsHeapSizeLimit: 100 })).toBe(true)
    expect(isMemoryPressureHigh({ usedJSHeapSize: 95, jsHeapSizeLimit: 100 })).toBe(true)
  })

  it('ignores unusable snapshots instead of disabling the cache', () => {
    expect(isMemoryPressureHigh({ usedJSHeapSize: 50, jsHeapSizeLimit: 0 })).toBe(false)
    expect(
      isMemoryPressureHigh({ usedJSHeapSize: Number.NaN, jsHeapSizeLimit: 100 })
    ).toBe(false)
  })
})
