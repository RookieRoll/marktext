# Desktop IPC Legacy Inventory

本文记录 `packages/desktop/src/shared/types/ipc.ts` 中仍然保留开放字段的 IPC 契约。它不是新的 IPC 注册表；新增 channel 仍必须先更新 shared contract、preload bridge、main handler、renderer consumer 和 contract test。

## 当前结论（2026-09-07）

本轮已将高风险边界收紧为具体结构并接入 runtime validator。当前没有待迁移的“裸 `unknown` channel payload”；剩余开放字段均属于兼容性数据、用户配置扩展或由下游模块定义的结构，不能在不同时迁移生产者和消费者的情况下强行收窄。

| Channel/字段 | 当前类型 | 生产者/消费者 | 保留开放的原因 | 下一步门槛 |
| --- | --- | --- | --- | --- |
| `mt::i18n::load.ret` | `Record<string, unknown>` | main i18n loader → renderer i18n store | locale JSON 的键和值由语言包决定，当前没有稳定 schema | 生成 locale schema 后增加 key-level contract test |
| `broadcast-user-data-changed` / `mt::set-user-data` | `Record<string, unknown>` | `DataCenter`, `WindowManager`, preferences store | 用户数据是可扩展键值存储，历史插件/配置可能增加字段 | 先盘点 schema 和外部消费者，再拆成稳定字段与 extension map |
| `mt::rename.currentFile` | `Record<string, unknown>` | editor store → file action handler | main 当前只需要 `id/pathname/newPathname`，完整 tab 快照仅为历史兼容上下文 | 删除无消费者字段后移除 `currentFile`，并补充旧 renderer 兼容测试 |
| `mt::view-layout-changed.layout` | `Record<string, unknown>` | layout/preferences stores → menu | layout entry 会随 UI 功能扩展，main 只读取部分字段 | 固定 layout entry union 后增加 unknown-entry 兼容策略 |
| `FormatLinkData` / `SpellingReplacementPayload` | 具体 envelope，部分字段可空/开放 | Muya/editor/context menu → main/renderer | Muya link metadata 可能带额外字段；当前主进程只消费 href/text/dirname | Muya link metadata 稳定后移除额外字段或建立版本化 payload |

## 已完成的收紧

- 保存、保存并关闭：`UnsavedFile[]` + runtime validator。
- 图片自动路径：`ImageAutoPathRequest` + runtime validator。
- renderer error、selection、notification、window status、object tree、drop、keybindings：具体 payload + validator。
- `app-open-*` options：`TabOptions`。
- preference broadcasts：`Partial<IUserPreferences>`。
- format-link、rename、view-layout、Pandoc notification、spelling replacement：具体 envelope。
- `screen-capture`：无 payload，避免把内部 event 当作 renderer 数据通道。

## 迁移规则

1. 不以删除 `unknown` 字样作为完成标准；必须先证明 producer、consumer 和 runtime shape。
2. 迁移开放字段时，先增加 validator 和 contract test，再收窄 shared type。
3. 若字段只用于向后兼容，保留 `Record<string, unknown>`，并在本表写明删除条件。
4. 任何未列入本表的新开放字段都视为契约漂移，应在同一提交中补充 inventory。