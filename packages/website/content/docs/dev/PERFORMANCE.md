# Performance Testing

MarkText performance measurements use the same production-like entry as the existing `PERF_TESTING` and `perf:inspect` flows. The measurement tools are intentionally independent of the Main/Renderer implementation: they only read JSON reports and build output.

## Reproducible measurement flow

1. 在仓库根目录安装依赖，并确认 Node.js `>=20.19.0`、pnpm `>=10`。Windows 测量必须使用 PowerShell 7；为避免机器上没有独立 `pnpm` 命令，以下命令统一通过 Corepack 调用：

```powershell
corepack pnpm install
node --version
corepack pnpm --version
```

2. 生成解包的生产等价构建。该命令只执行 locale 准备和 `electron-vite build`，不需要也不允许执行 `electron-rebuild` 或 `pnpm rebuild-native`：

```powershell
corepack corepack pnpm --filter marktext build:unpack
```

3. 将原始报告写到仓库之外的临时目录。不要使用 `$pwd\.perf-reports` 作为原始目录，因为在仓库根目录执行时它仍位于源代码树内；也不要把汇总或基线 JSON 写回原始报告目录：

```powershell
$reportRoot = Join-Path $env:TEMP 'marktext-perf'
$scenario = 'cold-editor'
$reportDir = Join-Path $reportRoot $scenario
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null
$env:PERF_TESTING = 'true'
$env:MARKTEXT_PERF_REPORT_DIR = $reportDir
$env:MARKTEXT_PERF_SCENARIO = $scenario
corepack corepack pnpm --filter marktext perf:inspect
```

`perf:inspect` 会对最新的生产构建启动 `electron-vite preview`，不会重新构建。测量完成后正常退出应用；Main 的 `before-quit` 处理会写入一个 `marktext-<scenario>-<runId>.json` 原始报告。需要在 Main 启动早期设置断点时使用 `corepack corepack pnpm --filter marktext perf:inspect-brk`。每个场景至少运行 3 次；cold 场景每次都退出并重新启动应用，warm 场景只在同一构建和会话中预热后重复测量。可用场景为 `blank-editor`、`cold-editor`、`warm-editor`、`settings-window`、`restore-tabs`、`multi-window`、`large-document`、`multi-tab`、`close-tab`、`close-window` 和 `app-recovery`。

## Report aggregation

The root command delegates to the desktop package:

```powershell
corepack pnpm --filter marktext perf:report -- summarize "$env:MARKTEXT_PERF_REPORT_DIR" --output .perf-reports/summary.json
corepack pnpm --filter marktext perf:report -- validate "$env:MARKTEXT_PERF_REPORT_DIR"
```

If the directory argument is omitted, `MARKTEXT_PERF_REPORT_DIR` is used. The summarizer reads only top-level `.json` files, validates the version-1 report shape and privacy constraints, then groups by `scenario/build.id`. Each group contains the ordered raw `runs` (including `runId` and `startedAt`) and metric summaries with `samples`, `p50`, and `p95` for milestones, resources, Main/Renderer/Preload memory metrics, and counters. Missing metrics remain absent; empty statistics use `p50: null`, `p95: null`, never zero.

Percentiles use deterministic linear interpolation over the sorted sample values: `index = (n - 1) * p`, with p50 = `p=0.5` and p95 = `p=0.95`. Keep the same build and scenario fixed when comparing slices. Treat a single run as exploratory only; use repeated runs for decisions.

## Privacy and baseline policy

Reports must contain telemetry only. The tool rejects unknown report fields and sensitive fields such as `path`, `documentPath`, `filename`, `markdown`, `body`, `content`, or `text`. It also rejects absolute paths and common user/document paths. Error messages expose only the report file basename and field location, not the full input path or document content.

### Baseline strategy

Create a baseline from the same report directory used for the repeated run set:

```powershell
corepack pnpm --filter marktext perf:report -- baseline "$env:MARKTEXT_PERF_REPORT_DIR" --environment developer --machine-class windows-dev --output .perf-reports/baseline-developer.json
corepack pnpm --filter marktext perf:report -- baseline-validate .perf-reports/baseline-developer.json
```

Use these two baseline modes:

| Environment | Required setup                                                             | Minimum runs | Use                                                           |
| ----------- | -------------------------------------------------------------------------- | -----------: | ------------------------------------------------------------- |
| `developer` | One fixed machine class, fixed power/display state, no debugger            |            3 | Local trend and before/after comparison; never a merge gate   |
| `ci`        | Dedicated, stable runner class with the same OS/architecture/tool versions |            5 | Regression gate candidate for pull requests or release builds |
| `unknown`   | Any other machine or mixed collection                                      |            3 | Exploratory only; do not use as a gate                        |

Restart between cold runs, use exactly one warmup run only for `warm-editor`, and keep the scenario's window/tab/document-size inputs unchanged. A baseline is a `candidate` only when its required milestones are present and the environment minimum is met; incomplete groups remain `exploratory`.

### Provenance and anonymous traceability

Every baseline contains a redacted `provenance` object with the report count, sorted `buildIds`, sorted scenario names, and run IDs. Each group repeats the scenario, the complete build identity (`id`, app version, platform, architecture, Electron, Chrome, and Node versions), ordered run IDs, and timestamps. The group key is `<scenario>/<build.id>`. This makes a baseline reproducible and auditable without storing a user path, document name, Markdown body, or preference value. A reviewer should reject a comparison when the candidate and baseline do not have the same group key, build/runtime identity, machine class, and fixed scenario inputs.

For example, a valid baseline can be traced from `provenance.buildIds` and `provenance.scenarios` to one group such as `cold-editor/build-2026-09-09`; the group's `runIds` identify the raw JSON samples without exposing their filesystem location.

### Outliers and regression thresholds

The tool uses Tukey's 1.5×IQR rule to flag outlier candidate indexes per metric. **Flagging does not delete or silently down-weight a sample**: all raw samples remain in the baseline and p50/p95, because a slow run may be a real regression. A run may be excluded only when an operator records one of the allowed interruption reasons (background update, debugger pause, or system load) outside the report data; otherwise rerun the scenario and retain the sample. An outlier index is relative to that metric's `samples` array, not to the report directory or a user file.

The initial relative-threshold candidates are:

- **Startup milestones:** fail review when candidate p95 > baseline p95 × `1.10`.
- **Memory and asset size:** fail review when candidate p95 > baseline p95 × `1.15`.

These are review thresholds, not claims of statistical significance. Apply them only to matching scenario/build/runtime groups, require the baseline to be a `candidate`, and inspect raw samples plus flagged indexes before accepting a regression. Keep the thresholds in the generated baseline's `policy` object so a future history-based calibration can change them without making old baselines ambiguous.

## Production entry and chunk-size report

The current production measurement entry is `packages/desktop/out/renderer/index.html`, produced by `corepack pnpm --filter marktext build:unpack`. Its initial assets are the JS/CSS files referenced by the HTML entry; other `.js`/`.css` files below `packages/desktop/out/renderer` are reported as dynamic chunks.

Generate an anonymous, reproducible size report with:

```powershell
corepack pnpm --filter marktext perf:report -- chunks packages/desktop/out/renderer --output .perf-reports/chunks.json
```

The report includes relative asset paths only, `entryFiles`, `dynamicChunks`, per-file byte counts, largest chunks, and totals for `initialJsBytes`, `initialCssBytes`, `dynamicJsBytes`, and `dynamicCssBytes`. The output never includes the absolute renderer or report directory.

## Manual DevTools inspection

### Main process

```powershell
corepack pnpm --filter marktext perf:inspect-brk
```

This launches the production build with a breakpoint before the first line of JavaScript and exposes the debugger on port `5858`. Open `chrome://inspect`, configure `localhost:5858`, inspect the process, record in the `Performance` panel, and stop after startup completes.

For a non-breaking-point run:

```powershell
corepack pnpm --filter marktext perf:inspect
```

### Renderer process

```powershell
corepack pnpm --filter marktext start
```

Press `F12`, then use `Reload and Record`. Renderer code must access Node capabilities only through the existing typed preload/contextBridge IPC boundary.

## 统一测量契约（任务 1.1）

所有性能报告使用 version `1`，并且只包含匿名场景、时间/计数指标和构建标识。milestone 使用固定的相对毫秒名：

`main-process-start` → `main-init` → `app-ready` → `first-window-created` → `first-document-requested` → `preload-ready` → `renderer-start` → `dom-ready` → `first-paint` → `editor-interactive` → `first-document-loaded`。

报告的固定顶层字段为 `version`、`runId`、`scenario`、`startedAt`、`build`、`milestones`、`resources`、`memory` 和 `counters`。`build` 包含 `id`、应用版本、平台、架构以及 Electron/Chrome/Node 版本；`memory` 只记录 `main`、`renderer` 或 `preload` 的匿名数值样本；`counters` 只记录窗口数和 tab 数。报告校验会拒绝未知字段、绝对路径、用户/文档路径以及 `path`、`filename`、`markdown`、`body`、`content`、`text` 等字段。

先生成场景配置并用空白编辑器做 schema smoke 验证：

```powershell
corepack pnpm --filter marktext perf:report -- scenarios --output .perf-reports/scenarios.json
corepack pnpm --filter marktext perf:report -- smoke --output .perf-reports/blank-editor-smoke.json
corepack pnpm --filter marktext perf:report -- scenario-validate .perf-reports/blank-editor-smoke.json
```

`smoke` 只生成匿名的空白编辑器样本，不代表真实 Electron 启动时间；真实数据仍须由 `PERF_TESTING=true` 的应用运行产生。`scenario-validate` 除报告结构和隐私外，还检查场景必需 milestone、固定窗口/tab 数和 milestone 单调顺序。

## 可重复场景（任务 1.5）

场景配置由 `scenarios` 命令输出，避免依赖操作者记忆。每个场景至少重复 3 次；冷启动场景每次退出并重新启动，暖启动场景保留同一构建并先做 1 次不计入样本的预热。除明确的暖启动外，不要混用缓存状态。

| 场景              | 固定前置条件                                                   | 必需观察点                                  |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------- |
| `blank-editor`    | 1 个窗口、1 个 tab、空白编辑器                                 | Main 启动、应用 ready、首窗口、编辑器可交互 |
| `cold-editor`     | 每次退出应用并清理本次测量缓存；1 个窗口、1 个 tab             | Main 启动、应用 ready、首窗口、编辑器可交互 |
| `warm-editor`     | 同一构建和应用会话；1 次预热后重载/重复进入编辑器              | Renderer 开始、DOM 可用、首屏、编辑器可交互 |
| `settings-window` | 编辑器启动后只打开 1 个设置窗口；固定缩放和布局                | 首窗口、DOM 可用、首屏                      |
| `restore-tabs`    | 固定恢复 3 个匿名测试 tab；只记录 `tabs` 计数                  | 应用 ready、首窗口、文档加载、编辑器可交互  |
| `multi-window`    | 固定创建 2 个编辑器窗口，每个窗口固定 2 个 tab                 | 应用 ready、首窗口、编辑器可交互            |
| `large-document`  | 使用固定 1024 KiB 的合成 Markdown fixture；不采集 fixture 内容 | 首个文档请求、文档加载、编辑器可交互        |

每次运行只设置一个场景名；报告目录中只放原始报告，不要把 `summary.json` 或 `baseline.json` 放回同一目录：

```powershell
$env:PERF_TESTING = "true"
$env:MARKTEXT_PERF_REPORT_DIR = "$pwd\.perf-reports\cold-editor"
$env:MARKTEXT_PERF_SCENARIO = "cold-editor"
corepack pnpm --filter marktext perf:inspect
# 完成一次测量并退出应用；重复上面的启动流程至少三次
corepack pnpm --filter marktext perf:report -- validate "$env:MARKTEXT_PERF_REPORT_DIR"
corepack pnpm --filter marktext perf:report -- summarize "$env:MARKTEXT_PERF_REPORT_DIR" --output .perf-reports/cold-editor-summary.json
```

对 `warm-editor`，先运行一次预热，再在相同构建和会话中重复记录；对 `settings-window`、`restore-tabs`、`multi-window` 和 `large-document`，每次都保持表格中的窗口/tab/fixture 约束。该命令集不需要也不会把用户正文、文件名或路径传给性能工具。

## 完整测量操作手册（任务 5.6）

本节是新成员执行一次完整性能测量的最短路径。性能工具只记录匿名 telemetry；场景中的文档、路径、tab 名称和设置值必须由操作者在本地准备，但不得写入报告。

### 测量前置条件

- 在仓库根目录执行命令，使用 Windows PowerShell 7、同一 Node.js/pnpm 版本和同一 `corepack corepack pnpm --filter marktext build:unpack` 产物。
- 关闭其他 MarkText 实例、开发服务器、调试器、录屏工具和会改变磁盘/CPU 负载的后台任务。固定显示缩放、电源模式、窗口大小和应用语言/主题；冷启动前退出应用，warm 场景不要清理缓存。
- `large-document` 使用固定 **1024 KiB** 合成 Markdown fixture；`restore-tabs`、`multi-tab`、`close-tab`、`close-window` 和 `app-recovery` 只使用匿名测试 tab。报告只能保留窗口数、tab 数、fixture 大小等固定输入的对应计数，不得保存正文或路径。
- 一个原始报告目录只放同一场景、同一构建的一组原始 `*.json`。`summary.json`、`baseline.json` 和 `chunks.json` 必须写到另一个目录；报告读取器会把原始目录顶层的每个 JSON 都当作报告验证。
- 不要将 `perf:inspect-brk` 的断点运行混入正常基线；调试器暂停属于已知中断原因，只能单独保存并人工标记。

### 一次完整 cold-editor 测量

下面的示例会创建仓库之外的目录、构建产物、执行 3 次冷启动，并依次验证每个原始报告、汇总报告、基线和基线校验。每次启动 `perf:inspect` 后，在应用中保持一个编辑器窗口和一个 tab，等待编辑器可交互，然后退出应用，再启动下一次：

```powershell
$reportRoot = Join-Path $env:TEMP 'marktext-perf'
$scenario = 'cold-editor'
$reportDir = Join-Path $reportRoot $scenario
$outputDir = Join-Path $reportRoot 'derived'
New-Item -ItemType Directory -Force -Path $reportDir, $outputDir | Out-Null

corepack corepack pnpm --filter marktext build:unpack

$env:PERF_TESTING = 'true'
$env:MARKTEXT_PERF_REPORT_DIR = $reportDir
$env:MARKTEXT_PERF_SCENARIO = $scenario

# 在单独的 PowerShell 7 窗口中重复 3 次：启动、等待 editor-interactive、退出应用。
corepack corepack pnpm --filter marktext perf:inspect
corepack corepack pnpm --filter marktext perf:inspect
corepack corepack pnpm --filter marktext perf:inspect

Get-ChildItem -LiteralPath $reportDir -Filter '*.json' -File | ForEach-Object {
  corepack corepack pnpm --filter marktext perf:report -- scenario-validate $_.FullName
}
corepack corepack pnpm --filter marktext perf:report -- validate $reportDir
corepack corepack pnpm --filter marktext perf:report -- summarize $reportDir --output (Join-Path $outputDir "$scenario-summary.json")
corepack corepack pnpm --filter marktext perf:report -- baseline $reportDir --environment developer --machine-class 'windows-fixed-dev' --output (Join-Path $outputDir "$scenario-baseline.json")
corepack corepack pnpm --filter marktext perf:report -- baseline-validate (Join-Path $outputDir "$scenario-baseline.json")
corepack corepack pnpm --filter marktext perf:report -- chunks packages/desktop/out/renderer --output (Join-Path $outputDir 'chunks.json')
```

实际操作时，三个 `perf:inspect` 命令必须分别等待前一个应用退出后再执行；如果希望每次手动确认，可以只执行一次命令，关闭应用后再执行下一次。`warm-editor` 需要先执行 1 次不计入样本的预热，随后在同一应用会话/构建中记录至少 3 次；其他场景按 `可重复场景` 表格中的固定输入执行。

### 场景前置条件和稳定采样点

性能报告脚本中的 `scenarios` 命令是场景契约的来源：

```powershell
corepack corepack pnpm --filter marktext perf:report -- scenarios --output (Join-Path $outputDir 'scenarios.json')
```

| 场景              | 运行前固定条件                                 | 完成动作后再采样                     | 固定计数 / 内存要求                                                     |
| ----------------- | ---------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `blank-editor`    | 空白编辑器，1 个窗口、1 个 tab                 | 等到编辑器可交互                     | Main/Preload/Renderer 各至少 1 个 RSS、JS heap 样本                     |
| `cold-editor`     | 退出应用并清理本次测量缓存，1 个窗口、1 个 tab | 首次编辑器可交互后退出               | 启动 milestone；通常用于冷启动时间                                      |
| `warm-editor`     | 同一构建/会话先预热 1 次，1 个窗口、1 个 tab   | 重载或再次进入编辑器后记录           | 不重启、不清缓存；比较 Renderer/DOM/首屏 milestone                      |
| `settings-window` | 编辑器启动后只打开 1 个设置窗口，固定布局/缩放 | 设置窗口首屏完成                     | 2 个窗口、1 个 tab；不得记录设置正文或偏好值                            |
| `restore-tabs`    | 准备固定 3 个匿名恢复 tab                      | 重启并等 3 个 tab 恢复、编辑器可交互 | 1 个窗口、3 个 tab                                                      |
| `multi-window`    | 同一构建创建 2 个编辑器窗口，每个固定 2 个 tab | 两个窗口均稳定后采样                 | 2 个窗口、2 个 tab                                                      |
| `large-document`  | 固定 1024 KiB 合成 Markdown fixture            | 文档加载且编辑器可交互后采样         | 1 个窗口、1 个 tab；Main/Preload/Renderer 各至少 1 个 RSS、JS heap 样本 |
| `multi-tab`       | 1 个窗口打开固定 4 个匿名 tab                  | 所有 tab 稳定后采样                  | 1 个窗口、4 个 tab；各进程至少 1 个 RSS、JS heap 样本                   |
| `close-tab`       | 先打开 3 个匿名 tab，关闭 1 个                 | 等待一个采样周期后记录剩余状态       | 1 个窗口、2 个 tab；各进程至少 2 个不同时间戳样本                       |
| `close-window`    | 先创建 2 个编辑器窗口，关闭 1 个               | 等待一个采样周期后记录剩余状态       | 1 个窗口、2 个 tab；各进程至少 2 个不同时间戳样本                       |
| `app-recovery`    | 准备固定 3 个匿名恢复 tab                      | 重启并等待恢复完成、编辑器可交互     | 1 个窗口、3 个 tab；各进程至少 1 个 RSS、JS heap 样本                   |

`scenario-validate` 会检查所需 milestone、固定窗口/tab 数、milestone 顺序和内存样本完整性；`validate` 只验证目录内报告的 JSON 结构和隐私约束。两者都要运行，不能用 `smoke` 结果替代真实 Electron 运行。

### 报告字段和解释

version-1 原始报告的固定顶层字段如下：

| 字段         | 含义                             | 解释规则                                                                                                                       |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `version`    | 报告契约版本                     | 当前必须为 `1`；不兼容版本不能混合汇总                                                                                         |
| `runId`      | 单次运行匿名 ID                  | 用于从 baseline 的 `provenance.runIds` 追溯原始样本                                                                            |
| `scenario`   | 场景名                           | 必须与 `MARKTEXT_PERF_SCENARIO` 和场景契约一致                                                                                 |
| `startedAt`  | 运行开始时间                     | 仅用于排序/追溯，不直接作为性能指标                                                                                            |
| `build`      | 构建身份                         | 包含 `id`、应用版本、platform、arch、Electron、Chrome、Node 版本；比较时必须一致                                               |
| `milestones` | Main/preload/renderer 启动时间点 | 数值是相对本次运行起点的毫秒数，使用固定 milestone 名并检查单调顺序                                                            |
| `resources`  | 首屏资源指标                     | `initialJsBytes`、`initialCssBytes`、`dynamicChunkBytes`、`dynamicChunkLoadMs`，缺失项不填零                                   |
| `memory`     | 进程内存样本数组                 | 每项含 `atMs`、`process`（`main`/`preload`/`renderer`）及可用的 `rssBytes`、`heapUsedBytes`、`heapTotalBytes`、`externalBytes` |
| `counters`   | 状态计数                         | 只允许匿名的 `windows`、`tabs` 数值                                                                                            |

汇总报告按 `scenario/build.id` 分组；每组保留 `sampleCount`、原始 `runs`、`milestones`、`resources`、`memory` 和 `counters`。每个指标含排序后的 `samples`、`p50` 和 `p95`：p50 表示典型运行，p95 表示较慢尾部，空统计为 `null`，不能解释为零。`close-tab`/`close-window` 的内存样本按时间戳检查前后差异，不要把不同进程的 RSS 直接相加后当作单一进程内存。

chunk 报告另有独立结构：`entryFiles` 是 HTML 首屏直接引用的 JS/CSS，`dynamicChunks` 是其余动态文件，`files`/`largestChunks` 给出相对文件名和字节数，`totals` 给出初始、动态及总 JS/CSS 字节数。它只用于构建切片比较，不等同于运行时内存。

### 结果判读、基线和已知波动

- `developer` 基线要求固定机器类别，至少 3 次；用于本机前后比较，不能作为 merge gate。`ci` 基线要求稳定专用 runner，至少 5 次；`unknown` 只用于探索。基线 `status` 只有在必需 milestone 完整且达到环境最小样本数时才是 `candidate`。
- 基线按 `scenario/build.id` 分组，并通过 `provenance.reportCount`、`buildIds`、`scenarios`、`runIds` 追溯；若构建、运行时、平台/架构、机器类别或固定输入不同，先重新采样，不要横向比较。
- 当前相对回归候选是：启动 milestone p95 超过基线 p95 的 `1.10`，内存和资源体积 p95 超过 `1.15`。这是人工审查阈值，不是统计显著性结论；必须同时查看原始样本和异常值索引。
- Tukey `1.5 × IQR` 只标记异常值候选，不会删除或自动降权。若运行受到 `background-update`、`debugger-pause` 或 `system-load` 中断，单独记录原因并重新采样；不能只因某次较慢就删除样本。
- 已知波动来源包括 Chromium/Node GC 和 JIT、Windows 工作集与分页、杀毒/索引/更新、CPU 频率和电源模式、磁盘缓存、首次字体/locale 缓存、窗口合成/GPU、显示缩放、后台 Electron 进程、调试器和开发工具。固定条件只能降低波动，不能把单次结果当作结论。

### 完整测量验收清单

新成员完成一次测量后，应能提供以下匿名证据：

1. `build:unpack` 成功，且记录构建时间/构建 `id`；
2. `scenarios.json`、每个原始报告的 `scenario-validate` 结果和目录级 `validate` 结果为 `valid: true`；
3. 汇总 JSON 的 `groups` 含预期 `scenario/build.id`、原始 `runs`、`sampleCount`、p50/p95；
4. baseline JSON 的 `environment`、`strategy`、`policy`、`provenance` 和 group `status` 可解释，`baseline-validate` 为 `valid: true`；
5. chunk JSON 的首屏/动态边界和 totals 可与对应构建关联；
6. 测量记录注明操作系统、架构、Node/pnpm、Electron/Chrome 版本、机器类别、场景固定输入、运行次数和已知中断原因，但不附带用户路径、文档正文、tab 名称或设置值。

出现验证失败时，先删除/隔离失败场景的临时报告目录并重新建立同一构建的干净目录；不要修改报告内容来“通过”校验。若 `scenario-validate` 失败，检查场景名、窗口/tab 计数、必需 milestone 和内存采样，再决定是否重新运行；若 `baseline` 为 `exploratory`，不要把它当作回归门槛。

## 基线、异常值与追溯（任务 1.6）

使用 `baseline` 从同一报告目录生成可追溯的首轮基线。输出按 `scenario/build.id` 分组，保留每次原始样本的 `runId` 和 `startedAt`，并保存完整构建标识、环境类型、机器类别、样本数量、p50/p95 和异常值候选索引：

```powershell
corepack pnpm --filter marktext perf:report -- baseline "$env:MARKTEXT_PERF_REPORT_DIR" `
  --environment developer `
  --machine-class "windows-fixed-dev" `
  --output .perf-reports/cold-editor-baseline.json
```

开发机基线用于同一台固定机器的前后比较；CI 基线必须绑定专用 runner 的机器类别和构建标识，不能把开发机和 CI 样本合并。至少 3 个相同构建、相同场景的有效样本才会标记为 `candidate`；样本不足或必需 milestone 缺失只标记为 `exploratory`，不会被误用为回归门槛。

异常值采用 Tukey `1.5 × IQR` 规则标记候选，但默认保留在原始样本和百分位计算中。只有能记录为 `background-update`、`debugger-pause` 或 `system-load` 的环境中断，才可在人工审查后将该次运行标记为无效；不能因为一次运行较慢就删除它。异常值索引对应排序前的 `samples` 顺序，便于从 baseline 的 `runIds` 追溯到具体原始报告。

在没有足够历史数据前，建议只把相对阈值作为候选：启动 milestone 的 p95 回归候选为 `+10%`，内存和资源体积的 p95 回归候选为 `+15%`。比较时必须固定 `scenario`、`build.id`、操作系统/架构、窗口/tab 数和大文档 fixture 大小；不同构建只用于前后对比，不得跨场景比较。单次运行仅用于探索，不能形成基线结论。

基线的追溯链为：

1. `packages/desktop/package.json` 中的 `perf:inspect` / `perf:inspect-brk` 启动生产等价预览并设置 `PERF_TESTING=true`。
2. Main/Renderer 采样器写出 version-1 原始 JSON；`build`、`scenario`、`runId` 和 `startedAt` 把样本关联到构建和场景，但不携带用户路径或文档正文。
3. `validate` 验证原始报告，`summarize` 输出保留原始 runs 的汇总，`baseline` 输出环境、策略、样本 ID、时间和指标统计。
4. 代码行为由 `performance.spec.ts`、`performance-report-tool.spec.ts` 和现有启动性能单测覆盖；若只运行 schema smoke，不得宣称已完成真实冷/暖启动测量。

### 优化前后切片比较与回滚（任务 5.5）

使用 `compare` 将一组 candidate 原始报告与已经通过 `baseline-validate` 的基线逐场景比较。比较允许 `build.id` 不同（因为这是优化前后两个构建），但要求场景、固定窗口/tab 数、平台/架构、Electron/Chrome/Node 运行时和机器类别一致；基线必须是 `candidate` 状态，candidate 至少满足该场景和环境的最小样本数。

```powershell
corepack pnpm --filter marktext perf:report -- compare .perf-reports/baseline.json `
  --candidate .perf-reports/cold-editor-candidate `
  --environment developer `
  --machine-class windows-dev `
  --output .perf-reports/cold-editor-comparison.json
```

比较输出对每个 `scenario/build.id` slice 保留 baseline/candidate 的 build identity 和 run ID，并报告：

- 首屏 `resources.initialJsBytes` / `initialCssBytes`；
- 必需启动 milestone 的 p95；
- candidate 与 baseline 都提供时的首次低频功能 `resources.dynamicChunkLoadMs`；
- `main`、`preload`、`renderer` 的 RSS、JS heap used 和 heap total p95；
- p95 变化比例、适用阈值和 `regressed` 标记。

启动 milestone 使用 `+10%` 候选阈值，内存/资源体积使用 `+15%` 候选阈值。缺少必需指标、运行时不匹配、窗口/tab 不匹配、样本不足或基线为 `exploratory` 时，比较结果为 `valid: false`；检测到回归时 CLI 以非零状态退出，不能把不完整结果当作通过。

每个优化 slice 的回滚边界由 `PERFORMANCE_SLICE_ROLLBACK_CONTRACTS` 固定：回滚只涉及优化源文件，`scripts/performance-report.ts`、性能采样/报告单测和对应行为测试必须保留。`validatePerformanceSliceRollbackContract()` 会检查这些保留文件仍存在且没有与优化文件重叠；因此回滚一个切片不会删除诊断性能工具或行为回归证据。

## Main low-frequency loading audit (task 2.5)

The Main process keeps menu templates, command IDs, shortcut mappings, and window-control actions available during startup because Electron builds the application menu and editor windows need these callbacks immediately. The audit found one safe, measurable boundary: the Pandoc converter is only used by Import and non-Markdown drag-and-drop. `menu/actions/file.ts` now loads `utils/pandoc` with a first-use dynamic import, while the Import menu, command, drag-and-drop behavior, export/print IPC responses, and window-control entries remain registered.

Export, print, PDF, and low-frequency dialogs are already behind the renderer first-use dynamic imports documented above. Moving their Main IPC handlers or menu callbacks later would create an IPC/menu availability window and has no demonstrated startup benefit in the current build, so they were not blindly split. Keyboard diagnostics also remain an explicit opt-in path; no startup-only diagnostic work was added.

Validation for this slice:

- `main-low-frequency-loading-boundaries.spec.ts` verifies the Pandoc static import is absent and first-use import is present.
- The same test verifies Import, Export, Print, fullscreen, and always-on-top menu entry points remain present.
- Compare production chunk reports before/after with `corepack pnpm --filter marktext perf:report -- chunks packages/desktop/out/renderer ...`; accept this slice only when startup measurements show a reduction, otherwise retain the boundary as a no-regression audit result.

## Element Plus and Muya/diagram boundary audit (tasks 3.6/3.7)

The production build was compared before and after the renderer entry change using:

```powershell
corepack pnpm --filter marktext build:unpack
corepack pnpm --filter marktext perf:report -- chunks packages/desktop/out/renderer --output <report-file>
```

The safe change was to replace the package-level `element-plus` installer and `dist/index.css` with the 17 Element Plus components actually used by renderer templates, their component CSS entries, and `provideGlobalConfig({ locale: en }, app, true)`. This preserves the locale/config-provider behavior while avoiding registration and parsing of unused services and components (for example Message, Loading, date pickers, upload, and table-v2).

Measured renderer entry totals on the same workspace/build flow:

| Entry total        | Before full installer | After selective registration |                 Change |
| ------------------ | --------------------: | ---------------------------: | ---------------------: |
| Initial JavaScript |           2,835,880 B |                  1,604,651 B | -1,231,229 B (-43.42%) |
| Initial CSS        |             401,016 B |                    185,925 B |   -215,091 B (-53.64%) |
| Initial JS + CSS   |           3,236,896 B |                  1,790,576 B | -1,446,320 B (-44.68%) |

The `@muyajs/core` barrel entry was audited but not replaced blindly. The existing desktop type boundary intentionally maps the package root to a curated declaration surface; direct subpath imports are not represented by that declaration boundary and failed `vue-tsc` resolution in this workspace. Keeping the barrel import therefore avoids a type/runtime contract regression. The measurable and behavior-safe 3.6 improvement is the Element Plus selection; no speculative Muya split was merged.

The Muya diagram boundary remains unchanged. `packages/muya/src/utils/diagram/index.ts` keeps `plantuml`, `mermaid`, `vega-embed`, `flowchart.js`, and `sequence` behind first-use dynamic imports. The post-change production HTML entry contains none of those implementation identifiers, while the output still contains diagram-related dynamic chunks (including Mermaid, flowchart, and sequence assets). This prevents Mermaid/Vega/flowchart/sequence from returning to the first screen.

The boundary test is `renderer-startup-dependency-boundaries.spec.ts`. It verifies the selective Element Plus list and CSS entries, the absence of the duplicate Muya side-effect import, all diagram dynamic imports, and the production entry/dynamic-chunk split. The full desktop unit run covering this test passed with 944 tests passed and 1 skipped.

## Startup language, theme, and preference hydration (task 2.6)

The Main process reads the small startup preference snapshot once and reuses it for language selection, native theme setup, keybinding style, and initial editor/settings window options. The selected language and visual settings are passed through the existing window URL startup parameters; the preload boot handshake and existing preference IPC channels remain unchanged. Renderer startup loads the selected locale before mounting Vue, hydrates the preference store before the first page render, and applies the selected theme during page setup rather than from a post-mount timer. The full `mt::ask-for-user-preference` request remains available for non-startup settings and later changes.

The code-level regression is covered by `packages/desktop/test/unit/specs/startup-preferences-no-flash.spec.ts`, which checks startup snapshot reuse, URL/bootstrap propagation, pre-mount locale/style ordering, and preservation of the legacy current-language fallback.

## 大文件 I/O 评估（任务 6.8）

本轮只评估 `loadMarkdownFile` 的大文件读取路径，没有合入首块编码猜测或流式读取实现。当前调用关系是：编辑器启动和 tab 恢复、文件 watcher 的 Markdown `add/change` 都调用同一个 `loadMarkdownFile`；保存路径则把 Renderer 的完整 Markdown 字符串编码为 Buffer 后交给 `writeFile`。因此，任何只读取首块的方案都不能直接替代完整内容读取，且必须同时保持编码、BOM、混合换行、trailing newline 和原有错误传播语义。

评估测试：

```powershell
corepack pnpm --filter marktext exec vitest run test/unit/specs/markdown-large-file-io-evaluation.spec.ts --reporter=verbose
```

测试固定生成匿名 4 MiB Markdown fixture，并覆盖：

- UTF-8 BOM、UTF-16 LE BOM 和保存时 BOM 保留；
- 混合 CRLF/LF 的内部 LF 归一化及保存前 CRLF 恢复；
- 空文件、单 trailing newline、双 trailing newline 和无 trailing newline；
- 缺失文件的 `ENOENT` 错误语义；
- 完整 Buffer 与 64 KiB 首块的编码猜测对照；
- 大文档编码检测、加载和进程 RSS/heap 样本记录。

两次本机样本中，4 MiB fixture 的完整编码检测约为 `2.98–5.38 ms`，64 KiB 首块约为 `0.12–0.13 ms`，完整加载约为 `7.96–35.70 ms`。这些时间仅用于评估，不作为 CI 门槛；测试会输出匿名 fixture 大小、耗时和进程内存，不写入路径或正文。

结论：不合入首块编码猜测。`ced` 的结果依赖完整字节序列；例如首块是合法 UTF-8、尾部包含非法 UTF-8 字节时，首块方案会选择 UTF-8，而现有完整检测会回退到 `ced` 的编码。改变该行为可能造成非 UTF-8 文档乱码。也不合入流式读取：当前 API 必须返回完整 Markdown 字符串，换行/混合换行/trailing newline 需要完整内容，watcher 还要把完整结果通过 IPC 发送；在没有真实基线证明 Buffer、解码字符串和保存编码副本可以减少的情况下，流式实现会增加 decoder、边界状态和错误时序风险，而不会消除 Renderer 必需的完整字符串副本。

后续若要重新评估，应使用同一构建、同一固定大文档，分别测量 cold startup、watcher change reload 和 save 前稳定期的 Main/Renderer RSS、JS heap、文档加载延迟及保存延迟；只有在全部语义回归测试通过且 p95 有稳定收益时，才单独引入流式/分块方案。

## 编辑器延迟分解指标

本节记录一次可复现的“打开文档/切换渲染”微基准，用于量化消除 Muya inline 渲染 O(N²) 全树扫描后的收益。基准不依赖真实应用与 IPC，只测 `Muya` 解析 + block 树构建 + 首轮 inline 渲染的同步耗时，因此绝对值不能直接当作端到端打开耗时，但扩展比与同机对照有参考价值。

命令：

```powershell
& 'D:\Program Files\nodejs\corepack.cmd' pnpm --filter @muyajs/core exec vitest run src/__tests__/inlineRenderCacheImpact.spec.ts
```

场景与结果（Windows / happy-dom，同一进程内先后运行，预热一次）：

| 场景 | 块数 | 优化前 | 优化后 | 收益 |
| ---- | ---- | ------ | ------ | ---- |
| 同一文档首轮渲染，每块重扫全量状态（对照） | 300 | 1035.2ms | — | — |
| 同一文档首轮渲染，引用定义按 revision 缓存 | 300 | — | 491.0ms | 2.11x |
| 纯扩展性检查（100 → 400 块） | 100 / 400 | 16x（理论二次增长） | 2.71x | 亚线性 |

说明：

- 优化前的时间来自同一份代码在运行时禁用 revision 缓存（强制每个 block 重新 `getState()` 并遍历全树），与优化后路径共享解析、DOM 构建和 tokenizer，排除环境差异。
- 该改动同时让 `Muya.getMarkdown()` 复用只读状态，去掉了编辑热路径上一次全量深拷贝；`json-change` 中的全量 Markdown 序列化仍然存在，属于后续任务 5.2。
- 以上是渲染内核级微基准，不等于端到端收益。冷启动、真实大文档打开和多 tab 切换的端到端数值仍需按任务 1.4/1.5/6.3/6.4 采集。


本节的指标用于把“打开软件慢、打开文档慢、多个文档切换慢”拆成可观测阶段。报告 schema 已允许这些 milestone 与 counter 名称；已接入采集的 milestone 仍可能只在特定路径打点，未接入的 counter 只能按“计划/待接入”理解，不能把缺失值填成零或推断为良好。

### 启动场景：首窗、活动文档与全部恢复分离

启动不要只看 `editor-interactive`。同一份报告中应结合以下 milestone 看阶段边界：

| 指标                        | 语义                                                                                                   | 用途                                                                 | 不能混同为                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- |
| `first-window-shown`        | 首个编辑器窗口完成加载并进入 ready 生命周期的时间点；当前在窗口 `did-finish-load` 路径记录。           | 判断“软件何时出现”与“编辑器何时可用”之间的差距。                     | `editor-interactive`；窗口显示不代表活动文档已经解析或渲染。    |
| `active-document-requested` | 恢复路径确定活动 tab 并开始请求其内容的时间点；当前仅在恢复流程中记录。                                 | 量化从窗口出现到活动文档读取开始的调度开销。                         | `first-document-requested`；后者是更通用的路径入口，不限定恢复。 |
| `first-document-loaded`     | Renderer 中 `currentFile.markdown` 首次可用的时间点；当前以 `hasCurrentFile` 变化为信号。              | 区分“文档已进入 store”与“Muya 已解析、首帧已绘制”。                   | `active-document-loaded` 或 `first-content-paint`。             |
| `active-document-loaded`    | 恢复流程中活动文档的 Main 侧读取任务结束的时间点；当前在活动文档 refresh 完成后记录。                  | 与 `all-restore-complete` 对比，隔离“活动文档先可用”与“所有 tab 后台完成”。 | Renderer 已绘制或用户已经可输入；它可能早于解析完成。           |
| `all-restore-complete`      | 活动文档已 settle，且所有后台恢复任务均已结束的时间点；当前在恢复任务收尾时记录。                      | 衡量后台恢复拖尾，不应被当作首屏启动时间。                           | 启动完成时间；非活动 tab 恢复不应阻塞用户开始编辑。             |

启动报告应同时保留 `first-window-shown`、`active-document-requested`、`active-document-loaded`、`editor-interactive` 和 `all-restore-complete`。若只看到 `editor-interactive`，无法判断慢在窗口创建、活动文档读取、解析/渲染还是后台恢复队列。当前 `restore-tabs` 与 `app-recovery` 的必需 milestone 仍以既有集合校验；上述拆分指标的强制场景契约属于计划/待接入，接入前按“有值才比较，缺值为未知”处理。

### 打开文档：请求、读取、解析、首帧与后台完成

打开单个文档时，当前可直接观察的边界是 `first-document-requested`（Main 发起打开路径）和 `first-document-loaded`（Renderer store 中内容可用）；`editor-interactive` 只在编辑器初始化路径记录，不应对每次打开都重新解释为“本次文档可交互”。读取、解析和后台派生三个阶段现已各自接入独立 milestone：

| 阶段         | 观察点                                                                                       | 用途                                                         | 不能混同为                                                     |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| 请求         | `first-document-requested`，Main 发起打开路径时记录。                                          | 定位主进程调度、窗口选择和 IPC 排队延迟。                     | 磁盘读取开始；请求发出不代表文件已打开。                       |
| 读取         | `document-read-complete`，Main 完成文件读取、编码检测、BOM/解码和行尾归一化后记录。               | 分离 I/O、编码检测与转换成本。                               | 解析或 DOM 构建耗时；读取完成仍可能没有任何内容出现在画面上。 |
| 解析         | `document-parsed`，Renderer 真正执行一次完整 Markdown 解析后记录；同时上报累计 counter `parsedDocuments`。 | 识别大文档在解析器上的主线程占用。                           | 全部渲染完成；解析只是 DOM/block 构建前置阶段。                |
| 首屏         | `first-content-paint`：首个文档内容提交并完成一帧的时间点；当前在编辑器首次渲染和 tab 切换路径记录。 | 衡量用户实际看到内容的延迟，而不是内部数据可用时间。         | `first-document-loaded`；store 有值不等于屏幕已绘制。          |
| 可交互       | `editor-interactive`：编辑器初始化完成、可接受输入的时间点。                                      | 衡量打开后可用性；首次启动与后续打开必须按场景区分。         | 文档打开完成；首次启动的该指标不能被复用为每次打开指标。       |
| 后台完成     | `derived-work-complete`，被推迟的 TOC/统计遍历完成后记录；同时上报累计 counter `deferredDerivedWork`。 | 识别后台任务是否仍在抢占主线程、延迟后续输入。               | 首屏或可交互；后台完成不应作为用户可见完成门槛。               |

两个新 counter 的采集语义：

- `parsedDocuments` 只统计真正执行的完整解析。tab 切换命中 `parsedStateCache` 时不计数，因此该值可直接与 `tabSwitchCacheMisses` 对照，判断是否重复解析同一内容。
- `deferredDerivedWork` 统计被移出首帧路径的派生遍历次数（当前为 TOC 更新，包括编辑器挂载时的那一次）。它只说明“推迟了多少次”，不代表后台工作耗时；`derived-work-complete` 才是收敛边界。
- 两者都是进程内累计值，因为 Main 侧 reporter 对 counter 采用合并（merge）而非求和语义；同一进程内重复采集时会读到递增的总量，不能当作单次打开的次数。

`large-document` 场景应固定 1024 KiB 合成文档，并分别比较 p50/p95 的请求、读取、解析、首帧和可交互阶段。读取与解析现在都有独立 milestone，`document-read-complete` 到 `document-parsed` 的差值可直接定位解析器占比；但渲染/布局仍混在该差值中，不能把全部时间归因于解析器。

### Tab 切换：请求、首帧、可交互与缓存

Tab 切换已有 `tab-switch-requested` 和 `tab-switch-rendered` 两个 milestone：前者在激活 tab、进入编辑器切换流程时记录，后者在内容切换调用返回后记录。当前实现还会随后用 `requestAnimationFrame` 记录 `first-content-paint`。这些 milestone 使用 first-seen 语义，同一进程内只保留首次值；因此一次报告不能直接表达多次切换的每次耗时，必须每次切换单独运行，或等计划中的每次切换样本接入后再做分布统计。

| 指标                     | 语义                                                         | 用途                                                       | 不能混同为                                                     |
| ------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------------------- |
| `tab-switch-requested`   | 用户或程序激活另一个 tab 的时刻。                            | 作为单次切换延迟的起点。                                   | 文件打开请求；切换通常不应重新读取磁盘。                       |
| `tab-switch-rendered`    | 内容切换调用完成、新文档状态已交给编辑器路径的时刻。         | 量化同步解析/状态恢复与 DOM 重建开销。                     | 用户已看到首帧；此时尚未保证下一帧已经绘制。                   |
| `first-content-paint`    | 切换后首帧内容应已绘制的时间点；当前通过 `requestAnimationFrame` 记录。 | 量化切换的用户可见延迟。                                   | `tab-switch-rendered`；两者之间的差值代表提交后等待绘制的时间。 |
| 可交互                   | 切换后可继续输入和恢复光标/历史的时刻；当前没有独立的每次切换 milestone。 | 区分“画出来”与“能用”，尤其是有历史栈恢复时。               | `tab-switch-rendered`；渲染返回不等于交互状态完整。            |
| `tabSwitchCacheHits`     | 计划 counter：切换到已缓存解析状态、跳过一次完整 Markdown 解析的次数。 | 验证缓存是否命中热路径，并解释切换耗时变化。               | 缓存字节数或内存占用；命中计数不表示缓存总体积合理。           |
| `tabSwitchCacheMisses`   | 计划 counter：切换到无缓存或内容已变化、需要完整解析的次数。 | 与命中次数共同判断缓存覆盖率和失效原因。                   | 解析次数；`parsedDocuments` 才描述实际解析工作量。             |
| `parsedDocuments`        | 累计 counter：进程内执行完整 Markdown 解析的次数（tab 切换缓存命中不计数）。 | 判断打开/切换是否重复解析同一内容；配合 `tabSwitchCacheMisses` 使用。 | `renderedBlocks`；解析文档不代表渲染了多少 block。             |
| `renderedBlocks`         | 计划 counter：单位运行内创建或更新的 block 数量。            | 衡量 DOM/block 树重建规模，解释大文档的渲染尾延迟。         | 文档数量或 Markdown 行数。                                     |
| `stateClones`            | 计划 counter：单位运行内执行全量状态/历史深拷贝的次数。       | 追踪 `structuredClone`、历史序列化等主线程成本。             | 内存字节数；次数不能替代每次克隆大小的评估。                   |
| `deferredDerivedWork`    | 累计 counter：被推迟到首帧之后执行的派生任务次数（当前为 TOC 更新）。 | 判断后台工作是否被正确移出关键路径。                       | 已完成工作量；计数只能说明推迟次数。                           |

切换场景建议使用 `multi-tab` 或专门的固定 4 个匿名 tab 场景，固定“首次访问 -> 切走 -> 切回”的顺序，并至少重复 3 次。已接入采集的是 `tab-switch-requested`、`tab-switch-rendered`、`first-content-paint` 和 `tabSwitchCacheHits`/`tabSwitchCacheMisses`/`parsedDocuments` 三个 counter；`renderedBlocks` 与 `stateClones` 仍是 schema 与文档定义，尚未在应用代码中采样，不能当作 0 次。缓存命中和未命中必须与解析、渲染、克隆计数一起看，避免只优化命中率却增加内存或恢复历史成本。

### 高频编辑：json-change 派生工作成本分解

任务 5.1/5.2 需要先量化每次文档变更里同步执行的派生工作，而不是靠猜。两个基准分别覆盖 Muya 侧与桌面侧：

```powershell
corepack pnpm --filter @muyajs/core exec vitest run src/__tests__/jsonChangeDerivedCost.spec.ts
corepack pnpm --filter marktext exec vitest run test/unit/specs/json-change-derived-cost.spec.ts
```

400 块（约 41.8k 字符）文档，同一进程内单次调用的平均值：

| 派生工作 | 位置 | 单次耗时 | 占比 |
| -------- | ---- | -------- | ---- |
| Markdown 全文序列化（`getMarkdown`） | Muya `StateToMarkdown` | 5.02ms | 77.0% |
| 字数统计（`wordCount`） | 桌面 `store/help.ts` | 1.26ms | 19.3% |
| synthetic history 内容哈希 | 桌面 `syntheticHistory.ts` | 0.24ms | 3.7% |
| 合计 | —— | 6.52ms | 100% |

结论与依据：

- 序列化是绝对大头，任何 5.2 方案都必须先处理它；先优化哈希（3.7%）属于选错目标。
- 桌面侧独立测量：`wordCount=1.19ms`、`hash=0.96ms`（50 次调用的平均值，与上表同量级）。
- 成本随文档大小增长而非随编辑大小增长：50 块 → 400 块（8 倍内容）耗时比约 26 倍，说明这是全文扫描而非增量工作。
- `wordCount` 与哈希都忽略编辑内容差异（字母 vs 空格耗时比 < 3），因此不存在“按字符优化”的空间，只能整体移出同步路径。
- 已移除的开销：`JSONState.dispatch` / `_flushOperationCache` 曾额外对编辑后状态做一次全量深拷贝并放进 `json-change` 的 `doc` 字段，而没有任何监听者读取它（`History` 只解构 `op`/`source`/`prevDoc`）。删除后每次分派少一次整树克隆，且不影响观测与历史语义。

该缺口已在此后落地（序列化、字数统计与哈希改为「下一帧 + 按 tab 合并」，见下一节）。上表数值保留为“优化前”基线，用于与合并后的提交次数对照。

#### 5.2 落地结果：内容提交按帧合并

派生工作改为「下一帧执行 + 按 tab 合并」后（`store/editor/contentCommit.ts`），同一帧内的多次批量操作只触发一次序列化 + 哈希：

```powershell
corepack pnpm --filter marktext exec vitest run test/unit/specs/json-change-derived-cost.spec.ts
```

160 次操作分布在 20 帧内（每帧 8 次），400 块文档：

| 指标 | 优化前 | 优化后 | 说明 |
| ---- | ------ | ------ | ---- |
| 派生提交次数 | 160 | 20 | 确定性指标：每帧一次，与帧内操作数无关（每帧 8 次操作为 8x 减少） |
| 桌面侧两趟耗时 | 约 213–323ms | 约 19–54ms | happy-dom 下抖动明显，实测 4.2x–12.5x |

提交次数是确定性结论，应作为主要依据；耗时倍数在该环境下波动较大，只能作为参考区间，不代表端到端收益。Muya 的全文序列化占原总成本 77%，且同样被合并，因此实际收益高于表中「桌面侧两趟」的测量范围。合并只改变「何时算」，不改变「算几次内容」：每帧结束时仍是文档的最新状态，最后一次快照覆盖之前的。

正确性约束（均已落地并有测试）：

- 光标仍同步持久化（`PERSIST_CURSOR`），不随内容提交延后。
- 所有读取 `tab.markdown` / `tab.history` 的路径（保存、关闭、切 tab、缓冲快照）都经由 `flushActiveEditor()` 同步落地；漏掉这一步会丢最后一次按键（#3803 同类问题）。
- 外部重载（`mt::load-content`）会 `drop()` 尚未提交的快照，避免用重载前的内容覆盖刚读入的文档。
- 可通过 `MARKTEXT_PERF_ROLLBACK=deferred-content-commit` 回到逐次同步提交。

### 5.3 深拷贝成本：哪些值得移除，哪些不值得

任务 5.3 要求「减少整树深拷贝」。先用测量决定目标，而不是全量替换 `getState()`。

```powershell
corepack pnpm --filter @muyajs/core exec vitest run src/__tests__/stateCloneCost.spec.ts src/__tests__/historyCloneCost.spec.ts
```

测量结果：

| 场景 | 规模 | 深拷贝耗时 | 占该路径比例 |
| ---- | ---- | ---------- | ------------ |
| `setContent` 的 `getState()` 克隆 | 900 个顶层块 | 约 1.35–2.29ms | 约 **0.1%**（完整 `setContent` 约 1282–1584ms） |
| 撤销栈 `getHistory()` + `setHistory()` 往返 | 深度 40 | 约 0.47–0.78ms + 0.66–1.05ms | 每次切 tab 约 1.1–1.8ms |
| 撤销栈深度翻倍 | 深度 10 → 80 | 0.78ms → 2.83ms | 约 3.6–4.0x（随编辑历史增长） |

结论与动作：

- **文档状态的整树克隆不值得移除**：在 900 块的文档上只占 `setContent` 的 0.1%，DOM/block 树构建才是主导。为此引入「把可变状态数组别名交给块树」的风险与收益完全不成比例——实测证实了这一点：把 `init()` / `setContent()` / `rebuildContents()` 改为读只读状态后，表格对齐、代码块 info string、剪贴板语言输入共 **7 个既有测试失败**（DOM 构建过程会就地改写传入了的状态对象，原先靠这次深拷贝隔离）。因此这三处**保持深拷贝**，该结论已用测量与回归证据记录，不引入别名。
- **唯一移除的是纯读取路径**：`History._change` 里的 `invertWithDoc` 只需要读取当前状态来构造逆操作，却调用了会深拷贝的 `getState()`。改为 `getStateReadOnly()` 后，每次 undo/redo 少一次全文档克隆；语义不变，全部 1479 个 Muya 测试通过。
- **`getState()` 保持公开的深拷贝语义**，供确实需要隔离的调用方使用（`buildReplaceObj` 的 diff、`getCursorOffset` 的哨兵注入等）。

### 5.5 高频编辑下的收敛与隔离

任务 5.2 的按帧合并与 4.5 的延后历史都必须满足：派生数据最终收敛到文档最新状态，且绝不跨文档污染。验证方式是把调度器当作一段长会话来跑，而不是单步调用——只有「延后工作晚于文档变化落地」时才会暴露问题。

```powershell
corepack pnpm --filter marktext exec vitest run test/unit/specs/derived-state-convergence.spec.ts
```

覆盖场景与结论：

| 场景 | 断言 |
| ---- | ---- |
| 200 次按键跨 50 帧连续输入 | 提交值恒等于**最终**文档，不是中间态 |
| 显式 flush 后残留的帧回调 | 不重复提交，最后一次按键不丢 |
| 两个文档交替编辑共 30 轮 | 各自提交到自己的 tab，最终值互不干扰 |
| 切走前 flush，再编辑新 tab | 提交顺序与归属正确（`tab-a:A` 先于 `tab-b:B`） |
| 延后恢复在 idle 前打字 | 恢复落地与已输入内容都保留（`adoptHistory` 合并而非替换） |
| undo 前的 flush + 后续 idle 回调 | 只应用一次，不会双重应用 |
| 关闭 tab 时队列中仍有恢复 | 丢弃不挂起，且不影响存活 tab 的队列 |

本轮修掉的一个真实缺陷：**TOC 延迟回调缺少「文档已切换」判断**。原代码只在最外层 `if (id && currentFile.value?.id !== id) return`，`deferred-toc` 关闭（回滚路径）时会**直接跳过判断**执行 `runTocUpdate`；更关键的是 `runTocUpdate` 自身不做校验。已改为在 `runTocUpdate` 内部强制校验 `currentFile.value?.id === id`，`id` 参数也改为必填，防止将来再次绕过。同时该场景已加断言锁定。

另一个：`DeferredHistoryRestore` 新增 `cancelOrphaned(liveTabIds)`，在 tab 列表变化时丢弃已关闭文档的排队恢复。原因是**关闭最后一个 tab 不会触发 `file-changed`**，引擎的 `renderedDocumentId` 仍指向已删除的 tab，idle 回调会把已不存在文档的历史栈应用上去。

### 3.x 视口门控：已实现但默认关闭（保持立即渲染）

打开路径的实测分解（150 块，3 次平均）：

| 内容 | 解析 `construct` | 建树 `init` |
| ---- | ---------------- | ----------- |
| 纯段落 | 4.5–11.2ms | 191–220ms |
| 代码块 | 2.8–23.8ms | 323–690ms |
| 公式块 | 2.3–3.2ms | **776–1661ms** |

结论要看**比值**而不是绝对值：公式块的建树时间是同样块数纯段落的 **4–8x**，装饰差值 541–1469ms，占公式建树时间的 **71–89%**，而解析始终只是毫秒级。绝对值在同一台机器上能随负载摆动 2–3 倍（同一份代码、同一个测试，实测公式块 `init` 从 776ms 到 1661ms），所以只有同一轮内的对照可靠。早期记录（段落 91.8ms / 公式 716.8ms）同样只是一个样本，不是需要被“取代”的旧基准。

**但该优化默认不启用。** 原因是块树直接在活动文档上构建（`getContainer` 的 `originContainer.replaceWith(newContainer)`，每个 block 的 `createDomNode()` 即建即挂），**没有离屏暂存区**；任何「首帧后再补渲染」都会落在**已绘制**的文档上，即闪烁，而本变更 spec 明确禁止。视口门控可以避免这一点（只改变「何时渲染」，不改变「渲染与否」），但用户明确要求**保持立即渲染**，故不启用。

已交付：`packages/muya/src/runtime/deferredDecorations.ts` 的 `IDeferredDecorationGate`，`enabled` 默认 `false` —— 关闭时 `shouldRenderEagerly` 恒为 `true`、`defer` 直接内联执行，行为与引入前完全一致。启用时的语义（仅接近视口的块立即渲染、几何未知时失败开放、按 id 合并、`flush()`/`discard()`）已有 15 个单测覆盖。当前**无调用方**。

若将来决定启用：接上 `MathPreview` / `DiagramPreview` 构造路径并把 `enabled` 接到回滚分片，且必须在桌面环境确认无闪烁（`MathPreview` 非激活时预览仍可见，故这一确认不可省略）。

### 6.2 Muya 规范与回归验证范围

任务 6.2 的“规范测试”以 CI 的两条聚合命令为准，而不是 `test:spec`：

```powershell
corepack pnpm --filter @muyajs/core test:spec:commonmark
corepack pnpm --filter @muyajs/core test:spec:gfm
```

最近一次运行：CommonMark 652/652、GFM 672/672 全部通过（本机实测，各约 5s）。同一包内的单元测试用**默认超时**跑 `vitest run`：**226 文件 / 1495 用例全部通过**。

这一条修掉的是一个真实的套件稳定性问题，而不是绕过它。此前默认超时下有 3 个用例失败；我先归因于“happy-dom 慢”，用 `--testTimeout=180000` 绕开。实测证明那确实只是**负载下的超时**（这些用例的断言只要求 `> 0`），于是改为在重负载用例上显式声明超时，使默认 `vitest run` 本就全绿：

| 用例 | 原因 | 设置 |
| ---- | ---- | ---- |
| `stateCloneCost` | 900 块 × 20 次 `setContent`（单次 ~19s） | 60 块 / 5 次迭代 + 显式 60s 超时 |
| `historyCloneCost`（2 例） | 录 40 / 80 次编辑后反复深拷贝整栈 | 显式 60s / 120s 超时 |
| `openPathBreakdown` | 每种内容建 4 个 150 块文档（实测 5.8s > 默认 5s） | 显式 120s 超时 |
| `tableChessboard > is exported from the package entrypoint` | 动态 `import('../../../index')` 加载整个模块图，单独跑也卡在 5.0s | 显式 60s 超时 |

这比“记得加 `--testTimeout`”可靠得多：后者一旦忘记，就会把一次真实回归埋进噪声里。

需要区分的是：`tableChessboard` 那条是**既有 flake**（单独复现也是 5023–5026ms），与本变更无关，顺手修掉而已；其余三条是本变更新增基准自身的稳定性问题。

`test:spec` 还包含 `test/spec/roundTrip.spec.ts`——历史回环特征用例，其中 3 例（Links、Lists、GFM/Tables）为已知失败。CI 明确只跑 commonmark 与 gfm 两条命令（`.github/workflows/ci.yml` 注释：聚合命令含“known failures”的历史用例），因此这 3 例不构成本次变更的回归；把它们计入 6.2 的通过门槛会与 CI 契约冲突。若要消除，需要单独立项修正序列化规范化行为，而不是在性能变更里顺带修改。

### 3.x 的最终状态：不实现，而非未完成

任务 3.2/3.3/3.4 在 `tasks.md` 中保持未勾选，但状态是**用户已决定的“不做”**，不是待办：

| 任务 | 状态 | 原因 |
| ---- | ---- | ---- |
| 3.1 状态可用与渲染完成分离 | 不实现 | 无离屏暂存区，延后会落到已绘制文档上即闪烁；用户要求保持立即渲染 |
| 3.2 视口优先渲染 | 不实现 | 同 3.1 |
| 3.3 跳转到未渲染区域的按需准备 | 不实现 | 同 3.1，且属于 Non-Goals 中的块级虚拟化前置条件 |
| 3.4 公式/图表装饰延后 | 不实现 | 同 3.1 |
| 3.4 目录 / 字数统计延后 | 已实现 | `deferred-toc` + `contentCommit` 按帧合并，已移出首帧 |

因此不应把 3.x 的未勾选理解为“还有优化空间未动”。若后续要拿这部分收益，需要单独立项（离屏构建或块级虚拟化），并同时完成 3.2/3.3/3.7 与真机闪烁确认。

### 待补的端到端采集

以下场景仍缺真实 Electron 下的样本，属于任务 1.4/1.5/2.7/4.7/6.3/6.4，不能由上面的微基准替代：

- 冷启动、多 tab 恢复、多个大文档打开、至少三个文档重复切换的优化前基线（1.4/1.5）。
- 启动恢复优化后“首窗可交互时间不随非活动恢复文档数线性增长”的验证（2.7）。
- tab 缓存命中的首帧/可交互时间显著低于未命中的验证（4.7）。
- 端到端启动、打开、切换、保存、恢复三阶段相对基线的改善，以及冷启动/多恢复 tab/大文档下的内存峰值、缓存命中率与主线程长任务（6.3/6.4）。

阻塞原因（已核实，非推测）：本机无任何 C++ 工具链（`cl`/`msbuild`/`vswhere`/`clang`/`gcc` 均不存在，VS 未安装）。**两个**原生模块都没有编译产物：

- `ced` —— 只有 `binding.gyp` 与 `vendor/compact_enc_det`；`node -e "require('ced')"` 报 `Could not locate the bindings file`。这是**关键**阻塞：`main/filesystem/encoding.ts` 在启动路径上 `import ced from 'ced'`，所以 Electron 在 renderer 代码执行前就退出。
- `native-keymap` —— 只有 `deps/`、`src/`、`binding.gyp`，同样没有 `.node`。

因此 Playwright `_electron.launch` 在 renderer 执行前即失败，应用无法启动。这些任务必须在具备原生构建能力的环境补跑（CI 的 Desktop Electron E2E job 在 Linux 上会先装原生构建依赖）。

回滚开关（6.6）已提供并可独立关闭任一优化切片而不影响观测：`MARKTEXT_PERF_ROLLBACK=restore-layering,tab-state-cache,deferred-history,deferred-toc,deferred-content-commit`（逗号分隔，未知名称被忽略；两个进程读同一个值）。关闭切片只恢复同步行为，milestone 与 counter 照常上报，因此回滚后的报告仍可与基线比较。

### 采集与比较

沿用“可重复测量流程”“可重复场景”和“完整测量操作手册”的命令。先构建生产等价产物，再把原始报告写到仓库之外，并保证同一目录只放同一场景、同一构建的原始报告：

```powershell
$reportRoot = Join-Path $env:TEMP 'marktext-perf'
$scenario = 'multi-tab'
$reportDir = Join-Path $reportRoot $scenario
$outputDir = Join-Path $reportRoot 'derived'
New-Item -ItemType Directory -Force -Path $reportDir, $outputDir | Out-Null

corepack corepack pnpm --filter marktext build:unpack

$env:PERF_TESTING = 'true'
$env:MARKTEXT_PERF_REPORT_DIR = $reportDir
$env:MARKTEXT_PERF_SCENARIO = $scenario

# 在同一构建和会话中执行至少 3 次固定 tab 顺序；每次记录后重载/重置场景。
corepack corepack pnpm --filter marktext perf:inspect

corepack corepack pnpm --filter marktext perf:report -- scenarios --output (Join-Path $outputDir 'scenarios.json')
Get-ChildItem -LiteralPath $reportDir -Filter '*.json' -File | ForEach-Object {
  corepack corepack pnpm --filter marktext perf:report -- scenario-validate $_.FullName
}
corepack corepack pnpm --filter marktext perf:report -- validate $reportDir
corepack corepack pnpm --filter marktext perf:report -- summarize $reportDir --output (Join-Path $outputDir "$scenario-summary.json")
```

启动与恢复场景把 `$scenario` 改为 `cold-editor`、`restore-tabs` 或 `app-recovery`；打开文档场景使用 `large-document`。比较时必须固定 `build.id`、机器类别、平台/架构、Node/pnpm、应用设置和固定输入，并同时检查 p50 与 p95。新增 milestone 或 counter 尚未进入场景必需集合时，报告可能缺失对应字段；缺失表示“未采集”，不能当作 0 ms 或 0 次。对多文档切换，不要只截取一次运行的最快样本，也不要把不同 tab 顺序混入同一组。

### 隐私要求

本节的里程碑和 counter 只记录匿名数值、阶段名和计数：不得记录文件路径、文件名或 tab 名称，不得记录文档正文、Markdown、片段、摘要、哈希原文或可反推内容的标识，也不得把路径或正文写入 `scenario`、`build`、内存样本或自定义说明字段。固定输入只保留如窗口数、tab 数、文档大小等匿名计数；操作记录可以说明“固定匿名 tab 顺序”，但不能在报告目录、文件名或报告内容中暴露真实文档信息。若新增采样实现，必须继续通过现有报告校验器；任何无法保证匿名的字段应先移除，再考虑采集。
