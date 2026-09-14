<template>
  <div
    ref="fileEl"
    :title="file.pathname"
    class="side-bar-file"
    :style="{ 'padding-left': `${depth * 6 + 10}px`, opacity: file.isMarkdown ? 1 : 0.75 }"
    :class="[{ current: currentFilePathname === file.pathname, active: file.id === activeItem.id }]"
    @click="handleFileClick"
  >
    <file-icon :name="file.name" />
    <input
      v-if="renameCache === file.pathname"
      ref="renameInput"
      v-model="newName"
      type="text"
      class="rename"
      @click.stop="noop"
      @keypress.enter="rename"
    />
    <span v-else>{{ file.name }}</span>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useProjectStore } from '@/store/project'
import { useEditorStore } from '@/store/editor'
import FileIcon from './icon.vue'
import { showContextMenu } from '../../contextMenu/sideBar'
import bus from '../../bus'
import type { TreeFileNode } from './types'

const props = defineProps<{
  file: TreeFileNode
  depth: number
  currentFilePathname: string
}>()

const projectStore = useProjectStore()
const editorStore = useEditorStore()

const newName = ref('')
const fileEl = ref<HTMLDivElement | null>(null)
const renameInput = ref<HTMLInputElement | null>(null)

const { renameCache } = storeToRefs(projectStore)
const { activeItem } = storeToRefs(projectStore)
const { clipboard } = storeToRefs(projectStore)

// from fileMixins
const handleFileClick = (): void => {
  const { isMarkdown, pathname } = props.file
  if (!isMarkdown) return
  editorStore.OPEN_OR_SWITCH_FILE(pathname)
}

const noop = (): void => {}

const focusRenameInput = (): void => {
  nextTick(() => {
    if (renameInput.value) {
      renameInput.value.focus()
      newName.value = props.file.name
    }
  })
}

const rename = (): void => {
  if (newName.value) {
    projectStore.RENAME_IN_SIDEBAR(newName.value)
  }
}

const handleContextMenu = (event: MouseEvent): void => {
  event.preventDefault()
  projectStore.CHANGE_ACTIVE_ITEM(props.file)
  showContextMenu(event, !!clipboard.value)
}

onMounted(() => {
  if (fileEl.value) {
    fileEl.value.addEventListener('contextmenu', handleContextMenu)
  }

  bus.on('SIDEBAR::show-rename-input', focusRenameInput)
})

onBeforeUnmount(() => {
  fileEl.value?.removeEventListener('contextmenu', handleContextMenu)
  bus.off('SIDEBAR::show-rename-input', focusRenameInput)
})
</script>

<style scoped>
.side-bar-file {
  display: flex;
  position: relative;
  align-items: center;
  cursor: default;
  user-select: none;
  height: 30px;
  box-sizing: border-box;
  padding-right: 15px;
  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }
  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  &::before {
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
input.rename {
  height: 22px;
  outline: none;
  margin: 5px 0;
  padding: 0 8px;
  color: var(--sideBarColor);
  border: 1px solid var(--floatBorderColor);
  background: var(--floatBorderColor);
  width: 100%;
  border-radius: 3px;
}
</style>
