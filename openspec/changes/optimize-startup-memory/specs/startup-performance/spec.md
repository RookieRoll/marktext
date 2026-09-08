## Purpose

为 MarkText 提供可重复、可比较且不泄露用户文档内容的启动性能验证能力，并确保优化启动路径时不会破坏首窗口、IPC、安全策略或文件打开行为。

## ADDED Requirements

### Requirement: Repeatable startup measurement

系统 SHALL 提供一个可重复的本地性能测量路径，用于记录生产等价构建在冷启动和暖启动下的关键阶段时间与资源指标。

#### Scenario: Measure a cold editor startup

- **WHEN** 使用生产等价构建、清理应用缓存并启动编辑器窗口进行性能测量
- **THEN** 测量结果 SHALL 至少包含 Main process 启动、首窗口创建、Renderer 开始加载、DOM 可用、首屏完成和编辑器可交互时间点
- **AND** 结果 SHALL 同时记录 Renderer 初始资源体积、Main/Renderer 内存采样和构建标识

#### Scenario: Compare repeated runs

- **WHEN** 使用相同构建和相同启动场景执行多次测量
- **THEN** 工具 SHALL 输出每次结果以及可比较的汇总统计
- **AND** 测量过程 SHALL 不把 Markdown 正文、用户路径或偏好内容写入结果

### Requirement: Preserve the critical startup safety boundary

系统 SHALL 在首个 Renderer 开始加载前完成必要的安全策略、启动参数和文件打开事件接收、启动握手 IPC，以及首窗口所需的最小 IPC handler 注册。非关键服务 MAY 延迟初始化，但延迟过程 MUST NOT 使首个 Renderer 请求无响应、丢失或绕过可信 sender 校验。

#### Scenario: Preload boot handshake arrives before deferred services

- **WHEN** preload 在延迟服务初始化完成前执行启动握手或调用首屏所需的 IPC
- **THEN** 请求 SHALL 获得有效响应或明确的可等待结果
- **AND** 不得出现未注册 handler、同步握手阻塞或 Renderer 白屏

#### Scenario: File open event arrives during startup

- **WHEN** 用户在应用启动期间通过命令行、文件关联或第二实例请求打开 Markdown 文件
- **THEN** 系统 SHALL 暂存并在首个可用编辑器窗口中按既有规则打开该请求
- **AND** 请求不得因延迟初始化而丢失、重复打开或覆盖恢复状态

#### Scenario: Untrusted renderer sends an early request

- **WHEN** 非可信 Renderer 在延迟服务初始化期间发送 IPC 请求
- **THEN** 系统 SHALL 继续执行现有的 sender 校验和安全拒绝行为
- **AND** 延迟初始化不得扩大可访问的 IPC 或文件系统权限

### Requirement: Isolate window-specific startup work

系统 SHALL 按窗口类型隔离启动所需的 UI、运行时和状态；编辑器窗口 MUST NOT 因设置页未被访问而初始化设置专用页面和逻辑，设置窗口 MUST NOT 因未编辑文档而初始化编辑器专用运行时。

#### Scenario: Open an editor window

- **WHEN** 应用只创建编辑器窗口
- **THEN** 首屏加载路径 SHALL 只包含编辑器交互所需的模块和资源
- **AND** 设置专用页面不得成为编辑器首屏的必需加载项

#### Scenario: Open a settings window

- **WHEN** 用户首次打开设置窗口
- **THEN** 设置页面 SHALL 能够独立加载其所需资源
- **AND** 未使用的编辑器文档状态、Muya 编辑实例和编辑器 tab UI 不得因设置窗口创建而初始化

### Requirement: Defer optional work without losing first-use behavior

系统 SHALL 将导出、打印、低频对话框、非首屏搜索能力和其他可识别的非关键功能移出首屏关键路径；当用户第一次使用这些功能时，系统 MUST 完成加载、提供可理解的等待或错误反馈，并保持既有功能语义。

#### Scenario: First use of a deferred feature

- **WHEN** 用户首次触发一个尚未加载的低频功能
- **THEN** 系统 SHALL 在功能完成加载后继续执行用户操作，或显示明确的失败原因
- **AND** 功能首次使用不得造成未捕获异常、静默丢失操作或破坏当前文档状态

#### Scenario: Concurrent first use

- **WHEN** 多个请求在同一低频功能完成初始化前同时到达
- **THEN** 系统 SHALL 复用同一次初始化或以等价方式合并请求
- **AND** 不得重复注册 handler、重复加载相同运行时或产生多个互相冲突的实例

### Requirement: Make deferred Main initialization lifecycle-safe

延迟初始化任务 SHALL 具备幂等、可观察和退出安全的行为；应用退出、窗口销毁或初始化失败后，系统 MUST NOT 继续创建窗口、注册重复 listener 或写入已失效的状态。

#### Scenario: Application exits during deferred initialization

- **WHEN** 应用在延迟任务完成前退出
- **THEN** 延迟任务 SHALL 被取消、忽略或安全收尾
- **AND** 不得在退出后创建窗口、注册新的全局 listener 或产生未处理拒绝

#### Scenario: macOS reactivation after initialization

- **WHEN** macOS 在已有启动流程或已完成初始化后再次触发 activate
- **THEN** 系统 SHALL 复用已完成或进行中的初始化状态
- **AND** 不得重复执行一次性启动逻辑或重复创建恢复窗口
