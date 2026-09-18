# memory-lifecycle Specification

## Purpose

为 MarkText 建立窗口、tab、文档和编辑器运行时的资源生命周期约束，在保持未保存内容、恢复状态和用户可见行为不变的前提下，减少关闭或切换后仍被长期持有的对象和文档副本。

## Requirements

### Requirement: Release closed window resources

当编辑器或设置窗口关闭时，系统 SHALL 解除该窗口相关的 Renderer 事件订阅、编辑器运行时、watcher、临时任务和窗口引用；关闭窗口后不得继续通过全局状态访问其专属运行时对象。

#### Scenario: Close an editor window

- **WHEN** 用户关闭一个编辑器窗口并完成既有保存/关闭确认流程
- **THEN** 该窗口的编辑器实例、窗口级 listener、图片或文件 watcher 和临时异步任务 SHALL 被释放或进入明确的退出状态
- **AND** 其他窗口和应用级恢复机制 SHALL 继续正常工作

#### Scenario: Close a settings window

- **WHEN** 用户关闭设置窗口
- **THEN** 设置页组件和窗口专用 listener SHALL 不再被该窗口持有
- **AND** 关闭设置窗口不得影响编辑器窗口的文档内容或活动状态

### Requirement: Preserve document state while releasing replaceable runtime state

系统 SHALL 在 tab 切换或窗口关闭时保留用户可见所需的 Markdown、未保存标记、编码、行尾、光标和恢复信息；同时 MUST 允许释放可重建的 DOM、编辑器实例、临时渲染结果和其他 replaceable runtime state。

#### Scenario: Switch between tabs

- **WHEN** 用户从一个 tab 切换到另一个 tab，再返回原 tab
- **THEN** 原 tab 的文档内容、未保存状态和既有光标/滚动位置 SHALL 保持现有语义
- **AND** 切换过程不得要求同时长期保留多个不可见的完整编辑器 DOM 实例

#### Scenario: Restore unsaved tabs after restart

- **WHEN** 应用关闭后重新启动并恢复包含未保存内容的 tab
- **THEN** 恢复结果 SHALL 与优化前的可见文档内容、保存状态和恢复警告语义一致
- **AND** 释放运行时对象不得导致未保存内容丢失或恢复文件被提前删除

### Requirement: Bound long-lived document duplication

系统 SHALL 识别并限制长期存活的完整文档副本、历史快照、序列化 buffer 和临时 IPC payload 的重复保留；任何为保存、恢复、撤销或导出创建的额外副本 MUST 具有明确的生命周期。

#### Scenario: Edit a large document

- **WHEN** 用户编辑大体积 Markdown 文档并持续输入
- **THEN** 系统 SHALL 避免因每次输入或普通 tab 切换而无限累积完整文档副本
- **AND** 历史、buffer 和临时 payload 的保留 SHALL 遵守既有数据恢复和撤销语义

#### Scenario: Close a tab with no recovery need

- **WHEN** 用户关闭一个已保存且不再需要恢复的 tab
- **THEN** 与该 tab 关联的可丢弃文档副本、临时历史快照和渲染缓存 SHALL 可被回收
- **AND** 关闭操作不得留下无法通过应用生命周期解释的强引用

### Requirement: Isolate memory between windows

系统 SHALL 将窗口专属的编辑器状态、UI 状态和临时缓存与其他窗口隔离；关闭一个窗口后，其他窗口不得因为共享引用而继续保留该窗口的完整文档或 Renderer-only 对象，除非这些对象明确属于应用级恢复功能。

#### Scenario: Close one of multiple editor windows

- **WHEN** 应用同时存在多个编辑器窗口且用户关闭其中一个
- **THEN** 被关闭窗口的专属状态 SHALL 从窗口级集合、事件总线和缓存中移除
- **AND** 其他窗口的活动 tab、菜单和文档内容 SHALL 不被错误清理或替换

#### Scenario: Reopen a closed document

- **WHEN** 用户关闭文档后再次打开同一文件
- **THEN** 系统 SHALL 创建或恢复一个新的有效运行时实例
- **AND** 不得依赖已经销毁的窗口或编辑器对象

### Requirement: Verify memory regression scenarios

系统 SHALL 提供可重复的内存测量场景，至少覆盖空白启动、多 tab、大文档、窗口关闭和应用恢复；结果 SHALL 能区分 Main、Preload 和 Renderer 的内存变化。

#### Scenario: Measure memory after closing tabs and windows

- **WHEN** 测量场景打开多个 tab 或窗口、关闭其中一部分并等待稳定期
- **THEN** 工具 SHALL 记录操作前后进程内存、JavaScript heap 和活动窗口/tab 数量
- **AND** 结果 SHALL 能用于判断关闭操作是否释放了预期的窗口级资源

#### Scenario: Repeat a memory scenario

- **WHEN** 使用相同构建和相同文档集重复执行内存测量
- **THEN** 测量结果 SHALL 输出原始样本和汇总统计
- **AND** 测量工具 SHALL 不把用户文档正文或敏感路径写入报告
