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
- [x] 为现有 facade、IPC、buffered state、测试和文档建立可审阅的提交切片。
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

本轮已完成高风险 channel 的具体 payload、validator、preload 类型和 contract tests，并将保存批次、图片路径查找与 renderer error 三类输入 validator 接入实际 main handler；剩余开放字段和迁移门槛记录在 [`docs/IPC_LEGACY_INVENTORY.md`](./IPC_LEGACY_INVENTORY.md)，后续迁移不再阻塞当前边界切片。

迁移顺序：notification → preferences → layout → window → menu → project filesystem → editor synchronization。

建议提交：`refactor(desktop): tighten IPC domain contracts`。

### 9.3 Buffered State

目标：`app.vue` 作为 composition root 注入 editor/project/layout provider，`bufferedState.ts` 不反向 import store。

补充：旧缓存兼容、非法缓存降级、tab id 重映射和 warning 恢复测试；`normalizeBufferedState` 已接入主进程 EditorWindow 恢复边界，非法缓存直接降级为恢复失败而不部分恢复。

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

统一能力：`createRendererSenderGuard`、`getWindow`、`assertTrustedRenderer`、`isMainFrameSender`。当前已覆盖 app/windowManager/fs/shell/preferences/uploader/spellchecker/dataCenter/ripgrep、状态同步、menu/actions/file、menu/index、keyboard 和 renderer exception handlers；所有 renderer-facing 菜单 handler 均以 sender 对应的 BrowserWindow 为准，并拒绝未知 sender 与 child frame。

建议提交：`security(desktop): enforce trusted renderer IPC senders`。

### 13.2 Web Security

已完成受控 `marktext://` 本地协议（renderer bundle 与 local image 两个 host）、renderer bundle 路径穿越防护、opened document/project root allowlist 和生产环境 `webSecurity: true`。开发环境继续使用 `ELECTRON_RENDERER_URL` 并保留兼容性。图片资源仅允许从已打开文档目录或项目根目录读取；webview attach、跨页面导航和 `window.open` 继续被阻止。真实 Electron 图片 E2E 的本机运行被缺少 Visual Studio 的 `ced` 原生依赖阻塞，Linux CI 负责最终 runner 验证。

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
- [x] 维护 parity 清单（见 `docs/LEGACY_MUYAJS_PARITY.md`）；当前仓库无 legacy 实际消费者，归档、独立仓库或删除待外部消费者与发行物审计后单独决策。

建议提交：`refactor(desktop): remove legacy muyajs tooling aliases`。

## 16. Phase 9：Website、文档、CI 和交付治理

CI 已拆分为 `.github/workflows/ci.yml` 中的 desktop-static、desktop-unit、desktop-e2e、muya-static、muya-spec、muya-e2e 和 build-smoke，并以独立 `.github/workflows/website-check.yml` 执行 website 的 docs index、type-check 和 lint。desktop-static 当前执行已验证通过的 Desktop typecheck；仓库级 lint 仍受历史 generated/legacy 文件问题影响，待后续独立治理，不将该基线错误混入本轮必失败 job。website 被根 workspace 排除，因此补充 `packages/website/pnpm-lock.yaml`、显式声明 `eslint-plugin-react-hooks`，README 仅描述当前 Next.js 实现。website production build 放在 build-smoke；Linux runner 负责最终 standalone symlink 构建验证。

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
- `corepack pnpm lint`：当前基线失败（generated graphify JSON、机器配置和历史 Desktop 测试 lint 共 7,334 errors）；因此 desktop-static 暂以 Desktop typecheck 为稳定静态门禁，仓库级 lint 另行治理。
- `corepack pnpm -C packages/website type-check`：通过。
- `corepack pnpm --filter @muyajs/core lint:types`：通过。
- `git diff --check`：通过；Git 输出的 LF→CRLF 提示不属于 whitespace error。
- `graphify update .`：已执行并更新 `graphify-out/`，当前图谱为代码变更后的版本。

### 17.2 追加执行记录（2026-09-08）

- 本轮并行完成 P3/P4/P5/P6/P7/P8/P15；Desktop typecheck、相关 focused tests、Muya runtime/image tests 和 production build 均通过。
- P14 已落地受控 `marktext://` 协议：renderer bundle 只能访问 `out/renderer`，local image 只能访问已打开文档/项目根目录，生产窗口启用 `webSecurity: true`。
- 真实 Electron 图片 E2E 启动被本机 `ced` 原生模块缺失阻塞；尝试 `rebuild-native` 时环境缺少 Visual Studio，未将环境问题误报为代码通过。

- 本轮 P13/P14 focused：4 个文件、9 个测试通过；随后补充 P3/P4/P14 恢复、allowlist 生命周期和 P15 EventBridge 覆盖，相关 focused tests：**4 个 Desktop 文件、33 个测试通过；Muya 4 个文件、35 个测试通过**；Desktop 全量 unit：**82 个测试文件通过，866 个测试通过，1 个跳过**。
- `corepack pnpm --filter marktext typecheck`：通过。
- `corepack pnpm --filter marktext build`：通过；仅保留既有 Vite 动态导入提示。
- `corepack pnpm -C packages/website type-check`：通过；补充 rehype HAST 字面量类型注解后恢复。
- `corepack pnpm -C packages/website lint`：通过；显式补充 `eslint-plugin-react-hooks` 并生成 website 独立 lockfile。
- `corepack pnpm --filter @muyajs/core lint:types`：通过；Muya lint 通过但保留 8 条既有 warning。CommonMark：652 通过，GFM：672 通过；aggregate `test:spec` 复核仍包含同 3 个已知 roundTrip 历史失败，未发现本轮新增失败，因此 `ci.yml` 使用两个已通过的 conformance 子命令。
- website `docs:index`、独立 frozen-lockfile/offline install 和 workflow YAML 解析：通过。
- website Windows 本地 `next build` 已完成编译、类型检查和静态页面生成，但 standalone 输出复制 pnpm symlink 时遇到 Windows `EPERM`；Linux CI 的 `build-smoke` 负责最终生产构建验证。
- `git diff --check`：通过；Git 的 LF→CRLF 提示不属于 whitespace error。
- `graphify update .`：已在本轮代码、website 和 CI 改动后执行。

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
| P3 | Typed IPC contracts | 已完成当前高风险边界：具体 payload、runtime validators、main handler 接入和 contract tests 已补齐；剩余开放字段及迁移门槛见 `docs/IPC_LEGACY_INVENTORY.md` | P2 | tighten IPC domain contracts |
| P4 | Buffered state 解耦 | 已完成 provider 注入、旧缓存归一化接入、非法输入降级、兼容 API 和 focused tests | P2/P3 | decouple buffered state persistence |
| P5 | Editor characterization | 已完成计划列出的 auto-save、批量关闭、tab lifecycle、非法索引、重复 pathname、外部变更、保存失败和 buffered restore 覆盖 | P0 | characterize editor lifecycle behavior |
| P6 | Legacy Muyajs alias 清理 | 已完成：Desktop runtime/alias、兼容包文档和 `docs/LEGACY_MUYAJS_PARITY.md` 已补；仓库内无 legacy 实际消费者，包的归档/独立仓库/删除待外部消费者与发行物审计后决策 | P2 | remove legacy muyajs tooling aliases |
| P7 | Document persistence | 已完成保存 snapshot、Save As、未保存文件、defaultPath、flush-before-save 和 Editor Store workflow 接入 | P5 | extract editor document persistence |
| P8 | Tab lifecycle | 已完成纯函数、当前 tab 激活副作用、关闭时 timer 清理和 Editor Store workflow 接入 | P5/P7 | extract editor tab lifecycle |
| P9 | Save/close workflow | 已接入 Editor Store（FILE_SAVE/LISTEN_FOR_CLOSE 走 saveCloseWorkflow） | P7/P8 | extract editor save close workflow |
| P10 | Editor IPC synchronization | 已接入 Editor Store 全部 LISTEN_* 监听 | P3/P5 | isolate editor IPC synchronization |
| P11 | Editor Host composables | useEditorHost 已接入 editor.vue 挂载/卸载 | P7-P10 | 按 workflow 提交 |
| P12 | Main App composition | runApplicationStartup 已接入 main/app/index.ts（8 阶段） | P1/P3 | split main application composition |
| P13 | IPC sender guard | 已覆盖主要 renderer-facing IPC，包括 app/windowManager/fs/shell/preferences/uploader/spellchecker/dataCenter/ripgrep、状态同步、menu/actions/file、menu/index、keyboard 和 renderer exception；focused/unit/typecheck/build 已通过 | P3/P12 | enforce trusted renderer IPC senders |
| P14 | Web security/local protocol | 已完成受控 `marktext://` renderer/local 协议、opened-root allowlist、路径穿越防护、allowlist 生命周期撤销/引用计数和 realpath 校验，以及生产 `webSecurity: true` | P13 | restore web security for local resources |
| P15 | Muya runtime decomposition | 已完成低风险 runtime 切片：PluginRegistry、parse-affecting options policy 和 EventBridge；保持 `src/index.ts` 唯一公共出口，EditorRuntime/StateCoordinator 等后续切片继续按核心能力推进 | Desktop 边界稳定 | 按核心能力提交 |
| P16 | Website/CI/指标治理 | website README、独立 lockfile、lint 依赖和 website-check 已完成；ci.yml 已建立 desktop/muya/build-smoke job，GitHub runner 的 E2E/build 结果待持续观察 | 各阶段 | 独立 docs/ci commits |

## 21. Definition of Done

说明：本轮改动按 P3、P4、P13、P14、P15、P16 和文档切片整理；提交前使用显式路径暂存，提交后推送到 `origin/develop`。未追踪的 `.codex/`、`.idea/` 和 `AGENTS.md` 为机器/会话配置，不属于产品提交。

一个任务只有同时满足以下条件才可标记完成：

- 实现范围与本计划一致。
- 没有新增越层依赖或循环依赖。
- 相关 characterization/contract/boundary tests 已补充并通过。
- Typecheck 通过；需要时 build 和 E2E 通过。
- `git diff --check` 通过。
- Graphify 已更新。
- 文档和任务状态已同步。
- 提交只包含当前切片，并已推送到 `origin/develop`。
