## Why

打开文件较多或目录层级较深的大型项目时，侧边栏当前会在初始扫描阶段读取所有 Markdown 文件内容，并逐条触发 IPC 与深层响应式更新；文件树展开后还会同时创建大量组件、DOM、全局事件监听和 Pinia 订阅。结果是首次打开项目耗时、主进程 I/O 与 IPC 负载、渲染进程响应时间和内存占用都会随项目规模线性增长，因此需要把这一类规模相关的性能问题作为一个完整的优化 change 处理。

## What Changes

- 将初始目录扫描改为只采集树和文件元数据，不在用户打开文件前读取 Markdown 内容；新建文件等确实需要内容的路径保留按需加载。
- 在 watcher 完成初始扫描后一次性或分批构建项目快照，使用普通对象建树后提交到 store，避免每个文件/目录各触发一次深层响应式更新和排序。
- 将侧边栏可见文件树改为基于扁平化行数据的虚拟列表，只挂载视口附近节点，避免展开大目录时组件和 DOM 数量随全部可见节点增长。
- 将创建/重命名通知和上下文菜单处理从每个树节点上移或集中路由，减少每个节点的全局 bus 监听、Pinia 订阅和 DOM 事件监听。
- 对侧边栏拖拽调整宽度使用动画帧合并更新，避免高频布局写入放大大文件树的渲染压力。
- 增加大型项目场景下的单元、集成和性能回归验证，覆盖初始加载、展开、折叠、创建、重命名、拖拽和窗口切换，同时保持文件操作、排序、选中、刷新和 Electron 安全边界语义不变。

## Capabilities

### New Capabilities

- `sidebar-performance`: 定义大型项目在初始扫描、项目树构建、可见文件树渲染、节点事件处理和侧边栏拖拽交互中的规模性能要求与验证边界。

### Modified Capabilities

无。当前仓库没有已注册的侧边栏性能 capability；本 change 先建立该能力规范，后续如发现已有行为规范再通过 delta spec 修改。

## Impact

- 主要影响 `packages/desktop/src/main/filesystem/watcher.ts`、`packages/desktop/src/renderer/src/store/project.ts`、`packages/desktop/src/renderer/src/components/sideBar/` 及相关 unit/integration/e2e 测试。
- 可能调整项目树 IPC 数据结构、初始扫描事件合并策略、文件元数据与文件内容加载边界，以及文件树组件的数据组织；必须保持现有文件操作、排序、选中、刷新、外部变更监听和保存语义。
- 不包含已经完成的菜单栏拉平、侧边栏滚动修复或其它无关 UI 改动，也不改变 Electron sandbox、contextIsolation、preload/contextBridge IPC 契约。
- 需要补充大型项目夹具或可重复的规模测试，记录首次可用时间、初始化事件数量、主进程读取次数、渲染节点数量、交互延迟和内存样本，以便按切片验证收益和回滚范围。
