<template>
  <div
    class="opened-file"
    :title="file.pathname"
    :class="[{ active: isActive, unsaved: !file.isSaved }]"
    @click="selectFile(file)"
  >
    <el-icon class="close-icon" :size="10" @click.stop="removeFileInTab(file)">
      <Close />
    </el-icon>
    <span class="name">{{ file.filename }}</span>
  </div>
</template>

<script setup lang="ts">
import { useEditorStore } from '@/store/editor'
import { Close } from '@element-plus/icons-vue'
import type { TabDescriptor } from './types'

const props = defineProps<{
  file: TabDescriptor
  isActive: boolean
}>()

const editorStore = useEditorStore()

const selectFile = (file: TabDescriptor): void => {
  if (!props.isActive) {
    editorStore.UPDATE_CURRENT_FILE(file)
  }
}

const removeFileInTab = (file: TabDescriptor): void => {
  const { isSaved } = file
  if (isSaved) {
    editorStore.FORCE_CLOSE_TAB(file)
  } else {
    editorStore.CLOSE_UNSAVED_TAB(file)
  }
}
</script>

<style scoped>
.opened-file {
  display: flex;
  user-select: none;
  height: 28px;
  line-height: 28px;
  padding-left: 35px;
  position: relative;
  color: var(--sideBarColor);
  & > .close-icon {
    display: none;
    position: absolute;
    top: 9px;
    left: 10px;
    cursor: pointer;
  }
  &:hover > .close-icon {
    display: inline-flex;
  }
  &:hover {
    background: var(--sideBarItemHoverBgColor);
  }
  & > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
.opened-file.active {
  color: var(--highlightThemeColor);
}
.unsaved.opened-file::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--highlightThemeColor);
  position: absolute;
  top: 11px;
  left: 12px;
}
.unsaved.opened-file:hover::before {
  content: none;
}
</style>
