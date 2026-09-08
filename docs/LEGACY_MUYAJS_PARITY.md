# Legacy Muyajs parity inventory

> 维护范围：`packages/muyajs`、`packages/muya` 和 `packages/desktop`。
> 本文件记录 legacy JavaScript 引擎的仓库内消费者、迁移到 `@muyajs/core` 的能力映射、验证入口和后续处置决策。
>
> **审计日期：2026-09-07**。文件名是普通 ASCII：`docs/LEGACY_MUYAJS_PARITY.md` 实际文件名为 `docs/LEGACY_MUYAJS_PARITY.md`，不包含零宽字符或其他不可见字符。

## 1. 结论摘要

- `packages/muyajs` 的包名是 `@marktext/muyajs`，当前是私有的 legacy 兼容/归档包；它没有脚本，也没有仓库内运行时消费者。
- Desktop 的唯一编辑器运行时依赖是 `@muyajs/core`，来源为 `packages/muya`。`packages/desktop/package.json` 没有 `@marktext/muyajs`，Desktop 源码和测试中也没有对 legacy 包的实际 `import`、`require` 或动态 `import()`。
- `packages/muya/examples` 和 `packages/muya/e2e` 都消费 `@muyajs/core`，不消费 `packages/muyajs`。
- Desktop 的 `tsconfig.json` 对 `../muyajs/**/*` 的引用是排除项，不是 alias 或运行时依赖；`architecture-boundaries.spec.ts` 中的 legacy 匹配器是防回归检查，也不是消费者。
- 现有 15 项迁移 parity gap 中，14 项已经关闭；PG14（source mode 退出后的单次 undo 边界）保留为明确的 `accept-defer`。PG4、PG5 的引擎路径已经关闭，但真实文件拖放和 OS bitmap clipboard 仍需要手工 QA。
- 当前决策：不为没有仓库内消费者的 legacy 包继续增加兼容 alias；保留包和 parity 记录，直到发布/外部消费者审计产生新的证据，再决定归档、独立仓库或删除。

## 2. 包和消费者清单

| 包/位置 | 身份 | 真实消费者 | 当前状态 | 维护规则 |
| --- | --- | --- | --- | --- |
| `packages/muyajs` | `@marktext/muyajs`，legacy JavaScript 编辑器，`private: true` | 无仓库内 `import`/`require`/workspace dependency | 隔离保留 | 不新增 Desktop alias；只修复经清单确认的兼容性问题 |
| `packages/muya` | `@muyajs/core`，TypeScript 编辑器核心 | `packages/desktop`、`packages/muya/examples`、`packages/muya/e2e` | 当前运行时 | 保持 `src/index.ts` 为唯一公共出口，使用包内 lint/type/spec/E2E 门禁 |
| `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue` | Desktop 编辑器宿主 | `Muya`、UI plugins、locale、`wordCount`、事件和选项 | 已迁移到 `@muyajs/core` | 所有新编辑器能力从 `@muyajs/core` 或 Desktop adapter 接入 |
| `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue` | Source mode 宿主 | `wordCount`、source/WYSIWYG 光标适配 | 已迁移到 `@muyajs/core` | 继续通过 `setCursorByOffset`/`getCursorOffset` 保持跨模式行为 |
| `packages/desktop/src/renderer/src/util/exportHtml.ts`、`markdownToHtml.ts`、`pdf.ts` | 导出和预览 adapter | `MarkdownToHtml`、`escapeHTML`、`generateGithubSlug` 等 | 已迁移/适配 | 保持导出 CSS、heading slug 和 header/footer 回归测试 |
| `packages/desktop/test/**` | Desktop 验证消费者 | `@muyajs/core` 入口、UI 配置子路径和 parity E2E | 已迁移 | 测试可以引用 legacy 路径作为 provenance，但不得导入 legacy 包 |
| `packages/muya/examples`、`packages/muya/e2e` | 新核心示例和浏览器验证 | `@muyajs/core` workspace dependency | 已迁移 | 不回退到 `packages/muyajs` |

### 2.1 实际引用审计

以下是本次审计确认的生产/测试引用面：

- Desktop 生产入口：
  - `packages/desktop/src/renderer/src/components/editorWithTabs/editor.vue`
  - `packages/desktop/src/renderer/src/components/editorWithTabs/sourceCode.vue`
  - `packages/desktop/src/renderer/src/util/exportHtml.ts`
  - `packages/desktop/src/renderer/src/util/markdownToHtml.ts`
  - `packages/desktop/src/renderer/src/util/pdf.ts`
  - `packages/desktop/src/types/muya-core.d.ts`
- Desktop 测试入口：
  - `packages/desktop/test/unit/specs/format-menu-state.spec.ts`
  - `packages/desktop/test/e2e/**` 中依赖编辑器行为的测试
  - `packages/desktop/test/PARITY_SCOREBOARD.md` 和 `packages/desktop/test/PARITY_QA.md`
- 配置边界：
  - `packages/desktop/package.json` 仅声明 `"@muyajs/core": "workspace:*"`
  - `packages/desktop/tsconfig.base.json` 将 `@muyajs/core` 指向 Desktop 的受控类型面
  - `packages/desktop/tsconfig.json` 的 `../muyajs/**/*` 位于 `exclude`，不是 alias
  - `packages/desktop/test/unit/specs/architecture-boundaries.spec.ts` 主动拒绝 legacy import、`muya/` alias 和 `packages/muyajs` alias

下列引用不是消费者，不能据此恢复 legacy 依赖：

- `packages/muya/src/**/__tests__` 中对 `packages/muyajs` 的注释和 parity provenance；
- `packages/desktop/test/e2e/issue-*.spec.ts` 中指出历史 bug 来源的注释；
- `packages/muya/src/assets/styles` 和 Desktop theme 中说明迁移背景的注释；
- `packages/muyajs/package.json` 自身的 package name/repository metadata。

## 3. 能力 parity 矩阵

状态含义：

- **已迁移**：当前 Desktop 通过 `@muyajs/core` 使用，且有自动化验证。
- **已迁移/适配**：核心能力已迁移，但 Desktop 仍需要 adapter、类型声明或手工验证。
- **接受延期**：行为差异已知、已记录，当前不再作为迁移阻塞项。
- **非消费者**：legacy API 在当前仓库没有使用者，不为它维持未验证的兼容层。

| Legacy 能力/入口 | `@muyajs/core` 对应能力 | 当前消费者 | 迁移状态 | 验证命令/证据 | 后续决策 |
| --- | --- | --- | --- | --- | --- |
| `new Muya(container, options)`、`Muya.use()`、生命周期 | `Muya` constructor、显式 `init()`、`Muya.use()`、`destroy()` | `editor.vue` | 已迁移 | `corepack pnpm --filter marktext typecheck`；`corepack pnpm -C packages/muya test` | 新能力只进入 `@muyajs/core`，不恢复旧 alias |
| `setMarkdown`、`getMarkdown`、TOC 和状态树 | `setContent`、`replaceContent`、`getMarkdown`、`getTOC`、`getState` | `editor.vue`、Editor Store、导出 adapter | 已迁移/适配 | `corepack pnpm --filter marktext test:unit`；Desktop editor E2E | 保持 document persistence 由 Desktop workflow 管理，核心只负责编辑器状态 |
| history：`getHistory`、`setHistory`、`clearHistory`、`undo`、`redo` | 同名 history API；Desktop 另有 synthetic history 保存 clean baseline | `editor.vue`、save/close workflow | 已迁移/适配 | `corepack pnpm -C packages/muya test`；`parity-source-undo-saved.spec.ts` | PG14 继续 accept-defer；不要在没有 state-replacement API 前实现通用 JSON diff |
| cursor/selection：`getCursor`、`setCursor`、`getSelection` | `getSelection`、`setCursor`、`setCursorByOffset`、`getCursorOffset` | `editor.vue`、`sourceCode.vue`、selection menu | 已迁移/适配 | `corepack pnpm -C packages/muya exec vitest run src/__tests__/setCursorByOffset.spec.ts`；Desktop parity E2E | 维持 source mode 的 index-cursor adapter，避免暴露 legacy block-key 结构 |
| block/format：`format`、`updateParagraph`、`insertParagraph`、`deleteParagraph`、`duplicate`、`createTable` | 同名 facade 方法及 TypeScript block tree | `editor.vue`、menu/command workflow | 已迁移 | `corepack pnpm -C packages/muya test`；`parityInsertParagraphNested.spec.ts` | 先保持 facade 稳定，再按 P15 拆 runtime 内部模块 |
| options：font、line height、tab、list、focus、front matter、spellcheck、diagram、HTML、GitLab、`autoCheck`、`hideLinkPopup` | `IMuyaOptions`、`setOptions`、`setFocusMode`、`setListIndentation` | `editor.vue` preference watchers | 已迁移 | `corepack pnpm --filter marktext test:unit`；PG3/PG12 parity specs | 新选项必须加入 `IMuyaOptions` 和 Desktop adapter，不复制旧默认值实现 |
| locale 和编辑器事件 | `locale()`、`on/off/once()`、`EventCenter`；事件名以 kebab-case 为准 | `editor.vue`、menu state、preview、format handlers | 已迁移/适配 | `corepack pnpm -C packages/muya test`；PG1/PG10/PG11 specs | 新事件先在 core 建立测试，再由 Desktop 订阅；不新增 camelCase legacy event |
| `search`、`find`、`replace` | 同名 API | `editor.vue`、Editor Store search workflow | 已迁移 | `corepack pnpm --filter marktext test:unit`；Desktop find/replace E2E | 继续由 Desktop 负责结果展示和 IPC，不把 Pinia 状态放进 core |
| clipboard：`copyAsRich`、`copyAsHtml`、`pasteAsPlainText`、`pasteImage` | 同名 facade API，加 `clipboardFilePath`、`clipboardText`、`imageAction` hooks | `editor.vue`、preload clipboard adapter | 已迁移/适配 | `corepack pnpm -C packages/muya test`；PG5/PG6/PG9 | 保持 OS clipboard 通过 preload/adapter，core 不直接访问 Node/Electron |
| 图片插入和拖放 | `insertImage`、`imageAction`、`getPathForFile`、drag-drop handler | `editor.vue`、Electron `webUtils` adapter | 已迁移/适配 | `corepack pnpm -C packages/muya test`；`packages/desktop/test/PARITY_QA.md` PG4/PG5 | 自动化覆盖 engine；真实文件拖放和 OS bitmap 保留手工 QA |
| HTML/Markdown export：`exportStyledHTML`、`exportHtml` | `MarkdownToHtml`、`renderToStaticHTML`、`getTOC`；Desktop `exportHtml.ts`/`pdf.ts` adapter | Desktop export、print、PDF、website-facing docs | 已迁移/适配 | `corepack pnpm -C packages/muya test:spec:commonmark`；`test:spec:gfm`；PG7/PG8 | 继续维护离线 CSS、heading id 和 header/footer 回归，禁止 CDN-only fallback |
| UI plugins、toolbar、table、emoji、footnote、image tools | `@muyajs/core` `src/ui/**` exports 和 `Muya.use()` | `editor.vue` | 已迁移 | `corepack pnpm --filter marktext build`；Desktop unit/E2E | plugin 注册仍由宿主负责；Electron 依赖不得进入 `packages/muya` |
| legacy `extractImages`、`copy(info)` 等未被 Desktop 使用的细粒度 API | 没有当前 Desktop contract；使用者若出现，需先定义 adapter | 无仓库内消费者 | 非消费者 | `rg` import/require 审计无结果；architecture boundary test | 不主动补兼容 API；若出现外部消费者，先补 issue、consumer fixture 和迁移设计 |

## 4. 已知 parity gap scoreboard

详细测试位置和 gap provenance 继续以 [`packages/desktop/test/PARITY_SCOREBOARD.md`](../packages/desktop/test/PARITY_SCOREBOARD.md) 为准。本节只保留维护所需的状态摘要：

| Gap | Legacy 行为 | 当前 Muya 能力/适配 | 状态 | 验证入口 | 后续决策 |
| --- | --- | --- | --- | --- | --- |
| PG1 | `selectionChange` 带 affiliation/ancestor 信息 | `selection-change` payload + Desktop menu-state adapter | 已关闭 | `paritySelectionChange.spec.ts`、`parity-pg1-menu-state.spec.ts` | 保持 payload contract |
| PG2 | source mode 返回 WYSIWYG 后恢复 index cursor | `setCursorByOffset` / `getCursorOffset` | 已关闭 | `setCursorByOffset.spec.ts`、`parity-source-undo-saved.spec.ts` | 继续覆盖跨模式 cursor round-trip |
| PG3 | `autoCheck` 级联 task list | `IMuyaOptions.autoCheck` | 已关闭 | `parityAutoCheck.spec.ts` | 新 option 必须有 true/false control case |
| PG4 | 本地文件/URL 拖放插图 | `imageAction` + `getPathForFile` + drag-drop handler | 引擎已关闭；Desktop 手工 QA | `dragDropImage.spec.ts`、`PARITY_QA.md` PG4 | 每次 Electron/webUtils 变更复跑手工 QA |
| PG5 | bitmap/screenshot clipboard 插图 | clipboard files → data URL → `imageAction` | 引擎已关闭；OS 手工 QA | `parityImagePaste.spec.ts`、`PARITY_QA.md` PG5 | 保留真实 OS clipboard 检查，不在 core 读取 Node clipboard |
| PG6 | clipboard image FILE 必须经过 `imageAction` | `imageAction` on file/bitmap paths | 已关闭 | `parityImagePaste.spec.ts` | 保持 copy-to-assets/upload preference contract |
| PG7 | 离线导出必须内联 core CSS | `MarkdownToHtml.generate({ inlineStyles: true })`/export adapter | 已关闭 | `parityExportHtml.spec.ts` | 禁止重新引入 CDN-only export |
| PG8 | heading 需要稳定 id/TOC anchor | `getTOC`、`generateGithubSlug`、Desktop PDF slugger | 已关闭 | `parityExportHtml.spec.ts`、PDF/export tests | slug 规则变化必须更新 export fixtures |
| PG9 | Copy as Rich Text 不能退化成源码 HTML | `copyAsRich` + Desktop clipboard mapping | 已关闭 | `parityCopyAsRich.spec.ts`、Desktop clipboard tests | 保持 rich-text MIME/payload mapping |
| PG10 | 选中图片后 Space 打开 preview | `preview-image` event | 已关闭 | `parityPreviewImage.spec.ts`、editor preview subscription | 新事件必须有 keyboard path regression |
| PG11 | heading hover copy anchor | `heading-copy-link` event | 已关闭 | `parityHeadingCopyLink.spec.ts`、editor subscription | 保持 key/slug mapping |
| PG12 | `hideLinkPopup` preference | `IMuyaOptions.hideLinkPopup` | 已关闭 | `parityHideLinkPopup.spec.ts` | option 行为要有 enabled/disabled control |
| PG13 | nested insert paragraph 使用 immediate block | `insertParagraph(..., outMost)` 的新实现 | 已关闭 | `parityInsertParagraphNested.spec.ts` | 继续保护 nested block selection |
| PG14 | source mode handoff 后第一次 undo 应是一个步骤 | 当前仍由 history restore/synthetic history 组合处理 | 接受延期，`test.fail()` | `parity-source-undo-saved.spec.ts` | 只有新增安全的 state-replacement API 后再评估；不实现脆弱的通用 JSON diff |
| PG15 | undo 回到磁盘内容后恢复 clean indicator | Desktop synthetic history + saved-id baseline | 已关闭 | `parity-source-undo-saved.spec.ts`、editor store unit tests | 继续保证 baseline 在首次编辑前建立 |

## 5. 验证矩阵

### 5.1 依赖和边界审计

```powershell
# 真实命令入口必须是 PowerShell 7；pnpm 通过 Corepack 启动
corepack pnpm --filter marktext typecheck
corepack pnpm --filter marktext test:unit

# 应确认没有 legacy package 的 import/require/动态 import
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' --glob '!graphify-out/**' `
  -e '@marktext/muyajs' -e 'packages/muyajs' -e '../muyajs' `
  packages/muyajs packages/muya packages/desktop
```

审计结果的判定方式：

- `@marktext/muyajs` 的真实 `import`/`require` 结果应为空；
- `packages/muyajs` 出现在 parity 注释、文档、边界测试和 `tsconfig` 排除项中是允许的；
- Desktop 的 `package.json` 必须继续只声明 `@muyajs/core`；
- `architecture-boundaries.spec.ts` 必须继续拒绝 legacy alias。

### 5.2 Core parity 和 conformance

```powershell
corepack pnpm -C packages/muya test
corepack pnpm -C packages/muya test:spec:commonmark
corepack pnpm -C packages/muya test:spec:gfm

# 针对单个 gap 的快速回归示例
corepack pnpm -C packages/muya exec vitest run src/state/__tests__/parityExportHtml.spec.ts
corepack pnpm -C packages/muya exec vitest run src/selection/__tests__/paritySelectionChange.spec.ts
```

### 5.3 Desktop parity E2E

```powershell
# parity E2E 依赖可运行的 unpack build
corepack pnpm --filter marktext build:unpack
corepack pnpm -C packages/desktop exec playwright test `
  test/e2e/parity-pg1-menu-state.spec.ts `
  test/e2e/parity-source-undo-saved.spec.ts `
  --config test/e2e/playwright.config.ts
```

PG14 预期继续以 `test.fail()` 记录；PG4、PG5 的真实文件拖放/OS bitmap clipboard 还要执行 [`PARITY_QA.md`](../packages/desktop/test/PARITY_QA.md) 中的手工步骤。

### 5.4 包级静态门禁

```powershell
corepack pnpm -C packages/muya lint:types
corepack pnpm -C packages/muya lint
corepack pnpm -C packages/muya check-circular
corepack pnpm -C packages/muya/e2e e2e
```

如果某条命令因本机平台、浏览器或历史基线失败，应在本文件的审计记录中写明具体命令、日期、失败原因和是否影响 parity 状态；不要直接把 legacy 包重新接回运行时作为“修复”。

## 6. 后续决策规则

1. **禁止回退**：任何新 Desktop 代码不得导入 `@marktext/muyajs`、`muya/` legacy alias 或 `packages/muyajs` 路径。
2. **新增消费者先登记**：如果发现真实 legacy import，先在本文件“包和消费者清单”增加消费者、owner、迁移目标和验证命令，再改代码。
3. **新增 parity gap 先测试**：先在 `packages/muya` 或 Desktop parity suite 添加 failing characterization test，再实现迁移，不以注释或手工观察直接宣称 parity。
4. **legacy 包保持隔离**：没有真实消费者时不扩展 legacy API、不同步新功能、不为它增加独立构建链。
5. **归档/独立仓库/删除门槛**：只有在确认没有外部发布消费者、历史发行物不再需要回溯、且 parity scoreboard 没有未决运行时依赖后，才可选择归档、独立仓库或删除；该决策需要单独记录日期、证据和迁移窗口。
6. **PG14 单独决策**：除非 `@muyajs/core` 提供安全的“整个 state replacement 作为单个 history op”能力，否则保持 accept-defer，不用通用 JSON diff 模拟。
7. **人工 QA 可追踪**：PG4/PG5 的手工检查每次 Electron clipboard、`webUtils.getPathForFile`、imageAction 或资源持久化路径变更时重跑。

## 7. 更新记录

| 日期 | 变更 | 证据 |
| --- | --- | --- |
| 2026-09-07 | 首次建立仓库内 legacy consumer 审计和 parity inventory；确认 Desktop runtime 没有 `@marktext/muyajs` 消费者；记录 15 项 gap（14 closed，PG14 accept-defer） | `packages/desktop/package.json`、Desktop import audit、`PARITY_SCOREBOARD.md`、`PARITY_QA.md` |

维护本文件时，先更新第 2 节消费者审计，再更新第 3/4 节能力和 gap 状态，最后运行第 5 节中与变更相关的命令。详细测试不要复制到这里；测试位置和每个 gap 的机制以 parity scoreboard 为准。
