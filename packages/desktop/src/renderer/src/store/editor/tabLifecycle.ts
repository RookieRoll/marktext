/**
 * Minimal tab identity required by the editor tab lifecycle helpers.
 *
 * Keeping these types local prevents the pure tab operations from depending
 * on Pinia, the editor store, or renderer-only services.
 */
export interface TabLifecycleTab {
  readonly id: string
}

export interface TabLifecyclePathTab extends TabLifecycleTab {
  readonly pathname: string
}

export interface TabExchange {
  readonly fromId: string
  readonly toId: string | null
}

/**
 * Build the same id-to-index projection maintained by the editor store.
 * Later entries win when malformed input contains duplicate ids, matching the
 * store's reduce-based implementation.
 */
export const buildTabIndex = (tabs: ReadonlyArray<TabLifecycleTab>): Record<string, number> => {
  return tabs.reduce<Record<string, number>>((indexById, tab, index) => {
    indexById[tab.id] = index
    return indexById
  }, {})
}

/**
 * Return all tabs whose ids are not in `tabIds`, without mutating the input.
 */
export const removeTabs = <T extends TabLifecycleTab>(
  tabs: ReadonlyArray<T>,
  tabIds: ReadonlyArray<string>
): T[] => {
  const idsToRemove = new Set(tabIds)
  return tabs.filter((tab) => !idsToRemove.has(tab.id))
}

/**
 * Select the tab occupying the closed tab's former index, then the preceding
 * tab, then the first tab. This is the fallback order used by FORCE_CLOSE_TAB.
 * The index refers to the tab's position before it was removed.
 */
export const selectTabAfterClose = <T extends TabLifecycleTab>(
  tabs: ReadonlyArray<T>,
  closedTabIndex: number
): T | null => {
  return tabs[closedTabIndex] ?? tabs[closedTabIndex - 1] ?? tabs[0] ?? null
}

/**
 * Calculate the next tab index using editor.ts' direction convention:
 * `false` cycles left and `true` cycles right.
 */
export const cycleTabIndex = (
  tabCount: number,
  currentTabIndex: number,
  direction: boolean
): number | null => {
  if (tabCount <= 1 || currentTabIndex < 0 || currentTabIndex >= tabCount) {
    return null
  }

  if (direction) {
    return (currentTabIndex + 1) % tabCount
  }

  return currentTabIndex === 0 ? tabCount - 1 : currentTabIndex - 1
}

/**
 * Move one tab to the position immediately before `toId`. A falsy destination
 * moves it to the end, matching EXCHANGE_TABS_BY_ID. The input is never
 * mutated; invalid ids return an equivalent shallow copy.
 */
export const exchangeTabs = <T extends TabLifecycleTab>(
  tabs: ReadonlyArray<T>,
  { fromId, toId }: TabExchange
): T[] => {
  const fromIndex = tabs.findIndex((tab) => tab.id === fromId)
  if (fromIndex === -1) return [...tabs]

  const toIndex = !toId ? tabs.length - 1 : tabs.findIndex((tab) => tab.id === toId)
  if (toIndex === -1) return [...tabs]

  const reordered = [...tabs]
  const [tab] = reordered.splice(fromIndex, 1)
  if (tab === undefined) return [...tabs]

  const destinationIndex = !toId ? reordered.length : fromIndex < toIndex ? toIndex - 1 : toIndex
  reordered.splice(destinationIndex, 0, tab)
  return reordered
}

/**
 * Find the first tab with an exact pathname match.
 */
export const findTabByPath = <T extends TabLifecyclePathTab>(
  tabs: ReadonlyArray<T>,
  pathname: string
): T | undefined => {
  return tabs.find((tab) => tab.pathname === pathname)
}
