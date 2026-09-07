# MarkText architecture

This document describes the current repository architecture. The desktop editor
and the documentation website are separate applications that share the repository
but not a runtime process; the website is intentionally excluded from the root
pnpm workspace and maintains its own dependency/deployment toolchain.

## Workspace map

| Package / area                          | Responsibility                                                                                                | Depends on                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `packages/desktop` (`marktext`)         | Electron desktop application, Vue UI, Pinia state, native integration and packaging                           | `@muyajs/core`, Electron and desktop dependencies |
| `packages/muya` (`@muyajs/core`)        | TypeScript markdown editor engine: parsing, block state, selection, rendering, history, UI plugins and export | Browser/runtime libraries only; no Electron API   |
| `packages/muyajs` (`@marktext/muyajs`)  | Legacy JavaScript engine retained as an isolated compatibility/archive package                                | Legacy editor dependencies; not used by desktop   |
| `packages/website` (`marktext-website`) | Next.js documentation and product website                                                                     | Its own React/Markdown/Cloudflare toolchain       |
| `docs/`, `scripts/`, `.github/`         | Repository documentation, license/locale/install automation and CI                                            | Workspace packages through explicit scripts       |

`packages/muya/examples` and `packages/muya/e2e` are nested workspace packages
for the engine demo and real-browser tests. They depend on `@muyajs/core` via
`workspace:*` and are not part of the Electron runtime.

## Desktop process boundaries

```mermaid
flowchart LR
  Main[Main process<br/>packages/desktop/src/main] -->|IPC handlers/events| Preload[Preload<br/>contextBridge adapter]
  Preload --> Renderer[Renderer<br/>Vue + Pinia]
  Renderer -->|workspace dependency| Core[@muyajs/core<br/>packages/muya]
  Main -.-> Shared[src/shared/types]
  Preload -.-> Shared
  Renderer -.-> Shared
  Common[src/common] -. browser-safe helpers .-> Main
  Common -. browser-safe helpers .-> Preload
  Common -. browser-safe helpers .-> Renderer
```

### Main process

`src/main/` owns application startup, window lifecycle, menu and keyboard
integration, native dialogs, filesystem operations, spellchecker
integration and IPC handlers. `src/main/app/index.ts` remains a high-density
composition module; new features should be introduced through focused services
and handlers rather than adding more lifecycle branches there.

### Preload

`src/preload/index.ts` is the security adapter. It converts typed IPC
operations into a deliberately limited `contextBridge` surface. Renderer code
must use this surface rather than importing Electron, Node built-ins or native
modules. The window configuration in `src/main/config.ts` currently enforces
`contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.

### Renderer

The renderer contains five cooperating concerns:

1. **Application composition**: `pages/app.vue` mounts the window-level UI and
   wires the Pinia stores.
2. **State**: `store/` owns tabs/documents, project tree, preferences, layout,
   commands and notifications.
3. **Editor host**: `components/editorWithTabs/editor.vue` adapts the core
   engine to MarkText workflows; `sourceCode.vue` hosts CodeMirror source mode.
4. **Platform services**: `renderer/platform/` is the only renderer-owned
   boundary that dereferences preload globals. It provides typed access to
   filesystem, path, window, runtime/document-directory, search, upload and
   other native capabilities.
5. **UI components**: `components/`, `prefComponents/`, commands and context
   menus provide the product surface.

The facade modules are deliberately capability-oriented:

- `electron.ts`: typed accessors for IPC, clipboard, shell, web frame, fonts,
  process metadata, boot paths and window controls.
- `filesystem.ts`, `path.ts`, `ripgrep.ts` and `uploader.ts`: filesystem/path,
  search and image-upload capabilities.
- `runtime.ts` and `window.ts`: boot metadata, window identity/open-file
  operations, and the document-directory bridge.

`runtime.ts` is also the document-directory facade: `getDocumentDirectory()`
and `setDocumentDirectory()` keep Muya's relative-resource base inside the
platform boundary instead of exposing direct `window.DIRNAME` access to feature
modules. Bootstrap writes the typed `marktext` runtime through the same facade.

The direct preload-global access has been moved behind `renderer/platform/`
facades. The remaining coupling hotspot is orchestration density in the large
editor store and editor host. The next improvement is to extract domain services
behind stable interfaces without changing the component/store public behavior.

## `@muyajs/core` internal layers

The public entrypoint is `packages/muya/src/index.ts`. It exports the `Muya`
runtime plus state conversion/export utilities and UI plugin constructors.
Internally the engine is organized as:

- `block/`: block tree, CommonMark/GFM/extra block types and content models.
- `state/`: Markdown to structured state conversion, HTML conversion, TOC and
  serialization.
- `inlineRenderer/`: inline lexer/rules and snabbdom-based HTML/DOM rendering.
- `editor/`: keyboard/editing behavior, drag-drop and link events.
- `selection/`: text, image, table and offset/cursor mapping.
- `history/`: operational history and undo/redo.
- `clipboard/`: copy/cut/paste and image handling.
- `ui/`: floating tool/menu plugins registered through `Muya.use(...)`.
- `search/`, `i18n/`, `utils/`, `config/`, `event/`: cross-cutting engine services.

The graph identifies `Muya`, `Parent`, `Content`, `Format`, `TState` and
`ScrollPage` as the most connected abstractions. They are valuable extension
points but also carry the highest change risk. Keep the public API stable and
use the existing CommonMark/GFM, serialization and browser E2E suites as the
refactoring safety net.

## Current architectural findings

- **Positive**: no import cycle was detected in the current graph; the Electron
  security boundary is explicit; editor engine and application are separate
  workspace packages.
- **High risk**: `renderer/src/store/editor.ts` (~2,071 lines),
  `components/editorWithTabs/editor.vue` (~2,141 lines) and
  `main/app/index.ts` (~906 lines) combine lifecycle, persistence, workflow,
  rendering and platform concerns.
- **High coupling**: renderer platform access is now centralized, but the editor
  store and editor host still combine persistence, lifecycle, rendering and
  workflow orchestration.
- **Contract drift**: `shared/types/ipc.ts` still contains several `unknown`
  payloads for legacy channels. Ripgrep and uploader have now moved to shared
  domain contracts with main-process runtime validation.
- **Migration residue removed**: the desktop manifest, Vite/Vitest aliases and
  ambient legacy declarations no longer point at `packages/muyajs`. The legacy
  package remains available only as an isolated workspace package.
- **Boundary guard added**: `platform-facade.spec.ts` validates facade seams,
  `renderer-platform-boundary.spec.ts` prevents direct preload-global access from
  returning to feature modules, and `architecture-boundaries.spec.ts` guards the
  renderer, shared-types and legacy-package boundaries.

## Refactoring roadmap

### Phase 1 - boundaries and contracts (completed)

- Keep `bufferedState` as a renderer application coordinator with injected
  store providers; do not reintroduce store-to-store imports.
- Centralize preload-global and document-directory access in
  `renderer/platform/`; `runtime.ts` owns the typed boot metadata plus
  `getDocumentDirectory()`/`setDocumentDirectory()` facade for legacy
  `window.DIRNAME`, and the boundary test rejects direct capability access from
  other renderer modules.
- Replace legacy `unknown` IPC payloads with domain request/response types and
  runtime validation incrementally. Ripgrep and uploader are the reference
  migration; notification, preferences and layout remain follow-up work.

### Phase 2 - split desktop orchestration

- **Completed**: characterization tests now cover initial state, load, save,
  tab switching and close flows in `renderer/src/store/editor.ts`; use them as
  the safety net before moving side effects.
- Split the editor store into tab lifecycle, document persistence,
  engine-adapter, save/close workflow, selection/navigation and IPC
  synchronization modules without changing its component-facing API.
- Turn `components/editorWithTabs/editor.vue` into an editor host/orchestrator;
  extract editor lifecycle, event bridge, search/export and dialog orchestration
  into composables or services.
- Extract application startup, window lifecycle, menu registration, IPC
  registration and open-file workflows from `main/app/index.ts` into
  focused services while keeping startup order explicit.

### Phase 3 - core engine evolution

- Keep `src/index.ts` as the only public export hub.
- Separate `Muya` runtime orchestration from block/state/rendering services.
- Reduce responsibility density in `Parent`, `Content` and `Format`; prefer
  explicit interfaces over reaching through the live object graph.
- Make plugin registration instance-scoped where feasible and preserve
  conformance plus round-trip tests.

### Phase 4 - delivery guardrails

- Add architecture checks for forbidden desktop-to-legacy imports and renderer
  to Electron imports.
- Run desktop and Muya checks independently in CI, with website type-check/lint
  included in the repository check matrix.
- Track bundle size, startup time, save latency and renderer bridge usage while
  extracting services.

## Verification baseline

The current focused verification passes **11 test files / 43 tests**. It covers
buffered state, IPC contracts, platform facades, renderer and architecture
boundaries, editor-store characterization, keybindings, upload, main-process
listeners and i18n. Desktop type-check, Muya type-check, desktop build and
website type-check also pass for this refactoring checkpoint.

## Verification commands

```powershell
corepack pnpm --filter marktext typecheck
corepack pnpm --filter marktext exec vitest run `
  test/unit/specs/platform-facade.spec.ts `
  test/unit/specs/renderer-platform-boundary.spec.ts `
  test/unit/specs/architecture-boundaries.spec.ts `
  test/unit/specs/editor-store-characterization.spec.ts `
  test/unit/specs/ipc-contracts.spec.ts `
  test/unit/specs/buffered-state.spec.ts `
  test/unit/specs/keybinding-style.spec.ts `
  test/unit/specs/keybinding-reload.spec.ts `
  test/unit/specs/upload-image.spec.ts `
  test/unit/specs/listen-for-main.spec.ts `
  test/unit/specs/i18n.spec.ts
corepack pnpm --filter @muyajs/core lint:types
corepack pnpm --filter marktext build
corepack pnpm -C packages/website type-check
```
