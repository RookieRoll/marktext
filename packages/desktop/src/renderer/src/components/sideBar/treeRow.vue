<template>
  <!-- Folder row -->
  <div
    v-if="row.kind === 'folder'"
    class="side-bar-folder"
    :data-pathname="row.pathname"
    :data-row-kind="row.kind"
  >
    <div
      class="folder-name"
      :style="{ 'padding-left': `${row.depth * 6 + 10}px` }"
      :class="{ active: isActive }"
      :title="row.pathname"
      @click="emit('toggle', row)"
    >
      <el-icon
        class="icon-arrow"
        :class="{ fold: !row.isExpanded }"
        :size="12"
      >
        <ArrowRight />
      </el-icon>
      <input
        v-if="isRenaming"
        ref="renameInput"
        v-model="newName"
        type="text"
        class="rename"
        @click.stop="noop"
        @keypress.enter="emitRename"
      >
      <span
        v-else
        class="text-overflow"
      >{{ row.node.name }}</span>
    </div>
  </div>

  <!-- New file / directory input row -->
  <div
    v-else-if="row.kind === 'create-input'"
    class="folder-contents create-row"
    :data-pathname="row.pathname"
    :data-row-kind="row.kind"
  >
    <input
      ref="createInput"
      v-model="createName"
      type="text"
      class="new-input"
      placeholder="Enter .md file name"
      :style="{ 'margin-left': `${row.depth * 6 + 10}px` }"
      @keypress.enter="emit('create', createName)"
    >
  </div>

  <!-- File row -->
  <div
    v-else
    class="side-bar-file"
    :data-pathname="row.pathname"
    :data-row-kind="row.kind"
    :title="row.pathname"
    :style="{ 'padding-left': `${row.depth * 6 + 10}px`, opacity: row.node.isMarkdown ? 1 : 0.75 }"
    :class="{ current: isCurrent, active: isActive }"
    @click="emit('open', row)"
  >
    <file-icon :name="row.node.name" />
    <input
      v-if="isRenaming"
      ref="renameInput"
      v-model="newName"
      type="text"
      class="rename"
      @click.stop="noop"
      @keypress.enter="emitRename"
    >
    <span
      v-else
      class="text-overflow"
    >{{ row.node.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, watch, onMounted, onBeforeUnmount } from 'vue'
import FileIcon from './icon.vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { SIDEBAR_NODE_REGISTRY } from './focusRegistry'
import type { TreeRow } from './visibleRows'

// One row of the virtualized tree. It keeps only presentational state and never
// registers global bus listeners, Pinia subscriptions or contextmenu handlers:
// the tree container owns all of those and routes by the row's logical
// pathname, which keeps per-node overhead constant as the tree grows.
const props = defineProps<{
  row: TreeRow
  isActive: boolean
  isCurrent: boolean
  isRenaming: boolean
  createName: string
}>()

const emit = defineEmits<{
  (e: 'toggle', row: TreeRow): void
  (e: 'open', row: TreeRow): void
  (e: 'rename', name: string): void
  (e: 'create', name: string): void
  (e: 'update:createName', value: string): void
}>()

const registry = inject(SIDEBAR_NODE_REGISTRY, null)
let unregisterNode: (() => void) | null = null

const renameInput = ref<HTMLInputElement | null>(null)
const createInput = ref<HTMLInputElement | null>(null)
const newName = ref('')

// Seed the rename input from the logical node the moment this row starts
// renaming, so a row recycled by the virtual list never carries a stale name.
watch(
  () => props.isRenaming,
  (renaming) => {
    if (renaming) newName.value = props.row.node.name
  },
  { immediate: true }
)

// If the container had to mount this row to focus its input, focus on mount.
onMounted(() => {
  if (props.isRenaming) renameInput.value?.focus()

  unregisterNode =
    registry?.register(props.row.key, {
      focusRename: () => {
        renameInput.value?.focus()
        if (renameInput.value) newName.value = props.row.node.name
      },
      focusCreate: () => {
        createInput.value?.focus()
      }
    }) ?? null
})

onBeforeUnmount(() => {
  unregisterNode?.()
  unregisterNode = null
})

const createName = ref(props.createName)
watch(
  () => props.createName,
  (value) => {
    createName.value = value
  }
)
watch(createName, (value) => {
  emit('update:createName', value)
})

const emitRename = (): void => {
  if (newName.value) emit('rename', newName.value)
}

const noop = (): void => {}
</script>

<style scoped>
.side-bar-folder > .folder-name {
  cursor: default;
  user-select: none;
  display: flex;
  align-items: center;
  height: 30px;
  padding-right: 15px;
}

.side-bar-folder > .folder-name > .icon-arrow {
  flex-shrink: 0;
  color: var(--sideBarIconColor);
  margin-right: 5px;
  transition: transform 0.25s ease-out;
  transform: rotate(90deg);
}

.side-bar-folder > .folder-name > .icon-arrow.fold {
  transform: rotate(0);
}

.side-bar-folder > .folder-name:hover {
  background: var(--sideBarItemHoverBgColor);
}

.side-bar-file {
  display: flex;
  position: relative;
  align-items: center;
  cursor: default;
  user-select: none;
  height: 30px;
  box-sizing: border-box;
  padding-right: 15px;
}

.side-bar-file:hover {
  background: var(--sideBarItemHoverBgColor);
}

.side-bar-file > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.side-bar-file::before {
  content: '';
  position: absolute;
  display: block;
  left: 0;
  background: var(--themeColor);
  width: 2px;
  height: 0;
  top: 50%;
  transform: translateY(-50%);
  transition: all 0.2s ease;
}

.side-bar-file.current::before {
  height: 100%;
}

.side-bar-file.current > span {
  color: var(--themeColor);
}

.side-bar-file.active > span {
  color: var(--sideBarTitleColor);
}

.new-input,
input.rename {
  outline: none;
  height: 22px;
  margin: 5px 0;
  padding: 0 6px;
  color: var(--sideBarColor);
  border: 1px solid var(--floatBorderColor);
  background: var(--floatBorderColor);
  width: 70%;
  border-radius: 3px;
}

input.rename {
  padding: 0 8px;
  width: 100%;
}
</style>
