## 1. 性能基线与测量能力

- [x] 1.1 盘点现有 `PERF_TESTING`、`perf:inspect` 和 `perf:inspect-brk` 流程，定义统一的启动 milestone、构建标识、场景名和报告 JSON 结构，并用一个空白编辑器场景验证报告文件可生成
- [x] 1.2 在 Main 启动流程记录进程启动、`ready`、首窗口创建和首个文档请求时间点，并用冷启动测试验证时间点顺序稳定且不写入用户路径或文档正文
- [x] 1.3 在 preload/Renderer 记录 preload 完成、DOM 可用、首屏完成和编辑器可交互时间点，并验证 Renderer 能收到完整事件且启动握手仍可用
- [x] 1.4 增加初始 JS/CSS 资源体积、动态 chunk 首次加载时间、Main/Renderer 进程指标、Renderer JS heap、窗口数和 tab 数采样，并验证报告只包含计数、时间、构建标识和匿名场景名
- [x] 1.5 实现冷启动、暖启动、设置窗口、恢复 tab、多窗口和大文档的可重复测量场景，并验证相同构建重复运行可以输出每次原始样本及汇总统计
- [x] 1.6 基于首轮样本记录开发机与 CI 的基线策略、异常值处理和相对回归阈值候选，并验证基线文档能够追溯到具体构建和场景

## 2. Main 关键启动路径

- [x] 2.1 审计当前 Main 启动代码和未提交重构差异，列出首窗口前必须保留的 CLI/environment、异常处理、单实例、安全策略、早期文件事件、`mt::boot-info`、最小 IPC 和窗口创建入口，并用代码审查清单验证没有覆盖其他 agent 的修改
- [x] 2.2 为首窗口创建、恢复、第二实例和 macOS `activate` 建立幂等启动状态机或共享 Promise，并用重复触发测试验证不会重复创建窗口、重复恢复或清空待处理路径
- [x] 2.3 保证所有首屏可能调用的 IPC channel 在 Renderer 加载前注册轻量 handler，并用同步 `mt::boot-info`、`invoke` 和早期 `send` 集成测试验证 handler 不丢失
- [x] 2.4 将可延迟的服务实现改为 handler 内共享 `ensureService()` 初始化 Promise，并用并发请求、初始化失败和重试测试验证只初始化一次、错误可观察且不会返回悬挂 Promise
- [x] 2.5 将低频命令后端、导出/打印相关服务和非关键诊断移出首窗口关键路径，同时保留必要菜单、快捷键和窗口控制入口，并用首屏功能测试验证菜单状态与命令行为不回归
- [x] 2.6 统一启动阶段的语言、主题和最小偏好读取，避免构造函数重复读取或覆盖值，并用启动截图/行为测试验证首屏无语言或主题闪烁
- [x] 2.7 为延迟任务增加退出取消、失败清理和 listener 幂等保护，并用应用快速退出、重复 `ready`/`activate` 和初始化失败场景验证退出后没有继续执行的任务

## 3. Renderer 加载边界与分包

- [x] 3.1 对生产等价构建生成入口、路由和动态 chunk 体积报告，确认当前最大首屏依赖及其来源，并验证报告可与 1.x 的基线格式关联
- [x] 3.2 将编辑器路由和设置路由改为按路由异步加载，验证编辑器首屏不请求设置页及其子页面，设置窗口也不默认加载 Muya/editor runtime
- [x] 3.3 将 About、Command Palette、Rename、Import 和 Export 设置等低频组件改为按首次使用加载，并验证打开、取消、重复打开和加载失败时的 UI 行为
- [x] 3.4 将 Source Code 模式及 CodeMirror 专用模块改为首次切换时加载，并验证普通编辑模式首屏不请求 CodeMirror、首次切换可编辑且再次切换复用模块
- [x] 3.5 将导出、打印和 PDF 逻辑改为首次执行时加载，增加加载中、失败和取消状态，并验证首屏资源不包含这些低频实现且首次操作结果与原行为一致
- [x] 3.6 基于构建产物和行为测试评估 Element Plus 全量注册与 Muya barrel entry 的选择性导入收益，只合入有明确体积或解析收益的拆分，并验证相关组件、主题和编辑器功能完整
- [x] 3.7 保持 Muya 图表相关 dynamic import 的现有边界，不把 Mermaid、Vega、flowchart、sequence 等依赖重新合并进首屏，并通过 Muya/桌面生产构建验证图表首次使用仍可用

## 4. 窗口、tab 与编辑器运行时生命周期

- [x] 4.1 在 WindowManager、编辑器窗口控制器和 Renderer store 之间明确 Application、Window、Renderer instance 与 Tab state 的所有权及 cleanup 顺序，并用代码级生命周期测试验证关闭窗口会从窗口注册表移除
- [x] 4.2 在编辑器窗口关闭流程释放窗口级 listener、watcher、timer、图片查看器、编辑器实例和窗口引用，并验证保存/关闭确认完成后不再通过全局状态访问已关闭窗口运行时
- [x] 4.3 在设置窗口关闭流程释放设置页组件和窗口专属 listener，并验证关闭设置窗口不会影响编辑器窗口的文档、活动 tab 或菜单状态
- [x] 4.4 为 tab 切换定义可序列化用户状态与可重建 runtime state 的边界，释放不可见 Muya DOM、编辑器实例和临时渲染结果，并用切换往返测试验证正文、未保存标记、光标和滚动位置保持既有语义
- [x] 4.5 在关闭已保存且不需要恢复的 tab 时清理可丢弃文档副本、临时历史快照和渲染缓存，并用对象引用/窗口 tab 计数与内存采样验证关闭后没有无法解释的强引用
- [x] 4.6 保持未保存内容、恢复 buffer、编码、行尾和恢复警告语义，在重启恢复未保存 tab 的场景验证运行时释放不会导致内容丢失或恢复文件提前删除
- [x] 4.7 隔离多窗口的编辑器状态、UI 状态和临时缓存，并用关闭一个窗口、重新打开同一文档和同时操作多个窗口的测试验证其他窗口不受错误清理或已销毁对象影响

## 5. 内存回归与安全行为验证

- [x] 5.1 增加空白启动、多 tab、大文档、关闭 tab、关闭窗口和应用恢复的内存测量场景，验证结果同时区分 Main、Preload、Renderer、JS heap、窗口数和 tab 数
- [x] 5.2 为启动握手、trusted sender guard、导航限制、window.open、安全策略和最小 IPC 增加回归测试，并验证延迟初始化没有产生安全策略空窗
- [x] 5.3 为命令行打开文件、macOS `open-file`、第二实例、`activate` 和启动恢复增加集成测试，并验证请求在首窗口前后都不会丢失、重复或乱序
- [x] 5.4 运行受影响的 unit/integration/e2e 测试、Muya 相关测试和生产构建，验证保存、恢复、解析、序列化、导出和 IPC 契约无回归
- [x] 5.5 对每个性能切片比较首屏资源、启动 milestone、首次低频功能延迟和稳定期内存样本，并验证出现回归时可以只回滚该切片而保留测量工具与行为测试
- [x] 5.6 更新性能文档，记录运行命令、场景前置条件、报告字段、基线解释和已知波动来源，并验证新成员能够按文档重复一次完整测量

## 6. 审计发现的独立缺陷与后续执行队列

以下任务用于把审计发现的、当前启动/内存任务之外的问题转成可直接执行的后续工作。执行前必须先完成对应依赖任务或按 Scope Boundary 拆成新 change，避免与已有性能切片重复修改。

- [x] 6.1 在 Source Code 懒加载切片中一并修复 Find/Replace：加载 CodeMirror dialog/search/searchcursor 和 dialog.css，为 `sourceCode.vue` 注册并清理 `find` / `replace` handler，使用 `findPersistent` / `replace` 打开不透明搜索框；补充 Source Code 模式 Find、Replace、Escape 和背景不透明的 e2e 验收。依赖任务 3.4。
- [x] 6.2 修复文件 watcher 异步与关闭竞态：将 `add()` 的 `stat()` 纳入 try/catch，所有 watcher 回调以可捕获异常方式调用异步函数，发送 IPC 前检查 disposed 和 `win.isDestroyed()`；让 `unwatch()` / `unwatchByWindowId()` 调用统一 `closeFn()`，并在关闭时清除 Linux rename timer。增加文件创建后立即删除、窗口关闭时存在 rename timer 和关闭后不发送事件的测试。依赖任务 4.2。
- [x] 6.3 完成 Sidebar 生命周期清理：将 `tree.vue` 的 bus/document click/contextmenu/keydown handler 命名并在 unmount 移除；为 `treeFile.vue`、`treeFolder.vue` 的 contextmenu 使用命名 handler 并配对移除；保留另一 agent 已新增的 bus off。增加 Files/Search/TOC 来回切换、目录折叠/展开和事件只触发一次的回归测试。
- [x] 6.4 修复 `@hfelix/electron-localshortcut` 丢失 Ctrl/Cmd+Shift 数字或标点的 Shift：新增 patch-package 补丁，保留字符键 Shift；增加 Digit7、标点和字母的平台无关 accelerator probe/unit 测试，并确认录制与运行时匹配一致。建议独立 change。
- [x] 6.5 修复图片路径补全缓存的 macOS stale data：新增统一 clear API，在 `window-all-closed` 清理 `IMAGE_PATH` 和 `watchers`；目录错误或删除时移除对应缓存，对目录 key 做 canonicalization，必要时限制缓存/watcher 数量。增加关闭窗口后重开、目录新增/删除图片和缓存重建测试。建议独立 change。
- [x] 6.6 消除 Command Palette 的 Find Next/Previous 不一致：要么恢复 `edit.find-next` / `edit.find-previous` 命令并验证普通模式、Source Code 模式和搜索框当前项行为，要么从 descriptions 移除两个不可执行 ID；补充 command registry 与 descriptions 一致性测试。
- [x] 6.7 清理全局 UI listener 和 timer：为 `app.vue` dragover 使用命名 handler，unmount 时移除 listener 并清除 import timer；将设置侧栏语言 1 秒轮询改为响应式 locale 或可停止的显式 subscription，并在设置窗口卸载时清理。
- [x] 6.8 评估 `loadMarkdownFile` 大文件 I/O 优化：保留编码、BOM、混合换行、trailing newline 和错误语义，试做首块编码猜测或流式读取，比较大文档启动、watcher change 和保存前内存副本；只有明确收益才合入。依赖任务 5.1 的测量基线。

- [x] 6.9 修复表格跨格选中遮罩导致文字不可见：将 `.mu-table-cell-selected::before` 的背景从 `--editor-color-04`（默认 light 主题为不透明 `#f7f7f7`）改为半透明选中色（如 `--selection-color` 或带 alpha 的 `--theme-color`），保持外边框高亮不变；增加 light 主题下拖选多格后文字仍可见、清除选中后样式恢复正常、dark 主题无回归的 e2e/unit 验收。
