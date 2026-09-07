# MarkText 全项目渐进式重构开发计划

> 文档状态：执行中（Living Document）  
> 创建日期：2026-09-04  
> 适用分支：`develop`  
> 关联评审：[ARCHITECTURE_REVIEW.md](./ARCHITECTURE_REVIEW.md)

## 1. 文档目的

本文将全项目架构评审结论转换为可执行、可验证、可分批提交的开发计划。计划覆盖 `packages/desktop`、`packages/muya`、`packages/muyajs`、`packages/website`、`docs`、`scripts` 和 CI/CD，不采用一次性重写，而是通过边界治理、行为基线、纯函数提取、副作用隔离和逐阶段验证降低重构风险。

本文是任务、验收和提交边界的唯一计划基线；架构现状和问题证据以 `docs/ARCHITECTURE_REVIEW.md` 为准。每完成一个切片，应同步更新本文的状态、验证结果和提交信息。

## 2. 总体目标

1. 明确 Main、Preload、Renderer、Shared 和 Muya 的职责与依赖方向。
2. 缩减 `editor.ts`、`editor.vue`、`main/app/index.ts` 等高密度模块。
3. 建立类型化 IPC、运行时校验和可信 Renderer sender 边界。
4. 保持 `@muyajs/core` 为 Desktop 唯一编辑器运行时，隔离 legacy `packages/muyajs`。
5. 移除更新检查和自动更新功能及其依赖、菜单、命令、IPC 和文档说明。
6. 通过 characterization、contract、boundary 和 E2E 测试保护现有行为。
7. 每个重构切片可独立验证、提交、推送和回滚。

## 3. 非目标

- 不一次性重写 Electron 应用。
- 不直接重写 `Muya`、`Parent`、`Content`、`Format`。
- 不在同一提交中同时拆分 Editor Store、Editor Host 和 Main App。
- 不在缺少行为测试时改变保存、关闭、恢复、解析或序列化语义。
- 不把 `.idea/`、`.codex/` 或机器相关配置混入产品代码提交。
- 不因名称包含 update 而删除文件树刷新、菜单刷新或 Floating UI 的 `autoUpdate`。

## 4. 当前架构基线

仓库为 pnpm workspace，主要模块如下：

| 模块 | 当前职责 | 主要风险 |
| --- | --- | --- |
| `packages/desktop` | Electron Main/Preload/Renderer/Shared | God Module、IPC 历史契约、安全边界 |
| `packages/muya` | TypeScript 编辑器内核 `@muyajs/core` | 核心对象图高耦合、插件全局状态 |
| `packages/muyajs` | legacy JavaScript 编辑器包 | 与当前运行时边界混淆 |
| `packages/website` | Next.js 文档和产品网站 | 文档与实现状态漂移 |
| `scripts` | 构建、许可证、资源脚本 | 工作区任务和发布流程耦合 |

重构前初始高风险文件规模：

| 文件 | 规模（约） | 混合职责 |
| --- | ---: | --- |
| `renderer/src/store/editor.ts` | 2,071 行 | tab、保存、Muya、选择、导出、IPC、通知 |
| `components/editorWithTabs/editor.vue` | 2,141 行 | Muya、CodeMirror、搜索、导出、图片、事件、对话框 |
| `main/app/index.ts` | 906 行 | 启动、窗口、菜单、IPC、应用生命周期 |

接手时知识图谱初始基线约为 9,029 个节点、19,455 条边和 486 个社区；代码修改后必须执行 `graphify update .`。

## 5. 目标依赖方向

    Renderer UI
        ↓
    Application Store / Workflow
        ↓
    Domain Service / Pure Functions
        ↓
    Renderer Platform Facade
        ↓
    Typed Preload Bridge
        ↓
    Main IPC Handlers
        ↓
    Electron / Node / Filesystem

禁止依赖：

- Renderer 业务模块直接访问 `window.electron` 或 Node API。
- Shared types 依赖 Vue、DOM 或 Electron runtime。
- Domain service 直接 import Pinia store。
- Desktop runtime import legacy `@marktext/muyajs`。
- 模块在 import 时隐式注册大量 listener。

## 6. 重构执行原则

1. 先边界、后内部：先稳定 IPC、Preload 和 Platform，再拆业务模块。
2. 先测试、后移动：先记录当前行为，再移动代码。
3. 先纯函数、后副作用：状态计算和 payload 生成优先提取。
4. 保持公共 API：第一阶段不改变 `useEditorStore()` 和 Muya 公共 API。
5. 单一主题提交：生产代码、测试、文档可在同一完整切片中提交，但不得混入无关修改。
6. 显式暂存：禁止 `git add .` 和 `git commit -a`。
7. 每次提交前执行类型检查、聚焦测试和 `git diff --check`。
8. Subagent 仅在写集不重叠且确有并行收益时使用；小型或强耦合任务由主线程执行。

## 7. Phase 0：工作树和交付基线

### 7.1 任务

- [x] 按主题盘点当前未提交修改。
- [x] 排除 `.idea/`、`.codex/`、本地 AGENT 配置和无关 Website 配置。
- [ ] 为现有 facade、IPC、buffered state、测试和文档建立可审阅的提交切片。
- [x] 保存当前 focused tests、typecheck、build 和全量 unit 验证快照（无法生成 pristine baseline）。

### 7.2 验收标准

- 每个待提交文件都有明确所属主题。
- 不使用会覆盖已有修改的 reset/restore 操作。
- 提交前可通过 `git diff --cached` 完整审阅。

### 7.3 建议提交

本阶段不提交生产功能；仅用于建立安全基线。

## 8. Phase 1：移除更新检查和自动更新

### 8.1 目标

完全移除手动检查、自动检查、下载、安装、更新通知和 updater 运行时依赖；保留 GitHub Release、构建安装包和用户手动升级能力。

### 8.2 Main Process

修改 `packages/desktop/src/main/menu/actions/marktext.ts`：

- 删除 `electron-updater` import。
- 删除 `autoUpdater.autoDownload`。
- 删除 error、update-available、update-not-available、update-downloaded listener。
- 删除 `downloadUpdate()`、`checkForUpdates()`、`quitAndInstall()`。
- 删除 `mt::NEED_UPDATE`、`mt::check-for-update` handler。
- 删除 `checkUpdates()`、`runningUpdate` 和 updater window 状态。
- 保留 userSetting 和 macOS hide/show actions。

修改菜单和命令：

- `src/main/menu/templates/help.ts`：删除 Help 菜单的检查更新入口和 `isUpdatable()`。
- `src/main/menu/templates/marktext.ts`：删除 macOS 检查更新入口。
- `src/main/menu/actions/file.ts`：删除 `FILE_CHECK_UPDATE` 注册。
- `src/common/commands/constants.ts`：删除 `FILE_CHECK_UPDATE`。

### 8.3 Renderer、Preload 和 Shared

- 删除 `renderer/src/store/autoUpdates.ts`。
- 从 `renderer/src/pages/app.vue` 删除 Store 创建和 listener 注册。
- 从 `renderer/src/commands/index.ts` 删除 `file.check-update`。
- 若无其他消费者，删除 `renderer/src/commands/utils.ts`。
- 从 `renderer/src/platform/electron.ts` 删除 `isUpdatable()`。
- 从 `main/ipc/bootInfo.ts` 删除 `computeIsUpdatable()` 和字段。
- 从 `preload/index.ts`、`types/global.d.ts` 删除 `isUpdatable` 暴露。
- 从 `shared/types/ipc.ts` 删除更新相关 send/event channel 和 `BootInfo.isUpdatable`。

不得误删：`mt::update-file`、`mt::update-object-tree`、菜单刷新通道和 Muya/Floating UI 的 `autoUpdate`。

### 8.4 依赖、本地化和文档

- 从 `packages/desktop/package.json` 删除 `electron-updater`。
- 由 pnpm 更新 `pnpm-lock.yaml`；不得手工删除仍被 electron-builder 使用的传递依赖。
- 从 `static/locales/*.json` 删除无消费者的检查更新文案键。
- 更新 `website/content/docs/end-user/INSTALLATION.md`：说明通过 Releases 或包管理器手动升级。
- 更新架构文档，删除当前系统仍包含 auto-updates 的描述。
- 历史 Changelog 不修改。

### 8.5 验收标准

- Desktop 源码无 `electron-updater` import。
- 不存在更新专用菜单、命令、Store 和 IPC。
- Desktop manifest 和 lockfile 无直接 `electron-updater` 依赖。
- 其他 update 命名的业务功能保持不变。
- Typecheck、focused tests 和 Desktop build 通过。

### 8.6 建议测试和提交

新增 `test/unit/specs/auto-update-removal.spec.ts`，检查依赖、菜单、命令和 IPC 边界。

建议提交：`refactor(desktop): remove update checks and auto updater`。

## 9. Phase 2：完成 Desktop 边界治理

### 9.1 Renderer Platform Facade

目标目录：

    renderer/src/platform/
    ├─ electron.ts
    ├─ filesystem.ts
    ├─ path.ts
    ├─ ripgrep.ts
    ├─ runtime.ts
    ├─ uploader.ts
    └─ window.ts

任务：

- [x] 所有 Renderer feature/store/component 通过 facade 使用宿主能力（生产代码中的宿主能力访问已收敛到 `renderer/src/platform/`）。
- [x] `window.DIRNAME` 仅由 runtime facade 兼容读写。
- [x] 边界测试禁止直接访问 preload globals、Electron 和 Node built-ins。

建议提交：`refactor(desktop): establish renderer platform boundary`。

### 9.2 Typed IPC Contracts

每个 IPC 迁移必须包含 channel、request、response/event payload、runtime validator、main handler、preload 声明、renderer consumer 和 contract test。

迁移顺序：notification → preferences → layout → window → menu → project filesystem → editor synchronization。

建议提交：`refactor(desktop): tighten IPC domain contracts`。

### 9.3 Buffered State

目标：`app.vue` 作为 composition root 注入 editor/project/layout provider，`bufferedState.ts` 不反向 import store。

补充：旧缓存兼容、非法缓存降级、tab id 重映射和 warning 恢复测试。

建议提交：`refactor(desktop): decouple buffered state persistence`。

## 10. Phase 3：拆分 Editor Store

目标结构：

    store/editor/
    ├─ index.ts
    ├─ types.ts
    ├─ documentPersistence.ts
    ├─ tabLifecycle.ts
    ├─ editorEngineAdapter.ts
    ├─ saveCloseWorkflow.ts
    ├─ selectionNavigation.ts
    ├─ ipcSynchronization.ts
    └─ externalFileSynchronization.ts

### 10.1 Characterization 基线

补齐 auto-save timer、批量关闭、tab 交换/循环、非法索引、重复 pathname、外部文件变更、保存失败和 buffered restore 测试。

### 10.2 Document Persistence

先抽取纯数据投影：save snapshot、save-as payload、unsaved file payload、SaveOptions 和 defaultPath。该模块不得依赖 Pinia、Store、Electron、window、bus 或 notification。

必须保持顺序：flush active editor → 读取 markdown → 构造 snapshot → 发送保存请求。

建议提交：`refactor(desktop): extract editor document persistence`。

### 10.3 Tab Lifecycle

先抽取 buildTabIndex、removeTabs、selectTabAfterClose、cycleTabIndex、exchangeTabs、findTabByPath 等纯函数。最后才处理含副作用的 UPDATE_CURRENT_FILE、FORCE_CLOSE_TAB 和 CLOSE_TABS。

建议提交：`refactor(desktop): extract editor tab lifecycle`。

### 10.4 Save/Close Workflow

通过窄 effects 接口组合保存、确认、关闭和 buffered-state 调度，不把完整 Store 传入 service。

建议提交：`refactor(desktop): extract editor save close workflow`。

### 10.5 IPC Synchronization

listener 注册应显式调用、只注册一次并返回 cleanup；handler 可独立测试。

建议提交：`refactor(desktop): isolate editor IPC synchronization`。

## 11. Phase 4：拆分 Editor Vue Host

目标结构：

    components/editorWithTabs/
    ├─ editor.vue
    ├─ composables/
    │  ├─ useEditorHost.ts
    │  ├─ useEditorLifecycle.ts
    │  ├─ useEditorEvents.ts
    │  ├─ useEditorSearch.ts
    │  ├─ useEditorExport.ts
    │  ├─ useEditorDialogs.ts
    │  ├─ useEditorImages.ts
    │  └─ useSourceCodeMode.ts
    └─ adapters/
       ├─ muyaAdapter.ts
       └─ codeMirrorAdapter.ts

拆分顺序：搜索 → 导出 → 对话框 → 图片 → event bridge → source mode → Muya 生命周期。最终 `editor.vue` 只负责容器、props、组合和挂载/卸载。

每个 workflow 单独提交，避免把多个行为变更捆绑。

## 12. Phase 5：拆分 Main App Composition

目标结构：

    main/app/
    ├─ index.ts
    ├─ applicationStartup.ts
    ├─ applicationLifecycle.ts
    ├─ windowLifecycleService.ts
    ├─ menuRegistrationService.ts
    ├─ ipcRegistration.ts
    ├─ openFileWorkflow.ts
    └─ securityPolicy.ts

启动顺序必须显式：protocol → IPC → security policy → preferences → menus → state/windows restore → first window → lifecycle events。

自动更新移除后不再创建 updateService。

验收：无重复 IPC 注册；macOS activate/open-file、Windows second-instance、窗口恢复和关闭行为不变。

建议提交：`refactor(desktop): split main application composition`。

## 13. Phase 6：Electron 安全治理

### 13.1 IPC Sender Guard

按风险分批接入：文件写入/删除 → shell → window control → preferences → uploader → spellchecker → 状态同步。

统一能力：`createRendererSenderGuard`、`getWindow`、`assertTrustedRenderer`、`isMainFrameSender`。

建议提交：`security(desktop): enforce trusted renderer IPC senders`。

### 13.2 Web Security

独立设计受控 `app://` 本地资源协议，限制允许读取的根目录；完成图片、主题、导出和 PDF 回归后恢复 `webSecurity: true`。

建议提交：`security(desktop): restore web security for local resources`。

## 14. Phase 7：Muya 核心演进

- 保持 `src/index.ts` 为唯一公共出口。
- 将 Muya facade 与 EditorRuntime、PluginRegistry、EventBridge、StateCoordinator 分离。
- 从 Parent、Content、Format 中优先提取 traversal、mutation、serialization、formatting policy 和 selection mapping。
- 插件状态逐步实例化，同时保持 `Muya.use(...)` 兼容。
- 每次运行 CommonMark/GFM、round-trip、clipboard、history、selection、table、image 和 browser E2E。

建议按单一核心能力独立提交，不与 Desktop UI 混合。

## 15. Phase 8：Legacy Muyajs 治理

目标是隔离而非立即删除：

- [x] Desktop runtime 不依赖 `@marktext/muyajs`。
- [x] 删除 Desktop 中 legacy Vite/Vitest/TypeScript alias。
- [x] 文档说明 `packages/muyajs` 为兼容/归档包。
- [ ] 维护 parity 清单；全部消费者迁移后再决定归档、独立仓库或删除。

建议提交：`refactor(desktop): remove legacy muyajs tooling aliases`。

## 16. Phase 9：Website、文档、CI 和交付治理

CI 拆分为 desktop-static、desktop-unit、desktop-e2e、muya-static、muya-spec、muya-e2e、website-check 和 build-smoke。

持续跟踪：启动时间、首次渲染、大文件打开、保存延迟、搜索延迟、bundle size、preload API 数量、unknown IPC 数量和 God Module 行数。

Website 只描述当前有效功能；历史 Changelog 保持不变。

## 17. 验证矩阵

每个 Desktop 切片至少执行：

    corepack pnpm --filter marktext typecheck
    corepack pnpm --filter marktext exec vitest run <focused specs>
    git diff --check
    graphify update .

边界或构建变更额外执行：

    corepack pnpm --filter marktext build
    corepack pnpm -C packages/website type-check

Muya 变更执行：

    corepack pnpm --filter @muyajs/core lint:types
    corepack pnpm --filter @muyajs/core test:spec

在全量 unit 存在历史失败时，必须同时记录：基线失败、当前失败、是否新增失败，不得仅报告“全量未通过”。
### 17.1 本轮执行记录（2026-09-04）

- 当前接手时工作树已有大量未提交修改，因此没有可复现的 pristine baseline；本轮第一次全量 unit 在 71 个文件中有 2 个文件的 12 项失败，均定位为 Windows 路径 fixture 或动态模块 mock 隔离问题，不是生产逻辑回归。
- 修复测试隔离并接入本轮高风险 IPC guard 后，当前全量 unit：**75 个测试文件通过，831 个测试通过，1 个跳过**；未发现本轮新增失败。
- 本轮新增/重构 focused tests：P1/P7-P13 主切片共 **18 个文件、64 个测试通过**；跨平台、主题和 PDF 等回归测试共 **7 个文件、53 个测试通过**。
- `corepack pnpm --filter marktext typecheck`：通过。
- `corepack pnpm --filter marktext build`：通过；仅保留既有 Vite 动态导入提示。
- `corepack pnpm -C packages/website type-check`：通过。
- `corepack pnpm --filter @muyajs/core lint:types`：通过。
- `git diff --check`：通过；Git 输出的 LF→CRLF 提示不属于 whitespace error。
- `graphify update .`：已执行并更新 `graphify-out/`，当前图谱为代码变更后的版本。

## 18. 提交与推送规范

每个切片按以下流程：

    git add <显式文件列表>
    git diff --cached --check
    git diff --cached
    git commit -m "<imperative message>"
    git push origin develop

禁止 `git add .`、`git commit -a` 和覆盖已有修改的 reset/restore。提交说明必须列出问题、方案、测试和手工验证平台。

建议提交顺序：

1. `refactor(desktop): remove update checks and auto updater`
2. `refactor(desktop): establish renderer platform boundary`
3. `refactor(desktop): tighten IPC domain contracts`
4. `refactor(desktop): decouple buffered state persistence`
5. `test(desktop): characterize editor lifecycle behavior`
6. `refactor(desktop): remove legacy muyajs tooling aliases`
7. `docs: document MarkText architecture and refactoring roadmap`
8. Editor Store、Editor Host、Main App 和安全切片依次提交。

## 19. 风险与回滚

| 风险 | 缓解方式 | 回滚单位 |
| --- | --- | --- |
| 保存前未 flush | 保留 flush-before-save 测试 | document persistence commit |
| 关闭 tab 选择变化 | characterization 覆盖首/中/尾和批量关闭 | tab lifecycle commit |
| listener 重复注册 | 显式 register/cleanup 和单次注册测试 | IPC synchronization commit |
| 旧缓存无法恢复 | schema validator、迁移和降级测试 | buffered state commit |
| preload 契约漂移 | shared contract + preload + main 联合提交 | IPC contract commit |
| 本地资源无法加载 | app protocol 和图片/主题/PDF 回归 | web security commit |
| Muya 行为回归 | conformance、round-trip 和 E2E | 单个 Muya 能力 commit |
| 工作树混入无关改动 | 显式路径/hunk staging | 单个提交 |

原则上使用普通 revert 回滚已经推送的独立提交，不重写共享分支历史。

## 20. 任务状态总表

| ID | 任务 | 状态 | 依赖 | 建议提交 |
| --- | --- | --- | --- | --- |
| P0 | 工作树与验证基线 | 提交切片已按主题整理并推送（P1/P2/P7-P13 主切片 + 测试隔离） | 无 | 不提交 |
| P1 | 移除更新检查和自动更新 | 已完成，focused/build/typecheck 通过 | P0 | remove update checks and auto updater |
| P2 | Renderer platform boundary | 已实现，边界测试/typecheck/build 通过 | P0 | establish renderer platform boundary |
| P3 | Typed IPC contracts | 部分实现，待整理提交 | P2 | tighten IPC domain contracts |
| P4 | Buffered state 解耦 | 已实现，待整理提交 | P2/P3 | decouple buffered state persistence |
| P5 | Editor characterization | 已实现基础覆盖，待扩展 | P0 | characterize editor lifecycle behavior |
| P6 | Legacy Muyajs alias 清理 | Desktop runtime/alias 已清理，兼容包文档已补；parity 清单待补 | P2 | remove legacy muyajs tooling aliases |
| P7 | Document persistence | 最小切片已实现，Editor Store 已部分接入，待完整 workflow 接入 | P5 | extract editor document persistence |
| P8 | Tab lifecycle | 最小切片已实现，Editor Store 已部分接入，待副作用收敛 | P5/P7 | extract editor tab lifecycle |
| P9 | Save/close workflow | 已接入 Editor Store（FILE_SAVE/LISTEN_FOR_CLOSE 走 saveCloseWorkflow） | P7/P8 | extract editor save close workflow |
| P10 | Editor IPC synchronization | 已接入 Editor Store 全部 LISTEN_* 监听 | P3/P5 | isolate editor IPC synchronization |
| P11 | Editor Host composables | useEditorHost 已接入 editor.vue 挂载/卸载 | P7-P10 | 按 workflow 提交 |
| P12 | Main App composition | runApplicationStartup 已接入 main/app/index.ts（8 阶段） | P1/P3 | split main application composition |
| P13 | IPC sender guard | 已接入 app/windowManager/fs/shell/preferences/uploader/spellchecker/dataCenter/ripgrep/状态同步/menu/actions/file；剩余低耦合 IPC 待继续覆盖 | P3/P12 | enforce trusted renderer IPC senders |
| P14 | Web security/local protocol | 待设计 | P13 | restore web security for local resources |
| P15 | Muya runtime decomposition | 待执行 | Desktop 边界稳定 | 按核心能力提交 |
| P16 | Website/CI/指标治理 | 持续执行 | 各阶段 | 独立 docs/ci commits |

## 21. Definition of Done

说明：本轮用户未要求提交或推送；因此状态表中的“已完成/已实现”仅表示实现与验证完成，不表示已整理成独立提交或已推送到 origin/develop。交付状态将在后续按主题切片整理。

一个任务只有同时满足以下条件才可标记完成：

- 实现范围与本计划一致。
- 没有新增越层依赖或循环依赖。
- 相关 characterization/contract/boundary tests 已补充并通过。
- Typecheck 通过；需要时 build 和 E2E 通过。
- `git diff --check` 通过。
- Graphify 已更新。
- 文档和任务状态已同步。
- 提交只包含当前切片，并已推送到 `origin/develop`。
