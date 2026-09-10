# 窗口、tab 与编辑器运行时所有权

本切片按实际代码边界维护资源所有权，不把 Renderer-only 运行时对象写入可恢复的 tab 状态。

## 所有权层次

```text
Application
  ├─ WindowManager
  │   ├─ window registry: Map<windowId, BaseWindow>
  │   ├─ active-window/activity 状态
  │   ├─ AppMenu 窗口菜单
  │   └─ shared Watcher（按 windowId 归属 watcher subscription）
  ├─ EditorBufferStore
  │   └─ 按 restoreBufferId 索引的磁盘恢复文件元数据
  └─ EditorWindow
      ├─ BrowserWindow 引用与窗口生命周期
      ├─ 打开文件/目录列表和 local-protocol root
      ├─ pending open timer / pending open payload
      └─ renderer（独立 BrowserWindow/WebContents）
          ├─ Pinia editor/project/layout：可序列化用户状态
          ├─ Muya / CodeMirror / ImageViewer / PrintService：可重建 runtime
          └─ tab runtime maps：只保存当前 Renderer 会话中的 undo/runtime 数据
```

每个 Electron `BrowserWindow` 有独立 Renderer 全局，因此 editor store、bus、Muya DOM、CodeMirror 和临时 viewer 不跨窗口共享。Main 只通过 `windowId`、`restoreBufferId` 和受信任的 WebContents sender 定位窗口；恢复文件是明确的 Application 级能力，不属于某个 Renderer 实例的强引用。

## 关闭顺序

1. Renderer 先执行既有 flush/save/confirm 流程；未保存 tab 的 Markdown、编码、行尾、cursor、scrollTop 和恢复警告先写入恢复 buffer。
2. Main `WindowManager` 收到关闭请求后先调用 `EditorBufferStore.handleClose()`，只在没有恢复需要且满足既有窗口条件时删除已保存 buffer。
3. `WindowManager` 从 watcher、AppMenu 和 window registry 释放窗口级资源；registry 删除发生在 re-entrant lifecycle callback 之前。
4. `EditorWindow._finalizeWindowClosed()` 清除 pending open timer、local protocol roots、打开文件/目录列表、buffer handle、id 和 BrowserWindow 引用，并进入 `QUITTED`。
5. Renderer editor component 在卸载时先取消延迟 export/command 工作，再移除 bus/DOM/scroll listener，断开 ResizeObserver，清理 spellchecker、printer、image viewer，最后调用 `Muya.destroy()`；tab 的可序列化状态不在这里删除。
6. Editor store 在窗口页卸载时取消 auto-save timers；buffered-state debounce 不由该清理误取消，避免关闭确认完成前丢失未保存恢复快照。

所有异步文件读取和恢复回调在发送 IPC 或修改窗口专属列表前重新检查 `_isWindowUsable()`，因此关闭后的旧 Promise 不会触碰已销毁 WebContents，也不会影响新建或其他窗口。

## Tab 状态边界

- **可序列化状态**：Markdown、`isSaved`、encoding/BOM、line ending、trailing-newline 选项、cursor、Muya index cursor、scrollTop、word count、恢复 warning，以及既有保存/撤销语义需要的 history snapshot。
- **可重建 runtime**：Muya DOM、Muya instance、CodeMirror instance、image viewer、print container、ResizeObserver、scroll/keyboard/bus listener、auto-save timer 和临时渲染结果。
- Tab 切换先 flush 当前 editor，再发出带 tab id 的 `file-changed`，恢复 Markdown/cursor/scrollTop，并按 tab id 恢复当前会话的 engine history；关闭 tab 时清除 auto-save timer，组件 watcher 删除已关闭 tab 的 runtime map 条目。
- 关闭已保存且无需恢复的 tab 不删除其它 tab 或其它窗口的状态；关闭窗口也不删除应用级恢复文件，除非 `EditorBufferStore.handleClose()` 根据既有规则确认可以删除。
