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
