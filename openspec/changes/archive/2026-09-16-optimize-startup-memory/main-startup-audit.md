# Main 启动关键路径审计清单（任务 2.1）

> 审计日期：2026-09-09
> 审计对象：当前工作区 `packages/desktop` Main/preload 启动代码，以及本地未提交重构快照。
> 范围：只记录任务 2.1 的启动安全边界和变更隔离结论；不在本任务中修改 Main 实现。

## 1. 审计基线与变更隔离

本清单以以下现有代码、测试和文档为依据：

- `packages/desktop/src/main/index.ts`：Electron Main composition root。
- `packages/desktop/src/main/app/index.ts`：`App.init()`、启动状态、早期文件事件和窗口创建编排。
- `packages/desktop/src/main/app/applicationStartup.ts`：显式的 8 阶段启动顺序。
- `packages/desktop/src/main/app/webSecurity.ts`、`localProtocol.ts`：安全策略和受控协议。
- `packages/desktop/src/main/app/env.ts`、`cli/index.ts`：CLI/environment 解析和用户目录初始化。
- `packages/desktop/src/main/ipc/index.ts`、`bootInfo.ts`、`rendererSender.ts`：首屏 IPC 和 sender 安全边界。
- `packages/desktop/src/main/config.ts`、`windows/editor.ts`：BrowserWindow 安全配置和首窗口入口。
- `packages/desktop/src/preload/index.ts`：`mt::boot-info` 同步握手和 contextBridge。
- 现有测试：`application-startup.spec.ts`、`app-startup-integration.spec.ts`、`app-startup-idempotence.spec.ts`、`startup-ipc-registration.spec.ts`。
- 既有说明：`docs/ARCHITECTURE_REVIEW.md`、`packages/website/content/docs/dev/ARCHITECTURE.md`、`packages/website/content/docs/dev/IPC.md`。

当前工作区存在其他 agent 的未提交修改，涉及 renderer 懒加载、窗口/存储生命周期、watcher、图片缓存、Muya 样式、性能采样等文件。本任务允许新增/修改的文件仅为：

1. 本审计文档；
2. `packages/desktop/test/unit/specs/main-startup-audit.spec.ts`；
3. `openspec/changes/optimize-startup-memory/tasks.md` 的 2.1 复选框。

除上述范围外，本轮不回退、不重排、不覆盖任何已有未提交修改；尤其不执行 `git reset`、`git checkout --`、`git clean` 或 native rebuild。

## 2. 首窗口前的强制保留项

下表中的“证据”是当前实现位置；“审查结论”是后续延迟初始化或重构不得破坏的约束。

| 类别            | 当前证据                                                         | 首窗口前必须保留的约束                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI/environment | `main/index.ts:19-30`；`cli/index.ts`；`app/env.ts`              | 版本环境变量、CLI 参数解析、`--user-data-dir`/portable mode、safe/debug/verbose/spellcheck 语义必须先于 `Accessor` 和首窗口；不得把用户目录或命令行路径交给 renderer 自行解释。                                                             |
| 异常处理        | `main/index.ts:27-30,47-70,101-120`                              | uncaught exception/unhandled rejection、electron-log 和 `Accessor` 构造失败边界必须在首窗口前有效；失败必须可记录、可按环境显示错误并以非成功码退出，不能让首屏加载掩盖初始化异常。                                                         |
| 单实例          | `main/index.ts:78-85`                                            | 非 MAS、非 development 版本必须先取得 single-instance lock；失败实例立即退出；第二实例 argv/working directory 必须通过缓存/共享窗口入口转交，不得绕过路径过滤。                                                                             |
| 受控协议        | `main/index.ts:23-24`、`app/index.ts:210-213`                    | `marktext` privileged scheme 必须在 Electron `ready` 前声明；生产 renderer 只能经受控 `marktext://` 协议加载，开发环境才使用 Vite URL。                                                                                                     |
| 安全策略        | `app/index.ts:166`、`app/webSecurity.ts:10-21`、`config.ts:8-44` | `web-contents-created` 必须在首窗口创建前注册；禁止 webview attach、导航和 `window.open`；窗口保持 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，生产环境保持 web security。                                         |
| 早期文件事件    | `app/index.ts:96-164,472-505`                                    | `second-instance`、macOS `open-file`、`ready`、`activate` listener 必须只注册一次并在首窗口前接收；请求必须过滤未知 flag、规范化路径、缓存到 `_openFilesCache`/`_pendingOpenRequests`，窗口可用后再串行 flush，不得丢失或重复消费。         |
| `mt::boot-info` | `main/ipc/bootInfo.ts:1-65`、`preload/index.ts:40-50`            | 同步 `ipcRenderer.sendSync('mt::boot-info')` 必须在 preload bridge 构造/暴露前可用；返回值只能是 allowlist 环境、运行时版本和受控路径/扩展名，不得泄露 Markdown 正文、完整环境变量或未验证对象。异步 `mt::boot-info-async` 也必须保持可用。 |
| 最小 IPC        | `main/index.ts:87-90`、`main/ipc/index.ts:13-25`                 | 所有首屏会调用的 handler 必须在 renderer 加载前注册；至少包含 boot-info sync/async、必要的窗口/文件/偏好启动握手和性能测试早期 mark。延迟服务只能延迟实现加载，不能延迟 channel 注册或 sender 校验。                                        |
| trusted sender  | `main/ipc/rendererSender.ts:23-83`、`app/index.ts:875-976`       | renderer→main handler 必须通过 `BrowserWindow.fromWebContents` 和主 frame/trusted frame 策略确认 sender；不得信任 renderer 提供的 windowId 来选择其他窗口。                                                                                 |
| 窗口创建入口    | `app/index.ts:320-463,496-559`、`windows/editor.ts:79-132`       | 首窗口统一经过 `_createFirstWindow()`，实际 editor BrowserWindow 统一经过 `_createEditorWindow()`；必须复用 `_windowCreationPromise`，恢复、CLI 文件、第二实例和 `activate` 不得各自 new 窗口或绕过 `WindowManager`。                       |

## 3. 当前实际启动顺序

在 `main/index.ts` 中，首窗口相关的不可交换顺序为：

```text
版本环境变量
  -> privileged marktext scheme
  -> 异常处理与日志
  -> CLI/environment
  -> crash reporter / process error observers
  -> --disable-gpu
  -> single-instance lock
  -> sandbox-safe IPC（含 mt::boot-info）
  -> AppUserModelId / browser-window-created hook
  -> Accessor 构造及失败边界
  -> App 构造（App/WindowManager/Menu IPC 已注册）
  -> App.init（早期 app events + web-contents security policy）
  -> Electron ready
  -> runApplicationStartup：protocol -> IPC placeholder -> security placeholder
     -> preferences -> menus -> restore -> createFirstWindow -> lifecycle placeholder
```

`applicationStartup.ts` 的 8 阶段是可测试的编排描述；其中 IPC 和安全策略在当前 composition root 中已有更早注册，因此 `_registerIpc`、`_applySecurityPolicy` 是保持显式顺序的 no-op 占位，不能据此删除 `main/index.ts` 的早期注册或 `App.init()` 的 security listener。

## 4. 审查清单（合并前逐项确认）

- [ ] CLI 参数、environment 和 portable/user-data 路径仍先于 `Accessor`。
- [ ] 异常 logger、crash reporter、uncaught/unhandled 观察器仍先于首窗口。
- [ ] 单实例锁没有被延迟到 `ready` 或 renderer；第二实例请求仍走统一缓存路径。
- [ ] privileged scheme 在 `ready` 前声明，生产 renderer 没有退回任意 file/http 加载。
- [ ] webview、导航、`window.open` 拦截 listener 在任何 BrowserWindow 创建前注册。
- [ ] editor/preferences BrowserWindow 的 sandbox、context isolation、nodeIntegration 和 webSecurity 未被放宽。
- [ ] `open-file`、`second-instance`、`activate` 重复触发时不会漏请求、重复建窗或在退出后继续执行。
- [ ] `mt::boot-info` sync/async 和首屏需要的最小 IPC 在 preload 执行前已注册。
- [ ] 所有 renderer IPC 仍执行 trusted sender/main-frame 校验，且不信任 renderer windowId。
- [ ] 首窗口只从 `_createFirstWindow()` 到 `_createEditorWindow()` 创建，并由 `WindowManager` 接管。
- [ ] 本次性能切片只改审计文档、审计测试和 2.1 tasks 行；其他 agent 的未提交文件保持原样。

## 5. 已识别但不在 2.1 实施的风险

1. `registerSandboxIpcHandlers()` 当前是首屏 IPC 的完整注册超集；若未来继续拆分，必须先用真实首屏调用图证明某 channel 可延迟，再移动其实现。
2. `Accessor` 和 `App` 仍由 main composition root 顺序构造；不能仅凭性能目标把它们改成后台初始化，否则可能造成 `boot-info`、早期文件事件或窗口菜单竞态。
3. 真实 Electron 第二实例、macOS `open-file` 和安全策略集成测试尚未在本机完整运行；本任务补充的是静态代码审查测试，不能替代跨平台 E2E。
4. 本机缺少 Visual Studio C++ 构建工具，因此未执行、也不应执行 `electron-rebuild` 或 `pnpm rebuild-native`。

## 6. 验证记录

- 现有启动/IPC 定向测试已作为前置参考：`app-startup-idempotence.spec.ts`、`startup-ipc-registration.spec.ts` 等。
- 本任务新增 `main-startup-audit.spec.ts`，自动检查上述关键顺序、关键安全配置、IPC 范围和窗口创建入口。
- 代码修改后运行 `graphify update .`，并执行 OpenSpec validate、定向 unit test、`git diff --check`。
