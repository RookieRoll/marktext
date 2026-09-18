## Why

MarkText 当前的启动关键路径同时加载了编辑器、设置页、Element Plus、Muya UI 插件、导出与 Source Code 模式等大量功能；主进程也在首窗口创建前同步初始化偏好、命令、菜单、快捷键和多个服务。现有生产构建中 Renderer 首入口约 6.8 MB，且每个编辑器窗口都会重复承担一套 Renderer 运行时，导致冷启动延迟和多窗口内存占用随功能规模增长。现在正值 Main App、Renderer Store 和 Muya runtime 重构阶段，需要在行为和 Electron 安全边界保持稳定的前提下建立性能基线，并将非关键工作移出首屏路径。

## What Changes

- 增加可重复的启动性能测量能力，记录 Main、Preload、Renderer、首窗口、首屏渲染、编辑器可交互和首个文档加载等阶段。
- 拆分 Renderer 的加载边界：编辑器窗口不再默认加载设置页；设置窗口不再默认加载编辑器核心；低频弹窗、导出、打印和 Source Code 模式按需加载。
- 缩减首屏的 UI 和编辑器运行时依赖，评估 Element Plus 全量注册、Muya barrel entry 及静态导入对启动和内存的影响。
- 拆分 Main 进程关键启动路径与延迟初始化路径，在保留单实例、安全 IPC、窗口安全策略和必要窗口控制的前提下延迟非关键命令、菜单、快捷键和服务工作。
- 统一主进程语言、偏好和主题初始化，避免在多个构造函数或启动阶段重复读取和设置。
- 梳理窗口、tab、文档、历史记录和编辑器实例的生命周期，确保关闭窗口或 tab 后不再保留不必要的文档内容、历史状态和事件监听器。
- 建立启动时间、首屏资源体积、每窗口内存和恢复场景内存的回归检查；性能目标以现有基线为依据，不改变编辑器保存、恢复、解析、序列化或 IPC 安全语义。

## Capabilities

### New Capabilities

- `startup-performance`: 提供稳定的启动阶段指标，并支持验证关键路径缩减和非关键模块延迟加载。
- `memory-lifecycle`: 定义编辑器窗口、tab、文档状态和运行时资源的释放与内存测量要求。

### Modified Capabilities

无。当前仓库没有已注册的 OpenSpec capability；本变更先创建性能相关规范，后续若发现现有行为规范，再通过 delta spec 修改。

## Impact

- 主要影响 `packages/desktop/src/main`、`packages/desktop/src/preload`、`packages/desktop/src/renderer/src`、`packages/muya/src` 及相关测试和性能文档。
- 可能调整 `electron.vite.config.ts`、Renderer 路由/入口、Muya package exports、Main App/Accessor 初始化顺序和性能测试脚本。
- 不改变公开编辑器行为、文件格式、保存/恢复语义、IPC channel 契约或 Electron 的 sandbox、contextIsolation 和可信 Renderer sender 边界。
- 需要与当前正在进行的 Main App、Editor Store、Muya runtime 重构协调，避免覆盖另一 agent 的未提交修改；性能变更应以现有行为测试和基线测量为前置条件。
- 预计会新增或更新启动集成测试、Renderer 分包/懒加载测试、窗口和 tab 生命周期测试，以及性能测量文档或脚本。
