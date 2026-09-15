import type { InjectionKey } from 'vue'

/**
 * One mounted tree row's registration.
 *
 * Rows used to each subscribe to the global bus and attach their own
 * `contextmenu` listener, so listener count grew with the number of nodes. The
 * tree container now owns those listeners, flattens the tree into virtualized
 * rows and routes focus to the registered handle for the target row only.
 */
export interface SidebarNodeHandle {
  /** Focus this row's rename input, if the row is currently rendering one. */
  focusRename?: () => void
  /** Focus this row's "new file/folder" input (create-input rows only). */
  focusCreate?: () => void
}

export interface SidebarNodeRegistry {
  register: (key: string, handle: SidebarNodeHandle) => () => void
  get: (key: string) => SidebarNodeHandle | undefined
}

export const SIDEBAR_NODE_REGISTRY: InjectionKey<SidebarNodeRegistry> =
  Symbol('sidebar-node-registry')
