## 1. 基线与观测

- [x] 1.1 扩展性能报告阶段定义，加入首窗显示、活动文档请求、活动文档加载、编辑器可交互和全部恢复完成，并验证现有性能脚本可编译运行
- [x] 1.2 为文档打开加入请求、文件读取、解析、首屏可显示、编辑器可交互和后台工作完成指标，并验证指标能在同一文档上重复采集
- [x] 1.3 为 tab 切换加入状态可用、首帧更新、编辑器可交互和缓存命中标记，并验证命中与未命中路径可区分
- [ ] 1.4 建立并记录优化前基线场景：冷启动、多 tab 恢复、多个大文档打开和至少三个文档重复切换
  - 环境阻塞（已核实）：需要真实 Electron。本机无 C++ 工具链，而**两个**原生模块都缺编译产物：`ced`（启动路径上被 `main/filesystem/encoding.ts` 引入，是关键阻塞）与 `native-keymap`（`node_modules/native-keymap` 与 `packages/desktop/node_modules/native-keymap` 均只有 `deps/`、`src/`、`binding.gyp`，无 `.node`）。结果 `electron.launch` 在 renderer 代码执行前失败；详见 `PERFORMANCE.md`“待补的端到端采集”。
- [ ] 1.5 记录基线中的主线程长任务、解析次数、DOM 块创建数量和状态深拷贝耗时，并验证报告可导出对比结果
  - 环境阻塞（同上）。其中可在单进程内测得的解析、克隆、派生成本部分已落地：Muya 侧 `stateCloneCost` / `historyCloneCost` / `jsonChangeDerivedCost` / `openPathBreakdown` / `largeDocumentRenderBenchmark` / `inlineRenderCacheImpact`，桌面侧 `json-change-derived-cost` 与 `document-open-metrics`。

## 2. 启动恢复分层

- [x] 2.1 重构启动恢复编排，将非活动恢复工作从首窗关键路径移出，并验证存在多个恢复文档时首窗仍可交互
- [x] 2.2 调整恢复数据结构以先发送 tab 轻量元数据，再按需加载正文，并验证标题、顺序、活动状态和未保存标记保持正确
- [x] 2.3 实现活动文档优先加载，并验证活动文档进入可编辑状态不依赖非活动文档正文加载完成
- [x] 2.4 实现后台恢复任务的受控调度与取消，并验证窗口或 tab 关闭后过期任务不会写回状态
- [x] 2.5 隔离单文档恢复失败，并验证失败 tab 可识别、可关闭且不影响其他文档和首窗交互
- [x] 2.6 补充多窗口、多 tab、未保存内容和恢复失败的桌面测试，并验证所有新增场景通过
- [ ] 2.7 采集启动恢复优化后指标，并验证首窗可交互时间不再随非活动恢复文档数量线性增长
  - 环境阻塞（已核实，同 1.4）。分层编排已用纯策略单测锁定（`restore-plan` / `restore-scheduler` / `restore-tab` / `restore-orchestration`）：活动文档先 refresh 再发 state，非活动队列并发 2、可取消、失败隔离。

## 3. 文档打开阶段化

- [ ] 3.1 将文档状态可用与完整渲染完成状态分离，并验证编辑器可编辑不代表非关键装饰已完成
  - 阻塞（已核实，需决策后再实现）：块树是**直接在活动文档上构建**的（`getContainer` 里 `originContainer.replaceWith(newContainer)`，随后 `scrollPage.domNode` 立即挂载，每个 block 的 `createDomNode()` 即建即挂），**没有离屏暂存区**。因此「把装饰渲染推迟到首帧之后」会让装饰在**已绘制**的文档上补渲染，产生可见闪烁，而本变更的 spec 明确禁止（“MUST NOT 因分阶段处理引入可见闪烁”）。
  - 证据：`MathPreview` / `DiagramPreview` / `HTMLPreview` 都在**构造函数内**调用 `update()`（KaTeX 等重型渲染即在打开路径上）；而 CSS 中**没有任何规则隐藏非激活状态的** `.mu-math-preview` / `.mu-diagram-preview`（`blockSyntax.css` 仅对 `mu-active` 改浮动定位），故这些装饰在未激活的块里也是可见的，不能安全延后。唯一确属不可见的是代码块行号 gutter（`.mu-language-input` 在非激活时 `opacity: 0`），而它已经是 `requestAnimationFrame` 延后。
  - 可行路径（均超出 3.1 单任务范围，需选一）：(a) 引入离屏构建/暂存容器，构建完成后一次性换入（改动 `ScrollPage` 与所有 `createDomNode` 的挂载假设，风险高）；(b) 改为视口门控渲染，即 3.2/3.3 的范围。
  - 用户决定：**保持立即渲染**。因此本任务的实现结论是「不启用视口门控」，而不是「未完成」。
  - 决策依据（实测，150 块 / 3 次平均，多次运行区间）：纯段落 `init` 200.5–272.4ms，代码块 558.8–580.3ms，公式块 **1644.1–1765.7ms**；公式版比段落版慢 6.1–8.0x，装饰差值 1443.6–1493.3ms，占公式建树的 **84.6–87.8%**（解析 `construct` 始终为毫秒级）。收益真实且集中在装饰，但用户明确要求保持立即渲染，故不启用。绝对值对机器负载敏感（同一份代码两次运行相差可达 1.8x），只有同一轮内的对照可靠。
  - 交付物：`packages/muya/src/runtime/deferredDecorations.ts` 的 `IDeferredDecorationGate`，**默认关闭**（`enabled` 默认 `false`，`shouldRenderEagerly` 恒为 `true`、`defer` 直接内联执行），启用时才做视口判定。15 个单测，其中前 3 个专门锁定「默认与显式关闭都必须立即渲染」。未接入任何调用方，因而不改变任何可见行为。
  - 启用时的语义（已测）：仅「接近视口」的块立即渲染，其余排队至靠近时渲染；无 DOM / 无 `IntersectionObserver` / 几何不可测时**一律失败开放**；按 id 合并重复更新；`flush()` / `discard()` 供模式切换与文档替换使用。
  - 若后续决定启用：接上 `MathPreview` / `DiagramPreview` 的构造路径，并把 `enabled` 接到回滚分片（含真机确认无闪烁，需桌面环境）。
- [ ] 3.2 实现当前视口优先准备与渲染，并验证首屏时间短于或等于优化前基线且内容正确
  - 不实现（用户决定，同 3.1）：保持立即渲染，不引入视口门控。若将来启用，需同时完成 3.2/3.3/3.7 三项并在桌面环境验证。
- [ ] 3.3 实现跳转或滚动到未渲染区域时的按需准备，并验证最终显示、选区和滚动位置与完整渲染一致
  - 不实现（用户决定，同 3.1）。注意这是块级虚拟化的前置条件，而块级虚拟化在本变更的 Non-Goals 中，应单独立项。
- [ ] 3.4 将代码高亮、公式、图表、目录和字数统计移出首屏关键路径，并验证用户输入不被这些工作阻塞
  - 公式/图表装饰：不实现（用户决定保持立即渲染，同 3.1）。
  - 目录与字数统计：**已移出首帧**（`deferred-toc` 分片 + 按帧合并的 `contentCommit`），输入不被这两项阻塞，由 5.2/5.5 的收敛测试与 counter 验证。
  - 代码高亮未改为延后：代码块打开成本已实测（`openPathBreakdown` 约 559–580ms / 150 块），且属 3.1/3.2 同一决策范围。
- [x] 3.5 保持编码检测、BOM、换行和解码错误语义不变，并验证非 UTF-8 与混合换行文档的显示和保存结果
  - 本变更未触碰读取/写入语义，因此本条是“证明未回归”而不是实现项。证据：`markdown-large-file-io-evaluation.spec.ts` 覆盖 BOM + 混合换行（`one\r\ntwo` → 内部 LF、`lineEnding='crlf'`、`adjustLineEndingOnSave=true`、回写为 CRLF 且保留 BOM）、UTF-16LE BOM、尾部换行元数据（空/单换行/双换行）、以及 `ENOENT` 错误语义；`encoding.spec.ts` 覆盖 ced 误判（#3151）、非 UTF-8 回退、NUL 字节不强制 utf8、UTF-8 BOM 不再走 ced。
  - 相关实现刻意保持全缓冲区读取（`loadMarkdownFile` 注释）：前缀检测与整文件 ced 结论可能不一致，而解码/换行分析/IPC 载荷仍需要完整字符串，因此未做流式或前缀检测替换，也就不会引入语义差异。
- [ ] 3.6 补充大文档首屏、跳转、编辑和保存测试，并验证打开优化后指标满足阶段门槛
  - 本机可完成的部分已落地，但**只到“可复现测量 + 语义锁定”层级，不是端到端首屏门槛**；因此保持未完成。
  - 已落地：`largeDocumentRenderBenchmark.spec.ts` 断言 100→400 块的扩展比为亚线性（线性≈4x，旧二次行为≈16x，门禁 <10x，实测 4.38x）；`openPathBreakdown.spec.ts` 分离解析与建树；`stateCloneCost` / `inlineRenderCacheImpact` 记录克隆与首轮渲染成本；保存/编码路径由 `markdown-large-file-io-evaluation.spec.ts` 锁定。
  - 缺口：「跳转后选区和滚动位置一致」需要真实布局，且其实现（3.3）已被用户决定不做；「首屏时间满足阶段门槛」与 1.4/6.3 同因环境阻塞（无 C++ 工具链 → `ced` 原生绑定缺失 → Electron 无法启动）。
- [x] 3.7 验证分阶段渲染不会造成闪烁、重复内容或光标位置变化
  - 结论：**当前不存在分阶段渲染，因此不可能闪烁**。视口门控默认关闭（`IDeferredDecorationGate.enabled` 默认 `false`，`shouldRenderEagerly` 恒为 `true`、`defer` 内联执行），且无任何调用方（`deferredDecorations.ts` 未被 `MathPreview` / `DiagramPreview` 接入），故渲染时序与引入前一致；15 个单测中前 3 个专门锁定“默认与显式关闭都必须立即渲染”。
  - 光标位置未受影响：切 tab 用同步 `PERSIST_CURSOR`（不随按帧内容提交滞后），`cursor-apply.spec.ts` 与 `tab-switch-cursor.spec.ts` 继续通过。若将来启用门控，本条必须重新评估，并需在桌面环境确认无闪烁。

## 4. tab 状态复用

- [x] 4.1 设计并实现最近使用 tab 的有界复用管理，并验证缓存命中与未命中路径可被观测
- [x] 4.2 实现缓存命中时复用已解析或编辑状态，并验证切回最近 tab 不会重新执行完整 Markdown 解析和完整树重建
- [x] 4.3 实现磁盘内容、路径、文件身份和编码变化的缓存失效，并验证外部修改后激活 tab 显示最新内容或进入冲突处理
- [x] 4.4 实现 LRU 或等价上限及内存压力释放，并验证释放缓存不会丢失未保存内容、文档身份和重新加载信息
- [x] 4.5 将 tab 历史恢复改为按需、增量或引用式处理，并验证立即输入、切回撤销和跨文档历史隔离
- [x] 4.6 补充多文档切换、缓存驱逐、外部修改和未保存内容测试，并验证所有新增场景通过
  - 缓存驱逐/失效：`parsed-state-cache.spec.ts`（内容、pathname、fileIdentity、编码/BOM 四种失配各自 miss；LRU 超容量驱逐；`invalidate()`/`retain()`/`clear()`；容量校验；内存压力阈值判定含不可用快照不关闭缓存）。
  - 多文档切换与历史隔离：`derived-state-convergence.spec.ts`（两文档交替 30 轮各自归属、跨文档不污染、切走前 flush 的顺序与归属、undo 前 flush 只应用一次、关闭 tab 丢弃排队恢复）；`deferred-history.spec.ts`（不在切换内应用、idle 后应用、切走前 flush、已离开则立即应用、目标 tab 已变则丢弃、替换而非堆叠、teardown 丢弃、只取消指定 tab）。
  - 外部修改：`file-change-content-check.spec.ts` 保留 #1861 语义（仅 mtime 变化不提示、内容真变才提示）；`restore-tab.spec.ts` 覆盖“磁盘内容已变则更新已保存 tab”与“未保存草稿在磁盘内容可读且不同时仍保留”。
  - 未保存内容不因缓存释放而丢失：缓存只存解析状态，`tab.markdown` / `fileIdentity` / `encoding` / 光标均留在 store（`ParsedStateCache.clear()` 注释与 `clear/rebuilt` 用例锁定）。
  - 以上全部通过（桌面单测 121 文件 / 1118 通过，1 跳过）。
- [ ] 4.7 采集 tab 切换优化后指标，并验证缓存命中的首帧和可交互时间显著低于缓存未命中路径
  - 环境阻塞（已核实，同 1.4）。命中/未命中路径的可区分性已由 counter 与单测覆盖：`parsedDocuments` 只在真正重新解析时递增，`tabSwitchCacheHits` / `tabSwitchCacheMisses` 在两条分支各自上报，`parsed-state-cache.spec.ts` 锁定命中、失效与 LRU 语义。

## 5. 高频变更减负

- [x] 5.1 识别每次文档变更中的同步必需数据与可延后派生数据，并形成实现清单和验证用例
- [x] 5.2 将 Markdown 全文序列化、TOC、字数统计和 synthetic history 哈希改为按需、防抖或空闲执行，并验证快速连续输入时界面保持响应
  - TOC 遍历已移出首帧（`deferred-toc` 分片）；`json-change` 中未被任何监听者读取的 `doc` 全量深拷贝已移除（Muya `JSONState.dispatch` / `_flushOperationCache`）。
  - Markdown 全文序列化、字数统计与 synthetic history 哈希改为下一帧执行并按 tab 合并（`store/editor/contentCommit.ts`）；同时将光标改为同步持久化（`PERSIST_CURSOR`），保证光标不随内容提交滞后。
  - 落地数据（确定性）：160 次操作 / 20 帧 / 400 块文档，派生提交次数 160 → 20（每帧一次，与帧内操作数无关，即 8x 减少）；耗时在该 happy-dom 环境下抖动较大（实测 4.2x–12.5x），仅作参考区间，不作为端到端收益。Muya 序列化占原总成本 77%，同样被合并。基线见 `packages/muya/src/__tests__/jsonChangeDerivedCost.spec.ts` 与 `packages/desktop/test/unit/specs/json-change-derived-cost.spec.ts`。
  - 正确性：保存/关闭/切 tab/缓冲快照均经 `flushActiveEditor()` 同步落地（否则会丢最后一次按键）；外部重载会 `drop()` 未提交快照，避免旧内容覆盖新读入文档；`MARKTEXT_PERF_ROLLBACK=deferred-content-commit` 可回到逐次同步提交。
  - 合并语义：同一帧内多次批量操作只付一次派生成本，帧末仍是文档最新状态（后写覆盖先写）；不会跳过任何内容状态。
- [x] 5.3 减少编辑器状态与历史的整树深拷贝或改用增量维护，并验证撤销、重做和切换后的结果与优化前一致
  - 移除：`History._change` 中 `invertWithDoc` 只需要读取状态却调用会深拷贝的 `getState()`，已改为 `getStateReadOnly()`；每次 undo/redo 少一次全文档克隆，语义不变（当时全部 1479 个 Muya 测试通过；当前全量数字与超时说明见 6.2）。
  - 不移除（有测量与回归证据）：`init()` / `setContent()` / `rebuildContents()` 的整树克隆仅占 900 块文档 `setContent` 的约 0.1%，而 DOM/block 树构建才是主导；尝试改为只读别名后表格对齐、代码块 info string、剪贴板语言输入共 7 个既有测试失败（DOM 构建会就地改写状态对象，原先靠该深拷贝隔离）。因此保持深拷贝，不引入别名风险。
  - 数据：撤销栈往返（深度 40）约 1.1–1.8ms/次切 tab，且随编辑历史增长（深度 10→80 实测 3.6–4.0x，另一次运行达 10.46x——对负载敏感，但方向稳定）；该成本已通过 4.5 的延后恢复移出首帧路径。基线见 `packages/muya/src/__tests__/stateCloneCost.spec.ts` 与 `packages/muya/src/__tests__/historyCloneCost.spec.ts`。
- [x] 5.4 确认并移除或改为按需生成只写不读的大型 tab 数据，并验证 tab 切换、保存和恢复行为不回归
- [x] 5.5 验证高频编辑场景下统计、目录和历史最终收敛一致且不存在跨文档污染
  - 验证方式：把按帧提交与延后历史调度器当作长会话运行（200 次按键 / 50 帧、两文档交替 30 轮、切走前 flush、undo 前 flush、关闭 tab 时有排队恢复），断言最终值恒等于最后状态且归属正确。测试：`packages/desktop/test/unit/specs/derived-state-convergence.spec.ts`（12 个用例）。
  - 本轮修掉的真实缺陷一：TOC 延迟回调在 `deferred-toc` 关闭（回滚路径）时会**跳过**「文档已切换」判断，且 `runTocUpdate` 自身不做校验，可能把已切换文档的目录写到当前 tab。已在 `runTocUpdate` 内部强制校验 `currentFile.value?.id === id`，`id` 参数改为必填并加断言锁定。
  - 本轮修掉的真实缺陷二：`DeferredHistoryRestore` 新增 `cancelOrphaned(liveTabIds)`。关闭最后一个 tab 不会触发 `file-changed`，引擎的 `renderedDocumentId` 仍指向已删除的 tab，idle 回调会把已不存在文档的历史栈应用上去；现已在 tab 列表变化时丢弃孤儿排队恢复。
  - 全部桌面单测 121 文件 / 1118 通过；类型检查通过。

## 6. 集成回归与发布验证

- [x] 6.1 运行桌面单元测试和类型检查，并验证新增性能逻辑测试通过
  - 本轮复验：桌面 `vitest run test/unit` 121 文件 / 1118 通过（1 跳过）；`vue-tsc --noEmit` 无输出（通过）；新增性能逻辑测试（`content-commit` / `deferred-history` / `parsed-state-cache` / `derived-state-convergence` / `json-change-derived-cost` / `document-open-metrics` / `document-open-report` / `performance-rollback` / `restore-*` / `editor-store-characterization`）全部在通过集合内。
  - 同时复验桌面静态契约：`pnpm --filter marktext typecheck`（`vue-tsc --noEmit`）无输出，通过。
  - 关于仓库级 lint：CI 明确不把它作为门禁（`.github/workflows/ci.yml` 注释：仓库级 lint 含历史 generated/legacy 表面，Desktop 静态契约以 typecheck 为准）。本次也不以它为通过条件；改动文件仅涉及文档与 tasks，未新增可 lint 的源码表面。
- [x] 6.2 运行相关 Muya 规范测试，并验证 Markdown、解析、序列化和历史语义无回归
  - 本轮复验（默认超时，无命令行覆盖）：Muya `vitest run` **226 文件 / 1495 用例全部通过**；CI 的两条规范门禁 `test:spec:commonmark` 652/652、`test:spec:gfm` 672/672 通过。
  - 此前默认超时下的 3 个失败已定性并修掉：断言只要求 `> 0`，失败是**负载下的超时**而非断言失败。修法不是「记得加 `--testTimeout`」，而是在重负载用例上显式声明超时（`stateCloneCost` 另外瘦身到 60 块 / 5 次迭代，`historyCloneCost`、`openPathBreakdown`、`tableChessboard` 各加显式超时）。其中 `tableChessboard > is exported from the package entrypoint` 是**既有 flake**（单独跑也卡 5023–5026ms），与本变更无关。
  - 已知失败已单列：`test:spec` 聚合命令额外包含 `test/spec/roundTrip.spec.ts` 的 3 例（Links、Lists、GFM/Tables），CI 只跑 commonmark 与 gfm 两条命令（见 `.github/workflows/ci.yml` 注释），故不计入本门槛；需修正序列化规范化时应单独立项。
  - 本项按此边界勾选：“无回归”由 1495 个单测 + 1344 个规范用例支持，而非由一条含已知失败的命令 `test:spec` 支持。详见 `PERFORMANCE.md` 6.2 节。
- [ ] 6.3 运行端到端启动、打开、切换、保存和恢复场景，并验证三个痛点阶段指标均相对基线改善
  - 环境阻塞（已核实，同 1.4）：e2e 需要 `_electron.launch`，本机 `ced` 原生绑定缺失导致应用在 renderer 执行前退出。
- [ ] 6.4 在冷启动、多恢复 tab、大文档和多文档切换场景下记录内存峰值、缓存命中率和主线程长任务
  - 环境阻塞（同上）。
- [x] 6.5 更新性能文档，记录新指标定义、基准命令、优化前后结果和已知限制
- [x] 6.6 提供分阶段回滚开关或回滚步骤，并验证恢复同步路径可独立关闭而不影响观测能力
  - `@shared/performanceRollback` 定义 5 个可独立关闭的切片（`restore-layering` / `tab-state-cache` / `deferred-history` / `deferred-toc` / `deferred-content-commit`），两个进程读同一个 `MARKTEXT_PERF_ROLLBACK`（逗号分隔、大小写不敏感、未知名称忽略而不是启动失败）。
  - 契约由测试锁定：`performance-rollback.spec.ts` 断言默认全开、只回滚指定切片、解析容错，且回滚后 milestone 仍照常上报（“回滚不关闭观测”）；`derived-state-convergence.spec.ts` 额外断言 TOC 校验在回滚分支下不被绕过。
  - 各切片的回滚语义：关闭 `restore-layering` 恢复“先 refresh 全部 tab 再发 state”；关闭 `tab-state-cache` 每次切换重新解析；关闭 `deferred-history` 同步恢复历史栈；关闭 `deferred-toc` 内联执行 TOC；关闭 `deferred-content-commit` 每次 `json-change` 同步提交。
  - 本机可验证的部分已全部通过（桌面单测 121 文件 / 1118 通过；typecheck 通过）；“真实恢复路径在关闭后行为不变”的端到端确认与 6.3/6.4 同因环境阻塞。
