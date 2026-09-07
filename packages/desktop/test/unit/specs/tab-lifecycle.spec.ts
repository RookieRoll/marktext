import { describe, expect, it } from 'vitest'
import {
  buildTabIndex,
  cycleTabIndex,
  exchangeTabs,
  findTabByPath,
  removeTabs,
  selectTabAfterClose,
  type TabLifecyclePathTab
} from '@/store/editor/tabLifecycle'

interface TestTab extends TabLifecyclePathTab {
  label: string
}

const first: TestTab = { id: 'first', pathname: '/workspace/first.md', label: 'First' }
const second: TestTab = { id: 'second', pathname: '/workspace/second.md', label: 'Second' }
const third: TestTab = { id: 'third', pathname: '/workspace/third.md', label: 'Third' }
const tabs = [first, second, third]

describe('tab lifecycle pure functions', () => {
  it('builds the tab id index and lets later duplicate ids win', () => {
    expect(buildTabIndex([first, second, { ...third, id: 'second' }])).toEqual({
      first: 0,
      second: 2
    })
  })

  it('removes requested tabs without mutating the source list', () => {
    const source = [...tabs]

    expect(removeTabs(source, ['second', 'missing', 'second'])).toEqual([first, third])
    expect(source).toEqual(tabs)
  })

  it('selects the tab at the closed position, then the previous tab, then the first tab', () => {
    expect(selectTabAfterClose([first, third], 0)).toBe(first)
    expect(selectTabAfterClose([first, third], 1)).toBe(third)
    expect(selectTabAfterClose([first, second], 2)).toBe(second)
    expect(selectTabAfterClose([], 0)).toBeNull()
  })

  it('cycles left and right with wraparound and rejects unusable indexes', () => {
    expect(cycleTabIndex(3, 0, false)).toBe(2)
    expect(cycleTabIndex(3, 2, true)).toBe(0)
    expect(cycleTabIndex(3, 1, false)).toBe(0)
    expect(cycleTabIndex(1, 0, true)).toBeNull()
    expect(cycleTabIndex(3, -1, true)).toBeNull()
    expect(cycleTabIndex(3, 3, false)).toBeNull()
  })

  it('moves a tab before a destination or to the end without mutating the source list', () => {
    const source = [...tabs]

    expect(exchangeTabs(source, { fromId: 'first', toId: 'third' }).map((tab) => tab.id)).toEqual([
      'second',
      'first',
      'third'
    ])
    expect(exchangeTabs(source, { fromId: 'third', toId: 'first' }).map((tab) => tab.id)).toEqual([
      'third',
      'first',
      'second'
    ])
    expect(exchangeTabs(source, { fromId: 'first', toId: null }).map((tab) => tab.id)).toEqual([
      'second',
      'third',
      'first'
    ])
    expect(exchangeTabs(source, { fromId: 'first', toId: '' }).map((tab) => tab.id)).toEqual([
      'second',
      'third',
      'first'
    ])
    expect(exchangeTabs(source, { fromId: 'missing', toId: 'first' })).toEqual(source)
    expect(source).toEqual(tabs)
  })

  it('finds a tab by exact pathname', () => {
    expect(findTabByPath(tabs, '/workspace/second.md')).toBe(second)
    expect(findTabByPath(tabs, '/workspace/SECOND.md')).toBeUndefined()
  })
})
