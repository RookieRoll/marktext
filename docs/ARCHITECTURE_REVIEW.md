# MarkText 全项目架构评审与重构路线

> 评审范围：packages/desktop、packages/muya、packages/muyajs、packages/website、docs、scripts 与 CI。
>
> 评审日期：2026-09-04。项目图谱由 graphify 生成并更新；本文记录当前边界、风险与已实施的低风险重构。

## 1. 结论摘要

MarkText 是一个包含多个 package 的 monorepo，包含桌面编辑器、TypeScript 编辑器引擎、旧版兼容引擎和文档网站；root pnpm workspace 当前刻意排除 website，以隔离其独立部署工具链。整体方向是合理的：桌面端已经采用 Electron 的 main -> preload/contextBridge -> renderer 安全边界，编辑器核心也已经从桌面应用中独立为 @muyajs/core。

当前主要矛盾不是“缺少模块”，而是少数模块承担了过多编排职责：

1. packages/desktop 的 renderer store、编辑器组件和 main application composition module 规模过大。
2. renderer 的宿主能力访问已经集中到 renderer/platform facade；下一步应把 facade 从兼容适配层继续演进为按领域划分的 ports/services。
3. IPC channel 名称已经集中类型化，但部分 request/response/event payload 仍为 unknown，类型安全停留在“通道级别”。
4. packages/muya 内部对象图密度高，Muya、Parent、Content、Format 等类型是重构高风险中心，必须先稳定 facade 和测试边界。
5. website、legacy package 和 workspace 配置有迁移残留或部署差异，需要通过文档和 CI 明确“运行时依赖”和“归档/兼容依赖”的区别。

因此推荐采用“先边界、再编排、后核心”的渐进式重构，而不是直接重写编辑器核心。

## 2. Workspace 模块地图

    repo root
    ├─ package.json / pnpm-workspace.yaml / pnpm-lock.yaml  workspace 编排
    ├─ scripts/                                              安装、locale、license、依赖检查
    ├─ docs/                                                 开发文档和架构评审
    ├─ .github/workflows/                                    CI / 发布自动化
    └─ packages/
       ├─ desktop/                                           Electron + Vue 3 产品
       │  ├─ src/main/                                       主进程、窗口、菜单、文件系统、IPC handler
       │  ├─ src/preload/                                    contextBridge 安全适配层
       │  ├─ src/renderer/                                   Vue、Pinia、Muya、CodeMirror、业务流程
       │  ├─ src/shared/                                     IPC 与跨进程可序列化类型
       │  ├─ src/common/                                     跨层可复用且需保持 browser-safe 的工具
       │  └─ test/                                           unit / Playwright E2E
       ├─ muya/                                              @muyajs/core，TypeScript 编辑器引擎
       │  ├─ src/block/                                      block tree 与内容模型
       │  ├─ src/state/                                      Markdown、结构化 state、HTML、TOC、序列化
       │  ├─ src/editor/ / selection/ / history/              编辑、选择、撤销重做
       │  ├─ src/inlineRenderer/ / ui/                       inline 与插件 UI
       │  └─ test/ examples/ e2e/                             conformance、demo、浏览器测试
       ├─ muyajs/                                            @marktext/muyajs，旧版 JavaScript 引擎
       └─ website/                                           Next.js + React 文档/产品站点

packages/muya/examples 与 packages/muya/e2e 是嵌套 workspace package，不属于 Electron 运行时。packages/muyajs 当前保留为独立兼容/归档包，桌面端运行时应继续使用 @muyajs/core，不应重新引入旧 alias。

## 3. 依赖方向与进程边界

    desktop main -> shared contracts
    preload -> shared contracts
    renderer -> shared contracts + @muyajs/core
    renderer <-> preload -> IPC -> main
    website -> content/docs
    scripts -. automation .-> workspace packages
    @marktext/muyajs -. isolated compatibility .- desktop

### Main process

src/main/ 拥有 Electron 生命周期、窗口、菜单、原生对话框、文件系统、自动更新、拼写检查和 IPC handler。它可以访问 Node/Electron，但不应把所有业务编排继续堆进 main/app/index.ts。

### Preload

src/preload/index.ts 是 renderer 的唯一宿主能力入口。它应暴露小而明确的 capability API，而不是把完整 Electron API 或任意 IPC 通道转发给 renderer。当前已有 typed generic wrapper，但还需要继续收紧 payload 和 sender 校验。

### Renderer

renderer 负责 Vue UI、Pinia 状态、tabs、文档工作流、Muya WYSIWYG host 和 CodeMirror source mode。它不应直接 import Electron/Node；宿主能力应按领域封装为 renderer/platform 或 service，并保持可 mock。

### Shared

src/shared/types/ 存放 main、preload、renderer 共同使用的可序列化契约。这里不能引入 Vue、DOM 或 Electron 运行时依赖。

## 4. 各 package 架构分析

### 4.1 packages/desktop

优点：
- Electron 安全配置已经明确：contextIsolation: true、sandbox: true、nodeIntegration: false。
- main/preload/renderer/shared 的进程边界清晰，@muyajs/core 通过 workspace dependency 接入，桌面端不再依赖 legacy muya alias。
- renderer/platform facade 已完成第一阶段迁移，集中封装 filesystem、path、window、ripgrep、uploader、runtime 以及 Electron/clipboard/shell/fonts 等能力；runtime.ts 还负责 document directory（legacy `window.DIRNAME`）的读写。
- renderer-platform-boundary.spec.ts 会扫描 renderer 源码，防止业务模块重新直接读取 preload global。

问题：
- renderer/src/store/editor.ts 约 2,071 行，混合 tabs、文档加载/保存、Muya 适配、selection、undo、导出和 IPC 事件。
- components/editorWithTabs/editor.vue 约 2,141 行，混合编辑器生命周期、Muya 事件、CodeMirror、搜索、导出、滚动和对话框。
- src/main/app/index.ts 约 906 行，混合应用启动、窗口、菜单、IPC、主题和 open-file workflow。
- IPC 仍有历史 channel 的 unknown payload；ripgrep/uploader 已完成领域合同化，notification、preferences、layout 等仍应逐步收紧。

当前 facade 目录：

    renderer/platform/
    ├─ electron.ts    contextBridge 能力访问器：IPC、clipboard、shell、webFrame、fonts 等
    ├─ filesystem.ts  文件读写与文件操作能力
    ├─ path.ts        basename/dirname/join/relative 等路径能力
    ├─ ripgrep.ts     搜索 bridge 与运行时 binary path
    ├─ runtime.ts     windowId、window type、initial state、debug、document directory（legacy DIRNAME）
    ├─ uploader.ts    图片上传 bridge
    └─ window.ts      窗口级 open-file 与 windowId 能力

runtime.ts 是 document-directory facade：getDocumentDirectory/setDocumentDirectory 将 Muya 解析相对本地资源所需的 legacy `window.DIRNAME` 读写留在 platform 边界内；bootstrap 元数据则通过 marktext runtime 访问器统一提供。renderer feature module 不应直接读写这些全局对象。

第一阶段迁移已经完成：从 renderer/src（不含 platform 目录）扫描不到上述 preload global（包括 `window.DIRNAME`）的直接访问。后续重点不再是批量替换 window.*，而是为 editor store、editor host 和 main app 抽出稳定的领域服务，并让这些服务依赖 facade 接口而不是具体全局对象。
### 4.2 packages/muya / @muyajs/core

它是 framework-independent 的 TypeScript 编辑器引擎，公共入口是 src/index.ts。内部包含 block tree、state conversion、inline renderer、编辑行为、selection、history、clipboard、UI plugin、search、i18n 和 utils。

graphify 显示 Muya、Parent、Content、Format、TState、ScrollPage 是连接度最高的对象。当前没有检测到 import cycle，但运行时对象图密度高。建议：

1. 保持 src/index.ts 为稳定 public API hub。
2. 先为 runtime、document/state、rendering、selection 引入明确 interface/facade。
3. 再移动内部实现，避免调用方依赖对象图中的深层字段。
4. 每次修改都运行 CommonMark/GFM、round-trip 和浏览器 E2E。
5. 插件注册尽量 instance-scoped，避免跨实例共享可变状态。

不要直接重写 Muya、Parent 或 Content。

### 4.3 packages/muyajs

该包是旧版 JavaScript 引擎，包含历史实现和生成/兼容资源。当前合理定位是独立兼容/归档 package，而不是 desktop 的运行时依赖。若未来确认没有外部消费者，可以单独制定 deprecation/removal 变更；在此之前不要从 workspace 中强行删除。

### 4.4 packages/website

website 是独立的 Next.js + React 文档/产品站点，内容位于 content/docs，导航、Markdown 解析和搜索位于 src/lib。它不应依赖 Electron renderer 或 Muya runtime。website 的 build、type-check、lint 和部署配置应在 CI 中独立验证；Cloudflare/OpenNext 变更不能反向污染 desktop 的 workspace 依赖。

### 4.5 scripts、docs 与 CI

根 scripts 负责安装、locale、license、依赖检查等仓库自动化，不应承载 desktop domain logic。CI 应按 desktop、Muya、website 分组运行，并明确允许失败的 baseline 与本次变更回归。

## 5. 高风险 God Module

| 模块                                              | 主要职责混合                                                   | 目标拆分                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| renderer/src/store/editor.ts                      | tabs、document load/save、Muya adapter、selection、undo、IPC   | tab lifecycle、document persistence、engine adapter、save/close workflow、selection/navigation |
| renderer/src/components/editorWithTabs/editor.vue | Muya mount、CodeMirror、事件桥、search、export、dialog、scroll | editor host、lifecycle、event bridge、search/export、dialogs                                   |
| main/src/main/app/index.ts                        | bootstrap、window、menu、IPC、theme、open-file                 | application bootstrap、window service、menu service、IPC registration、open-file workflow      |
| renderer/src/pages/app.vue                        | composition、全局监听、主题、drag/drop 初始化                  | 保留 composition root，逐步把初始化监听提取为 composable/service                               |

拆分原则：先提取纯函数和无副作用 service，补 characterization tests，再移动副作用；每一步保持原 public store/component API，避免同时修改业务行为。

## 6. IPC 与安全治理

### 6.1 当前状态

shared/types/ipc.ts 已集中 channel、argument tuple 和 return shape。ripgrep 与 uploader 的 request/response/event payload 已迁移到独立领域类型并在 main handler 入口做运行时验证；notification、preferences、layout、keybindings 和部分 open-file options 仍较宽，后续应按同一方式收紧。

### 6.2 推荐改造

1. 将每个领域的 request/response/event 定义放入 shared/types，优先处理 ripgrep 和 uploader。
2. preload 只暴露领域 API，如 window.ripgrep.start/cancel/onMatch，不要向 renderer 暴露原始 ipcRenderer 能力的扩展。
3. main handler 入口验证外部输入；类型断言不能替代运行时校验。
4. 所有 IPC handler 校验 event.sender 是否属于受信任的 MarkText 窗口。
5. 清理 listener 时使用返回的 unsubscribe；避免在组件销毁时调用全局 removeAllListeners 影响其他功能。
6. 文件、路径、shell 和上传请求都按最小权限设计，拒绝任意协议或任意命令参数。

### 6.3 webSecurity 与本地资源

当前部分窗口仍设置 webSecurity: false，主要是为本地 Markdown 图片/资源加载让路。这与 Electron 官方安全建议冲突，应作为后续安全变更处理：优先注册受控的 app:// 或资源协议，限制可读根目录，并恢复 webSecurity: true。这项改动需要单独的资源加载回归测试，不能与 store 拆分混在同一个提交中。

## 7. 已实施重构

### 7.1 buffered state coordinator 解耦

原先 bufferedState.ts import editor/project/layout store，而这些 store 又 import bufferedState，形成运行时模块环。现在：

    pages/app.vue (composition root)
      └─ registerBufferedStateStores(editor, project, layout)
           └─ bufferedState coordinator

bufferedState.ts 只依赖最小 BufferedStateStore 接口；store 仍可请求 debounce persistence，但不再通过 coordinator 反向 import store。新增 focused tests 覆盖未注册、snapshot 和 IPC 发送。

### 7.2 清理 desktop 的 legacy muyajs 依赖

已移除 desktop manifest 中的 @marktext/muyajs、Vite/Vitest muya alias、TypeScript legacy path 和 muya.d.ts ambient declaration。desktop 统一使用 @muyajs/core；packages/muyajs 仍作为独立兼容包保留。

## 8. 分阶段重构计划

### Phase 1：边界与契约（已完成）

- 已完成 buffered-state 的显式依赖注入，不重新引入 store-to-store import。
- 已完成 renderer/platform facade 第一阶段迁移，并由 renderer-platform-boundary.spec.ts 守护边界。
- 已将 ripgrep/uploader 的 unknown payload 收紧为领域类型，并在 main handler 侧增加 runtime validation。
- 后续继续处理 notification、preferences、layout 等 legacy IPC payload，同时统一 sender 校验与协议白名单。

### Phase 2：Desktop 编排拆分

- 已为 `renderer/src/store/editor.ts` 建立加载、保存、切换和关闭流程 characterization tests；下一步在这些测试保护下抽取 document persistence 和 tab lifecycle。
- 将 editor store 拆为 tab lifecycle、document persistence、engine adapter、save/close workflow、selection/navigation 与 IPC synchronization，且不改变 store 对组件的现有 API。
- 将 `components/editorWithTabs/editor.vue` 收敛为 editor host/orchestrator；把编辑器生命周期、事件桥、search/export 和 dialogs 提取为 composable/service。
- 将 `main/app/index.ts` 拆为 application startup coordinator、window lifecycle、menu registration、IPC registration、update/open-file workflow 等 focused services，并保持启动顺序显式可追踪。

### Phase 3：Muya 核心演进

- 保持 public export hub 和现有 conformance/round-trip/E2E 套件。
- 把 runtime orchestration 与 block/state/rendering service 分开。
- 用明确 interface 降低 Parent/Content/Format 对深层对象图的依赖。
- 逐步收敛全局可变 plugin 状态。

### Phase 4：交付与可观测性

- desktop、Muya、website 分开执行 lint/typecheck/test/build。
- 增加 forbidden import、IPC schema 和安全配置检查。
- 记录 startup time、save latency、renderer bridge usage 与 bundle size。
- 将已知 baseline 测试失败单独登记，不与新变更回归混淆。

## 9. 验证基线

本轮已验证：

- desktop typecheck 通过。
- 11 个 focused test files / 43 个 tests 通过；新增覆盖 buffered state、IPC contracts、platform facade、renderer boundary、architecture boundaries、editor store characterization、keybinding、upload、listen-for-main 和 i18n。
- 针对本轮改动文件执行 ESLint：0 errors，剩余 warnings 为既有非空断言/未使用变量问题。
- desktop 全量 unit 的既有 baseline 为 53 个 test files、746 个 tests：722 passed、1 skipped、23 failed；失败主要集中在 Windows/jsdom 路径差异、PDF 测试超时、theme emoji/font patch 和 export HTML 超时，不应直接归因于本轮 facade/IPC 改动。

验证命令：

    corepack pnpm --filter marktext typecheck
    corepack pnpm --filter marktext exec vitest run test/unit/specs/platform-facade.spec.ts test/unit/specs/renderer-platform-boundary.spec.ts test/unit/specs/architecture-boundaries.spec.ts test/unit/specs/editor-store-characterization.spec.ts test/unit/specs/ipc-contracts.spec.ts test/unit/specs/buffered-state.spec.ts test/unit/specs/keybinding-style.spec.ts test/unit/specs/keybinding-reload.spec.ts test/unit/specs/upload-image.spec.ts test/unit/specs/listen-for-main.spec.ts test/unit/specs/i18n.spec.ts
    corepack pnpm --filter @muyajs/core lint:types
    corepack pnpm --filter marktext build
    corepack pnpm -C packages/website type-check
    git diff --check

## 10. 最佳实践参考

- Electron Security：启用 context isolation、sandbox，关闭 nodeIntegration，避免关闭 webSecurity，校验 IPC sender，并优先使用受控协议。
- Electron IPC：通过 preload/contextBridge 暴露窄 API，避免 renderer 直接获得原始 Electron 能力。
- Vue Composables：把有状态的可复用逻辑从组件中提取为 composable，并让生命周期清理与创建逻辑成对出现。
- Pinia：store 管理共享状态，组件/页面负责组合依赖；避免通过隐式 import 形成 store 初始化环。

参考实现时以官方文档和当前 Electron/Vue/Pinia 版本为准；第三方文章只用于补充设计思路，不替代项目现有测试和安全边界。
