## Context

参见 `proposal.md` 的 Why，以及以下两个规范：

- `specs/startup-performance/spec.md`
- `specs/memory-lifecycle/spec.md`

当前桌面应用已经有 `applicationStartup.ts` 和 `App.ready()` 的阶段编排，但 `Accessor`、`App`、`AppMenu`、`WindowManager` 仍在首窗口之前完成较多构造、IPC listener 注册和同步文件操作。Renderer 入口还静态加载设置路由、Element Plus 全量插件、编辑器、导出能力、Source Code 组件和多个隐藏对话框。另一方面，preload 在脚本加载阶段通过 `mt::boot-info` 执行同步 IPC，文件关联、第二实例和安全策略也必须在首窗口加载前可用。

本设计必须与当前 Main App、Editor Store 和 Muya runtime 的重构并行工作，但不得覆盖其他 agent 的未提交修改。安全边界、文件打开/恢复语义、保存和 IPC 契约优先于性能收益。

## Goals / Non-Goals

**Goals:**

- 先建立冷启动、暖启动、恢复、多窗口和大文档的可重复基线，再按阶段优化。
- 将启动流程明确划分为“首窗口关键路径”和“首屏后可延迟路径”。
- 保持启动握手 IPC、可信 Renderer sender 校验、安全策略、文件打开事件和窗口生命周期在关键路径内。
- 通过窗口/路由/功能边界减少 Renderer 初始加载范围和每窗口常驻对象。
- 让首次使用被延迟的功能具有幂等、可观察、可失败恢复的加载机制。
- 在 tab、窗口和编辑器运行时之间建立可验证的资源所有权和清理边界。

**Non-Goals:**

- 不重写 Muya 的解析、渲染、序列化或历史模型。
- 不改变 Markdown 文件格式、保存/恢复语义、撤销语义或 IPC channel 的公共契约。
- 不删除 Mermaid、KaTeX、Vega、PlantUML、CodeMirror、导出或打印能力。
- 不把安全 IPC、sender guard、导航限制或窗口生命周期监听延迟到首窗口之后。
- 不在没有基线数据的情况下制定绝对毫秒数、固定内存上限或盲目限制历史记录深度。
- 不把已经按需加载的图表引擎重新合并进首屏，也不与当前重构 agent 重复拆分相同模块。

## Decisions

### 1. 采用两层启动模型，而不是整体延迟 `Accessor`

启动分为：

```text
Critical startup
  CLI / environment
  exception and crash handling
  single-instance lock
  security policy
  early file and second-instance capture
  boot-info and minimum IPC handlers
  minimum preferences
  first window creation

Post-first-paint startup
  optional service implementation
  low-frequency command backends
  deferred dialogs and export/print modules
  non-critical diagnostics
```

`Accessor`、`AppMenu` 或 `WindowManager` 不会整体延迟。它们保留轻量的生命周期对象和必要的注册入口；只有不影响首窗口的重型实现延迟加载。这样可以避免 Renderer 请求到达时对象不存在，同时减少首启动同步工作。

替代方案是把整个 `Accessor` 或 `registerSandboxIpcHandlers()` 放入 `setImmediate()` / `Promise.then()`。该方案会产生 preload 启动竞态、早期 IPC 丢失、文件打开事件丢失和安全策略空窗，因此不采用。

### 2. IPC 采用“先注册、后加载实现”

所有首屏可能调用的 IPC channel SHALL 在 Renderer 加载前注册轻量 handler。handler 内部使用共享的 `ensureService()` 初始化 Promise 延迟加载重型实现：

```text
register channel
      |
      v
first request --> ensureService()
                  |-- first call: start one initialization Promise
                  |-- concurrent call: await same Promise
                  |-- later call: reuse loaded service
```

`mt::boot-info` 的同步握手保持同步、缓存和无用户数据输出。字体列表、低频导出、打印或其他可延迟能力可以在 handler 第一次调用时加载，但不得通过“延迟注册 handler”实现。

### 3. 早期事件使用缓存和显式状态机

命令行路径、macOS `open-file`、第二实例和启动恢复请求继续在 Main 早期收集到缓存中。启动状态使用幂等状态机或共享 Promise 表示：

```text
not-started -> initializing -> ready
                         \-> failed
```

`ready`、macOS `activate`、第二实例和退出流程都必须复用该状态，不得重复执行一次性初始化。窗口创建和恢复操作在同一状态机内串行协调，以避免空窗口、重复恢复或路径请求被清空。

### 4. Renderer 按窗口类型和功能边界分包

先采用低风险的路由级和组件级异步加载：

- 编辑器路由动态加载编辑器页面。
- 设置路由动态加载设置页面及其子页面。
- 编辑器页面中的 About、Command Palette、Export、Rename、Import 等低频组件按需加载。
- Source Code 模式只在首次切换时加载 CodeMirror 专用模块。
- 导出、打印和 PDF 逻辑只在首次执行相应操作时加载。

Element Plus 的全量注册和 Muya barrel entry 的进一步拆分作为独立验证步骤，必须以构建产物和行为测试确认收益后推进。Muya 的图表 dynamic import 保持现状，不在此变更中重新设计。

### 5. Muya 运行时与导出运行时分离

Desktop 优先使用当前 Muya runtime 重构提供的最小编辑器入口；编辑器入口只暴露首屏和编辑交互需要的能力，Markdown/HTML/PDF 导出能力通过独立入口或按需模块加载。具体 exports 形状在实现阶段根据现有 `packages/muya/src/runtime/` 和构建结果确定，但不得复制一套新的编辑器运行时。

替代方案是继续从 `@muyajs/core` 根入口导入所有能力并依赖 tree-shaking。该方案目前已经产生较大的 Renderer 入口，且不能控制首次使用时的模块 parse/evaluate 时间，因此不作为唯一优化手段。

### 6. 以所有权为中心治理内存释放

资源所有权按以下层次划分：

```text
Application
  +-- WindowManager: window registry and window-level activity
  +-- EditorWindow: BrowserWindow, watcher and restore handle
       +-- Renderer instance: stores, Muya, CodeMirror, UI listeners
            +-- Tab state: serializable user-visible document state
```

关闭窗口或组件时，先执行既有保存/确认流程，再通过显式 cleanup 释放 listener、watcher、编辑器实例、图片查看器、定时器和窗口引用。tab 状态只保留恢复和用户可见语义所需的数据；Muya DOM、不可见编辑器实例和临时渲染结果不得作为长期 tab 状态保留。

在有 Heap Snapshot 或重复测量证据前，不强制新增历史条数上限，也不删除可能用于恢复的 Markdown 或 buffer 数据。对于已保存且不再需要恢复的 tab，清理可丢弃副本和临时快照；未保存内容和恢复 buffer 仍遵守现有持久化语义。

### 7. 测量采用现有生产等价流程并增加结构化事件

复用现有 `PERF_TESTING`、`perf:inspect` 和 `perf:inspect-brk` 流程，增加结构化的启动 milestone 和内存采样。指标至少分为：

- Main：启动脚本、`ready`、首窗口创建、首个文档请求。
- Renderer：preload 完成、DOM 可用、首屏完成、编辑器可交互。
- 资源：初始 JS/CSS 体积、动态 chunk 首次加载时间。
- 内存：Main/Renderer working set 或等价进程指标、Renderer JS heap、活动窗口/tab 数量。

报告只输出时间、计数、构建标识和匿名化场景名称，不写入 Markdown 正文、用户路径、偏好值或恢复内容。

## Risks / Trade-offs

- **[早期 IPC 丢失]** 延迟 handler 注册可能导致 preload 或首屏请求失败。→ 所有关键 channel 先注册轻量 handler；使用启动集成测试覆盖 `sendSync`、`invoke` 和早期 `send`。
- **[安全策略空窗]** 窗口先加载、策略后注册会扩大导航或 window.open 风险。→ 安全策略和 trusted sender guard 在首窗口加载前完成，延迟任务只加载已注册 handler 的实现。
- **[首次使用延迟]** 懒加载会把 parse/evaluate 成本移动到第一次导出、打印或打开设置时。→ 显示明确的加载状态，复用初始化 Promise，并分别测量首屏和首次功能使用延迟。
- **[事件重复注册]** `ready`、`activate` 或 HMR 可能重复调用初始化。→ 所有一次性初始化使用状态机/共享 Promise，并为 listener registration 提供幂等保护和 cleanup。
- **[恢复竞态]** 延迟恢复可能与命令行打开、第二实例或用户新建文件交叉。→ 继续使用 Main 的路径缓存，在恢复和首窗口可用之前串行消费请求，并增加恢复场景测试。
- **[功能分包回归]** 动态 import 可能改变 Vite chunk 边界、路径或构建时 tree-shaking 结果。→ 每个分包切片都检查生产构建、首屏请求和功能首次使用，失败时按切片回滚。
- **[内存指标不稳定]** Chromium GC、操作系统工作集和后台进程会造成样本波动。→ 固定构建和场景，重复采样并报告原始值和汇总值；先建立基线，再设置相对回归阈值。
- **[与并行重构冲突]** Main App、Editor Store、Muya runtime 正在修改同一批文件。→ 先完成行为/性能基线，按模块边界拆分提交，合并前重新检查未提交 diff 和相关测试。

## Migration Plan

1. **基线阶段**：记录空白编辑器、暖启动、设置窗口、恢复 tab、多窗口和大文档场景；保存构建体积、启动时间和内存样本。
2. **关键路径阶段**：补充启动 milestone；确认安全策略、启动握手、文件事件、第二实例和最小 IPC 在首窗口前完成；不改变用户行为。
3. **Renderer 分包阶段**：先拆分设置路由和低频弹窗，再拆分 Source Code、导出和打印；每个切片独立构建和验证。
4. **Main 延迟阶段**：将可延迟服务改为“先注册轻量 handler、首次调用加载实现”；为延迟任务增加取消、失败和退出处理。
5. **生命周期阶段**：根据 Heap Snapshot 和内存场景收敛窗口、tab、文档副本、watcher 和 listener 的清理；保留未保存和恢复所需数据。
6. **回归阶段**：运行相关 unit/integration/e2e 测试、production build、性能场景和内存场景；确认 IPC 安全边界与保存恢复语义无回归。

回滚策略是按阶段回滚最后一个性能切片，不回滚已验证的行为测试和测量工具。若懒加载在特定平台出现回归，可先恢复该功能的静态导入，同时保留启动指标以继续定位。

## Open Questions

- 首轮基线完成后，性能回归阈值应按开发机固定百分位、CI 机器基线，还是二者同时维护？这不改变关键路径和分包设计。
- 内存报告首版使用 Electron 进程指标、Chromium heap snapshot，还是两者并列输出？这只影响测量实现，不改变生命周期约束。
