import type { InjectionKey } from 'vue'
import type { TreeFileNode, TreeFolderNode } from './types'

export type SidebarTreeNode = TreeFolderNode | TreeFileNode

/**
 * One mounted tree node's registration.
 *
 * Tree rows used to each subscribe to the global bus and attach their own
 * `contextmenu` listener, so listener count grew with the number of nodes.
 * The tree container now owns those listeners and routes to the registered
 * handle for the target pathname instead.
 */
export interface SidebarNodeHandle {
  node: SidebarTreeNode
  isFolder: boolean
  /** Focus this folder's "new file" input row. */
  focusNew?: () => void
  /** Focus this node's rename input. */
  focusRename?: () => void
}

export interface SidebarNodeRegistry {
  register: (pathname: string, handle: SidebarNodeHandle) => () => void
  get: (pathname: string) => SidebarNodeHandle | undefined
}

export const SIDEBAR_NODE_REGISTRY: InjectionKey<SidebarNodeRegistry> =
  Symbol('sidebar-node-registry')
