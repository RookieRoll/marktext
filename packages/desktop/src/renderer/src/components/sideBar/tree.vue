<template>
  <div class="tree-view">
    <!-- Opened tabs -->
    <div
      v-if="openedFilesInSidebar"
      class="opened-files"
    >
      <div class="title">
        <el-icon
          class="icon-arrow"
          :class="{ fold: !showOpenedFiles }"
          :size="12"
          @click.stop="toggleOpenedFiles()"
        >
          <ArrowRight />
        </el-icon>
        <span
          class="default-cursor text-overflow"
          @click.stop="toggleOpenedFiles()"
        >{{
          t('sideBar.tree.openedFiles')
        }}</span>
        <a
          href="javascript:;"
          :title="t('sideBar.tree.saveAll')"
          @click.stop="saveAll(false)"
        >
          <svg
            class="icon"
            aria-hidden="true"
          >
            <use xlink:href="#icon-save-all" />
          </svg>
        </a>
        <a
          href="javascript:;"
          :title="t('sideBar.tree.closeAll')"
          @click.stop="saveAll(true)"
        >
          <svg
            class="icon"
            aria-hidden="true"
          >
            <use xlink:href="#icon-close-all" />
          </svg>
        </a>
      </div>
      <div
        v-show="showOpenedFiles"
        class="opened-files-list"
      >
        <transition-group name="list">
          <opened-file
            v-for="tab of tabs"
            :key="tab.id"
            :file="tab"
            :is-active="currentFile?.id === tab.id"
          />
        </transition-group>
      </div>
    </div>

    <!-- Project tree view -->
    <div
      v-if="projectTree"
      class="project-tree"
    >
      <div
        class="title"
        @contextmenu.prevent="handleRootContextMenu"
      >
        <el-icon
          class="icon-arrow"
          :class="{ fold: !showDirectories }"
          :size="12"
          @click.stop="toggleDirectories()"
        >
          <ArrowRight />
        </el-icon>
        <span
          class="default-cursor text-overflow"
          @click.stop="toggleDirectories()"
        >{{
          projectTree.name
        }}</span>
      </div>
      <!--
        One scroll container owns the whole tree. Rows are flattened from the
        logical tree and only the window intersecting the viewport is mounted,
        so expanding a folder with thousands of children no longer creates
        thousands of components and DOM nodes.
      -->
      <div
        v-show="showDirectories"
        ref="scrollEl"
        class="tree-scroll"
        @scroll="handleScroll"
        @contextmenu.prevent="handleTreeContextMenu"
      >
        <div
          class="tree-spacer"
          :style="{ height: `${virtualRange.totalHeight}px` }"
        >
          <div
            class="tree-rows"
            :style="{ transform: `translateY(${virtualRange.offsetY}px)` }"
          >
            <tree-row
              v-for="entry of visibleSlice"
              :key="entry.key"
              :row="entry"
              :is-active="isRowActive(entry)"
              :is-current="isRowCurrent(entry)"
              :is-renaming="renameCache === entry.pathname && entry.kind !== 'create-input'"
              :create-name="createName"
              @toggle="handleToggle"
              @open="handleOpen"
              @rename="handleRename"
              @create="handleCreate"
              @update:create-name="createName = $event"
            />
          </div>
        </div>
        <div
          v-if="showEmptyState"
          class="empty-project"
        >
          <span>{{ t('sideBar.tree.emptyProject') }}</span>
          <div class="centered-group">
            <button
              class="button-primary"
              @click.stop="createFile"
            >
              {{ t('sideBar.tree.createFile') }}
            </button>
          </div>
        </div>
      </div>
    </div>
    <div
      v-else
      class="open-project"
    >
      <div class="centered-group">
        <el-button
          text
          bg
          type="primary"
          @click="openFolder"
        >
          {{ t('sideBar.tree.openFolder') }}
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import TreeRow from './treeRow.vue'
import OpenedFile from './treeOpenedTab.vue'
import bus from '../../bus'
import { showContextMenu } from '../../contextMenu/sideBar'
import { useI18n } from 'vue-i18n'
import { ArrowRight } from '@element-plus/icons-vue'
import {
  SIDEBAR_NODE_REGISTRY,
  type SidebarNodeHandle,
  type SidebarNodeRegistry
} from './focusRegistry'
import {
  TREE_ROW_HEIGHT,
  ancestorPathnames,
  buildVisibleRows,
  createRowKey,
  findNodeByPathname,
  findRowIndexByPathname,
  folderRowKey,
  fileRowKey,
  getVirtualRange,
  type TreeRow as TreeRowModel,
  type TreeRowKind
} from './visibleRows'
import { PATH_SEPARATOR } from '@/config'
import type { TreeNode, TabDescriptor } from './types'

const { t } = useI18n()

const props = defineProps<{
  // The project store seeds `projectTree` as `null` until a folder is
  // opened; the template renders the "open project" empty-state behind
  // `v-if="projectTree"`. Type the prop nullable to match runtime + the
  // template guard.
  projectTree: TreeNode | null
  openedFiles?: TabDescriptor[]
  tabs?: TabDescriptor[]
}>()

// Persist the section collapse state (#2421). The tree is rendered under a
// v-if and is destroyed when the sidebar collapses to its icon strip, so local
// refs reset to expanded on re-open. Back them with localStorage (like the
// sidebar width) so the state survives a re-mount and app restart.
const SHOW_DIRECTORIES_KEY = 'side-bar-show-directories'
const SHOW_OPENED_FILES_KEY = 'side-bar-show-opened-files'
const readSectionExpanded = (key: string): boolean => localStorage.getItem(key) !== 'false'
const showDirectories = ref(readSectionExpanded(SHOW_DIRECTORIES_KEY))
const showOpenedFiles = ref(readSectionExpanded(SHOW_OPENED_FILES_KEY))
const createName = ref('')

const projectStore = useProjectStore()
const editorStore = useEditorStore()
const preferencesStore = usePreferencesStore()
const { currentFile } = storeToRefs(editorStore)

// Computed properties
const { createCache, renameCache, activeItem } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)
const { openedFilesInSidebar } = storeToRefs(preferencesStore)

// The createCache state is `{ dirname, type }` while an input is shown, and
// `{}` otherwise. Expose a typed accessor for the template so we don't have
// to thread `as any` through every comparison.
const createCacheDirname = computed<string | undefined>(() => {
  const cache = createCache.value as { dirname?: string }
  return cache.dirname
})

// ---------------------------------------------------------------------------
// Visible-row model + virtual window
// ---------------------------------------------------------------------------

const scrollEl = ref<HTMLDivElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)

// Expansion is UI state, not tree state: the tree store always seeds folders
// as collapsed, so an empty set means "everything collapsed". Storing the
// expanded pathnames (instead of a flag per node) keeps the state stable while
// the virtual list mounts and unmounts rows.
const expandedFolders = ref<Set<string>>(new Set())

const isFolderExpanded = (folder: { pathname: string }): boolean =>
  expandedFolders.value.has(folder.pathname)

const visibleRows = computed<TreeRowModel[]>(() => {
  const tree = props.projectTree
  if (!tree) return []
  return buildVisibleRows(tree, {
    isExpanded: isFolderExpanded,
    createDirname: createCacheDirname.value
  })
})

const virtualRange = computed(() =>
  getVirtualRange({
    scrollTop: scrollTop.value,
    viewportHeight: viewportHeight.value,
    rowCount: visibleRows.value.length
  })
)

const visibleSlice = computed(() =>
  visibleRows.value.slice(virtualRange.value.start, virtualRange.value.end)
)

const showEmptyState = computed(() => {
  const tree = props.projectTree
  if (!tree) return false
  return (
    visibleRows.value.length === 0 &&
    tree.files.length === 0 &&
    tree.folders.length === 0 &&
    createCacheDirname.value !== tree.pathname
  )
})

const isRowActive = (row: TreeRowModel): boolean =>
  !!row.pathname && activeItem.value?.pathname === row.pathname

const isRowCurrent = (row: TreeRowModel): boolean =>
  row.kind === 'file' && !!currentFile.value?.pathname && currentFile.value.pathname === row.pathname

// ---------------------------------------------------------------------------
// Row registry (see focusRegistry.ts)
//
// Rows register their focus handlers here; the container owns every global bus
// subscription and routes to the single target row by stable row key. Listener
// and subscription count therefore stays constant as the tree grows.
// ---------------------------------------------------------------------------

const rowRegistry = new Map<string, SidebarNodeHandle>()
provide<SidebarNodeRegistry>(SIDEBAR_NODE_REGISTRY, {
  register: (key, handle) => {
    rowRegistry.set(key, handle)
    return () => {
      if (rowRegistry.get(key) === handle) rowRegistry.delete(key)
    }
  },
  get: (key) => rowRegistry.get(key)
})

// ---------------------------------------------------------------------------
// Scroll handling
// ---------------------------------------------------------------------------

let scrollFrame: number | null = null
const handleScroll = (): void => {
  // Coalesce scroll events into one window recomputation per frame: reading
  // scrollTop is cheap, but re-rendering the slice on every event is not.
  if (scrollFrame !== null) return
  scrollFrame = window.requestAnimationFrame(() => {
    scrollFrame = null
    scrollTop.value = scrollEl.value?.scrollTop ?? 0
  })
}

const syncViewportHeight = (): void => {
  viewportHeight.value = scrollEl.value?.clientHeight ?? 0
}

let resizeObserver: ResizeObserver | null = null

/** Scroll a logical row index into view without changing the selection. */
const scrollRowIntoView = (index: number): void => {
  const el = scrollEl.value
  if (!el || index < 0) return
  const rowTop = index * TREE_ROW_HEIGHT
  const rowBottom = rowTop + TREE_ROW_HEIGHT
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight
  if (rowTop < viewTop) {
    el.scrollTop = rowTop
  } else if (rowBottom > viewBottom) {
    el.scrollTop = Math.max(0, rowBottom - el.clientHeight)
  }
  scrollTop.value = el.scrollTop
}

/**
 * Make a logical row reachable: expand its ancestors (and, for create inputs,
 * the target folder itself), scroll it into the window, then let the mounted
 * row take focus.
 */
const revealRow = async (pathname: string, kind: TreeRowKind): Promise<boolean> => {
  const tree = props.projectTree
  if (!tree || !pathname) return false

  const ancestors = ancestorPathnames(tree.pathname, pathname, PATH_SEPARATOR)
  const toExpand = kind === 'create-input' ? [...ancestors, pathname] : ancestors
  const next = new Set(expandedFolders.value)
  let changed = false
  for (const dir of toExpand) {
    if (dir && !next.has(dir)) {
      next.add(dir)
      changed = true
    }
  }
  if (changed) expandedFolders.value = next

  await nextTick()
  const index = findRowIndexByPathname(visibleRows.value, pathname, kind)
  if (index < 0) return false
  scrollRowIntoView(index)
  await nextTick()
  return true
}

const rowKeyFor = (pathname: string, kind: TreeRowKind): string =>
  kind === 'folder' ? folderRowKey(pathname) : kind === 'file' ? fileRowKey(pathname) : createRowKey(pathname)

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

const openFolder = (): void => {
  projectStore.ASK_FOR_OPEN_PROJECT()
}

const saveAll = (isClose: boolean): void => {
  editorStore.ASK_FOR_SAVE_ALL(isClose)
}

const createFile = (): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  bus.emit('SIDEBAR::new', 'file')
}

const handleRootContextMenu = (event: MouseEvent): void => {
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  showContextMenu(event, !!clipboard.value)
}

/**
 * Context-menu delegation. Every row carries `data-pathname`, so a single
 * container listener resolves the logical node instead of each row keeping its
 * own `contextmenu` listener alive for the lifetime of the tree.
 */
const handleTreeContextMenu = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  const rowEl = target?.closest?.('[data-pathname]') as HTMLElement | null
  const pathname = rowEl?.dataset?.pathname
  const row = pathname ? visibleRows.value.find((r) => r.pathname === pathname) : undefined
  if (row) {
    projectStore.CHANGE_ACTIVE_ITEM(row.node)
    showContextMenu(event, !!clipboard.value)
    return
  }
  // Blank area below the rows behaves like the project title: the menu targets
  // the project root.
  projectStore.CHANGE_ACTIVE_ITEM(props.projectTree)
  showContextMenu(event, !!clipboard.value)
}

const handleToggle = (row: TreeRowModel): void => {
  if (row.kind !== 'folder') return
  const next = new Set(expandedFolders.value)
  if (next.has(row.pathname)) next.delete(row.pathname)
  else next.add(row.pathname)
  expandedFolders.value = next
}

const handleOpen = (row: TreeRowModel): void => {
  if (row.kind !== 'file') return
  if (!row.node.isMarkdown) return
  editorStore.OPEN_OR_SWITCH_FILE(row.pathname)
}

const handleRename = (name: string): void => {
  projectStore.RENAME_IN_SIDEBAR(name)
}

const handleCreate = (name: string): void => {
  projectStore.CREATE_FILE_DIRECTORY(name)
}

const toggleOpenedFiles = (): void => {
  showOpenedFiles.value = !showOpenedFiles.value
  localStorage.setItem(SHOW_OPENED_FILES_KEY, String(showOpenedFiles.value))
}

const toggleDirectories = (): void => {
  showDirectories.value = !showDirectories.value
  localStorage.setItem(SHOW_DIRECTORIES_KEY, String(showDirectories.value))
  // The scroll container is measured while hidden (0px) if the section starts
  // collapsed; re-measure once it is displayed so the window covers the view.
  if (showDirectories.value) nextTick(syncViewportHeight)
}

// ---------------------------------------------------------------------------
// Centralised bus routing
// ---------------------------------------------------------------------------

const focusCreateRow = async (): Promise<void> => {
  const cache = createCache.value as { dirname?: string }
  const dirname = cache.dirname
  const tree = props.projectTree
  if (!dirname || !tree) return
  // A fresh create target always starts from an empty name, matching the
  // previous per-folder input behaviour.
  createName.value = ''
  await revealRow(dirname, 'create-input')
  rowRegistry.get(createRowKey(dirname))?.focusCreate?.()
}

const focusRenameRow = async (): Promise<void> => {
  const pathname = renameCache.value
  const tree = props.projectTree
  if (!pathname || !tree) return
  // Resolve the node type against the whole logical tree: the target can be
  // nested inside a collapsed parent and therefore absent from `visibleRows`.
  const node = findNodeByPathname(tree, pathname)
  if (!node) return
  const kind: TreeRowKind = node.isDirectory ? 'folder' : 'file'
  const revealed = await revealRow(pathname, kind)
  if (!revealed) return
  rowRegistry.get(rowKeyFor(pathname, kind))?.focusRename?.()
}

const handleDocumentClick = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  if (target && target.tagName !== 'INPUT') {
    projectStore.CHANGE_ACTIVE_ITEM({})
    projectStore.createCache = {}
    projectStore.renameCache = null
  }
}

const handleDocumentContextMenu = (event: MouseEvent): void => {
  const target = event.target as HTMLElement | null
  if (target && target.tagName !== 'INPUT') {
    projectStore.createCache = {}
    projectStore.renameCache = null
  }
}

const handleDocumentKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    projectStore.createCache = {}
    projectStore.renameCache = null
  }
}

// Reveal the active document when it changes, so switching tabs keeps the
// sidebar row visible even when it lives outside the current window.
watch(
  () => currentFile.value?.pathname ?? '',
  (pathname) => {
    if (!pathname || !props.projectTree) return
    revealRow(pathname, 'file').catch(() => {})
  }
)

watch(
  () => props.projectTree?.pathname ?? '',
  () => {
    // Project switch: forget expansion state so the new tree starts collapsed.
    expandedFolders.value = new Set()
    scrollTop.value = 0
    nextTick(syncViewportHeight)
  }
)

onMounted(() => {
  bus.on('SIDEBAR::show-new-input', focusCreateRow)
  bus.on('SIDEBAR::show-rename-input', focusRenameRow)

  // Hide rename / create inputs on outside clicks. Buttons that open these
  // inputs must use @click.stop so their click never reaches this listener.
  document.addEventListener('click', handleDocumentClick)
  document.addEventListener('contextmenu', handleDocumentContextMenu)
  document.addEventListener('keydown', handleDocumentKeydown)

  nextTick(() => {
    syncViewportHeight()
    if (typeof ResizeObserver !== 'undefined' && scrollEl.value) {
      resizeObserver = new ResizeObserver(syncViewportHeight)
      resizeObserver.observe(scrollEl.value)
    } else {
      window.addEventListener('resize', syncViewportHeight)
    }
  })
})

onBeforeUnmount(() => {
  bus.off('SIDEBAR::show-new-input', focusCreateRow)
  bus.off('SIDEBAR::show-rename-input', focusRenameRow)
  document.removeEventListener('click', handleDocumentClick)
  document.removeEventListener('contextmenu', handleDocumentContextMenu)
  document.removeEventListener('keydown', handleDocumentKeydown)
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', syncViewportHeight)
  if (scrollFrame !== null) {
    window.cancelAnimationFrame(scrollFrame)
    scrollFrame = null
  }
  rowRegistry.clear()
})
</script>

<style scoped>
.list-item {
  display: inline-block;
  margin-right: 10px;
}

.list-enter-active,
.list-leave-active {
  transition: all 0.2s;
}
.list-enter, .list-leave-to
  /* .list-leave-active for below version 2.1.8 */ {
  opacity: 0;
  transform: translateX(-50px);
}
.tree-view {
  font-size: 14px;
  color: var(--sideBarColor);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding-top: 35px;
  box-sizing: border-box;
  overflow: hidden;
}

.icon-arrow {
  margin-right: 5px;
  transition: transform 0.25s ease-out;
  transform: rotate(90deg);
  color: var(--sideBarTextColor);
  cursor: pointer;
}

.icon-arrow.fold {
  transform: rotate(0);
}

.opened-files > .title,
.project-tree > .title {
  height: 30px;
  line-height: 30px;
  font-size: 14px;
}

.opened-files .title {
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.opened-files .title > span {
  flex: 1;
}

.opened-files .title > a {
  display: none;
  text-decoration: none;
  color: var(--sideBarColor);
  margin-left: 8px;
}
.opened-files div.title:hover > a,
.opened-files div.title > a:hover {
  display: block;
}

.opened-files div.title:hover > a:hover,
.opened-files div.title > a:hover:hover {
  color: var(--highlightThemeColor);
}
.opened-files {
  display: flex;
  flex-direction: column;
  flex: 0 1 auto;
  min-height: 0;
}
.default-cursor {
  cursor: pointer;
}
.opened-files .opened-files-list {
  max-height: 112px;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 0 1 auto;
  min-height: 0;
}

.opened-files .opened-files-list::-webkit-scrollbar:vertical {
  width: 8px;
}

.project-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.project-tree > .title {
  padding-right: 15px;
  display: flex;
  align-items: center;
}

.project-tree > .title > span {
  flex: 1;
  user-select: none;
}

.project-tree > .title > a {
  pointer-events: auto;
  cursor: pointer;
  margin-left: 8px;
  color: var(--sideBarIconColor);
  opacity: 0;
}

.project-tree > .title > a:hover {
  color: var(--highlightThemeColor);
}

.project-tree > .title > a.active {
  color: var(--highlightThemeColor);
}

/*
 * The scroll container owns the full logical height through `.tree-spacer`, so
 * the scrollbar is proportional to the row count even though only the visible
 * window is mounted.
 */
.project-tree > .tree-scroll {
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.project-tree > .tree-scroll::-webkit-scrollbar:vertical {
  width: 8px;
}

.tree-spacer {
  position: relative;
  width: 100%;
}

.tree-rows {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}

.project-tree div.title:hover > a {
  opacity: 1;
}
.open-project {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
  align-items: center;
  padding-bottom: 100px;
}

.open-project .centered-group {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.open-project .el-button {
  margin-top: 20px;
}
.open-project .el-button.is-text.is-has-bg,
.empty-project .el-button.is-text.is-has-bg {
  background-color: var(--buttonPrimaryBgColor);
  color: var(--buttonPrimaryFontColor);
  border-color: transparent;
}
.open-project .el-button.is-text.is-has-bg:hover,
.open-project .el-button.is-text.is-has-bg:focus,
.empty-project .el-button.is-text.is-has-bg:hover,
.empty-project .el-button.is-text.is-has-bg:focus {
  background-color: var(--buttonPrimaryBgColorHover);
  color: var(--buttonPrimaryFontColorHover);
}
.empty-project {
  font-size: 14px;
  display: flex;
  flex-direction: column;
  padding-top: 40px;
  align-items: center;
  color: var(--sideBarTextColor);
  & button {
    margin-top: 10px;
  }
}

.empty-project > a {
  color: var(--highlightThemeColor);
  text-align: center;
  margin-top: 15px;
  text-decoration: none;
}
.bold {
  font-weight: 600;
}
</style>
