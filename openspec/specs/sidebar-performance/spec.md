# sidebar-performance Specification

## Purpose

定义大型项目在侧边栏初始扫描、项目树构建、可见节点渲染、节点事件处理和侧边栏拖拽交互中的规模性能要求，确保打开和操作大型目录时耗时、IPC、DOM、监听器和内存不会随节点数量不受控增长，同时保持既有文件树行为与 Electron 安全边界不变。

## Requirements

### Requirement: Initial directory discovery MUST NOT read Markdown content

系统 SHALL 将目录初始扫描限制为文件和目录元数据采集；在用户实际打开文件前，初始扫描 MUST NOT 读取 Markdown 正文、执行完整编码探测或把文件内容随项目树事件发送给 Renderer。用户打开文件或文件 watcher 需要内容更新时，系统 SHALL 通过按需内容加载路径取得正文，并保持既有编码、换行、trim 和错误语义。

#### Scenario: Open a large project without opening documents

- **WHEN** 用户打开包含大量 Markdown 文件的目录，且未打开其中任何文档
- **THEN** Main 进程 SHALL NOT 为初始项目树读取任何 Markdown 文件正文
- **AND** 发送给 Renderer 的初始项目树数据 SHALL 只包含构建侧边栏所需的元数据
- **AND** 项目树 SHALL 能正确展示名称、类型、创建时间和修改时间排序所需的信息

#### Scenario: Open a document after project discovery

- **WHEN** 用户从已完成元数据扫描的项目树中打开一个 Markdown 文件
- **THEN** 系统 SHALL 按需读取该文件内容并使用既有解析、编码和换行规则
- **AND** 未打开文件的内容不得仅因项目已被扫描而留在 Renderer 项目树状态中

#### Scenario: Markdown file changes while being watched

- **WHEN** 已打开或需要内容更新的 Markdown 文件发生外部变更
- **THEN** 系统 SHALL 继续读取变更内容并保持现有 `mt::update-file` 行为
- **AND** 为降低初始扫描开销而引入的元数据路径不得导致内容更新丢失或使用过期正文

### Requirement: Initial project tree delivery MUST be batched

系统 SHALL 在 watcher 完成初始发现后，以一个项目树快照或数量有界且远小于节点数的批次把初始结果交付给 Renderer；初始扫描 MUST NOT 为每个节点分别执行一次独立 IPC 发送和一次深层响应式树变更。扫描期间到达的真实文件系统变更 MUST NOT 丢失或重复，并 SHALL 在初始快照应用后以确定的顺序继续生效。

#### Scenario: Discover a large directory tree

- **WHEN** watcher 对包含大量文件和目录的大型项目完成初始扫描
- **THEN** 初始树数据 SHALL 通过快照或数量有界的批次发送
- **AND** 发送次数和 Renderer 树提交次数 SHALL NOT 与初始节点总数一一对应
- **AND** 项目树完全应用后 SHALL 与扫描结果一致

#### Scenario: File changes during initial discovery

- **WHEN** 用户在初始扫描或快照构建期间创建、删除或修改文件
- **THEN** 对应变化 SHALL 在初始树应用后反映，或与初始快照合并为等价结果
- **AND** 不得因快照覆盖而丢失变化、重复创建节点或把过期节点重新带回树中

#### Scenario: Renderer receives initial snapshot before project state is ready

- **WHEN** 初始快照在 Renderer 项目状态完成恢复或打开前到达
- **THEN** 系统 SHALL 能暂存快照并以项目根路径将其应用到正确项目
- **AND** 不得把前一项目的事件应用到新项目或产生不可恢复的树状态

### Requirement: Visible file tree MUST be virtualized

系统 SHALL 只渲染文件树视口及其合理预加载范围内的可见行；展开大目录或大量文件夹时，已挂载的树组件和 DOM 行数 MUST NOT 与所有可见逻辑节点数线性增长。虚拟化 SHALL 保留滚动、展开/折叠、活动文件、键盘导航、上下文菜单和创建/重命名输入框的既有可访问行为。

#### Scenario: Expand a folder with thousands of children

- **WHEN** 用户展开一个包含数千个文件或子目录的文件夹
- **THEN** 已挂载的文件树行数 SHALL 保持与视口高度和预加载范围成比例
- **AND** 滚动到任意位置后对应行 SHALL 正确显示并可交互
- **AND** 文件树总滚动高度 SHALL 能反映全部逻辑行

#### Scenario: Search or jump to an off-screen tree node

- **WHEN** 活动文件、键盘导航或程序化定位指向当前视口之外的树节点
- **THEN** 系统 SHALL 将对应逻辑行滚入视口并按需挂载
- **AND** 不得因节点未挂载而丢失选中状态、焦点或展开状态

#### Scenario: Use the tree after virtualization

- **WHEN** 用户在虚拟化后的文件树中执行展开、折叠、选择、重命名、创建文件或打开上下文菜单
- **THEN** 操作 SHALL 作用于正确的逻辑节点
- **AND** 输入框、菜单锚点和滚动位置不得因行复用而错位或指向错误文件

### Requirement: Per-node event subscriptions and listeners MUST be bounded

文件树 SHALL 将创建、重命名、活动状态和上下文菜单相关通知从每个节点的独立全局监听改为集中注册和按目标路由；单个节点的挂载 MUST NOT 增加无界数量的全局 bus 监听、Pinia 订阅或 DOM 上下文菜单监听。集中处理 SHALL 保持同一操作的触发次数和结果与既有行为一致。

#### Scenario: Render a large visible tree

- **WHEN** 文件树渲染大量可见或已挂载节点
- **THEN** 全局创建/重命名/活动状态监听数量 SHALL 保持为常量或与树容器数量成比例
- **AND** 每个节点不得为同一组全局通知额外注册一份长期监听

#### Scenario: Rename or create one target node

- **WHEN** 用户对一个文件或文件夹触发创建或重命名并提交输入
- **THEN** 只有目标目录或目标节点 SHALL 进入对应输入状态
- **AND** 其他节点不得显示输入框、重放操作或收到重复通知

#### Scenario: Open a node context menu

- **WHEN** 用户右键点击文件树中的文件、文件夹或空白区域
- **THEN** 系统 SHALL 显示与目标节点和区域匹配的既有上下文菜单
- **AND** 在容器上集中处理事件不得改变菜单项、活动节点或文件系统操作结果

### Requirement: Sidebar resize updates MUST be frame-coalesced

侧边栏水平拖拽 SHALL 将高频指针移动合并为每个动画帧最多一次宽度更新，并在拖拽结束时提交最终宽度。合并更新 MUST NOT 丢失最终指针位置、改变最小宽度约束或破坏宽度持久化。

#### Scenario: Drag the sidebar with a large tree visible

- **WHEN** 用户在大文件树可见时连续拖动侧边栏宽度
- **THEN** 渲染更新 SHALL 按动画帧合并，而不是对每个 `mousemove` 事件各执行一次布局更新
- **AND** 拖拽过程中侧边栏 SHALL 持续跟随指针且保持可交互

#### Scenario: Complete a sidebar resize

- **WHEN** 用户释放鼠标完成拖拽
- **THEN** 最终宽度 SHALL 与最后指针位置对应并遵守最小宽度约束
- **AND** 持久化的侧边栏宽度 SHALL 与界面显示一致，后续重开或重新挂载时不得回到错误宽度

### Requirement: File tree behavior MUST remain equivalent after optimization

性能优化 SHALL 保持项目树在排序、创建、重命名、删除、复制粘贴、文件外部变更、打开文件和窗口切换方面的可见行为、错误反馈与状态一致性。若优化需要调整项目树 IPC 数据结构，系统 MUST 提供单向迁移或兼容路径，并且不得扩大 Renderer 可访问的文件系统能力。

#### Scenario: Use existing file tree operations on a large project

- **WHEN** 用户在大型项目中按既有方式创建、重命名、删除、复制、粘贴或打开文件
- **THEN** 操作结果、排序、活动文件和错误通知 SHALL 与优化前语义一致
- **AND** 操作 SHALL 在规模化项目中保持与项目大小无关的合理响应

#### Scenario: External changes arrive after initial load

- **WHEN** 项目树已完成初始加载后收到外部文件或目录新增、删除或修改
- **THEN** 树 SHALL 按既有规则更新、排序并保持活动文件和展开状态
- **AND** 批量初始加载路径不得吞掉后续 watcher 事件

#### Scenario: Performance optimization preserves security boundary

- **WHEN** Renderer 通过优化后的项目树数据或内容加载路径请求文件能力
- **THEN** 请求 SHALL 继续经过既有 preload/contextBridge IPC 和 sender 校验边界
- **AND** 不得在 Renderer 中暴露 Node 文件系统对象、任意路径读取能力或未校验的主进程操作
