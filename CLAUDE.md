# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# MarkText

## Project Overview

MarkText is a WYSIWYG markdown editor built on Electron + Vue 3. It supports CommonMark, GitHub Flavored Markdown, math (KaTeX), Mermaid diagrams, PlantUML, and multiple editing modes (focus, typewriter, source-code).

- **Version**: see `package.json`
- **License**: MIT
- **Repository**: https://github.com/marktext/marktext

## Tech Stack

| Layer              | Technology                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Language           | TypeScript 5.9 (strict mode) for desktop; `packages/muya` has its own TypeScript toolchain; legacy `packages/muyajs` remains isolated JavaScript |
| Desktop shell      | Electron 42                                                                                                                                      |
| Build system       | electron-vite 5                                                                                                                                  |
| Packaging          | electron-builder 26                                                                                                                              |
| Frontend framework | Vue 3                                                                                                                                            |
| State management   | Pinia 3                                                                                                                                          |
| Routing            | Vue Router 4                                                                                                                                     |
| UI library         | Element Plus                                                                                                                                     |
| Unit tests         | Vitest 4                                                                                                                                         |
| E2E tests          | Playwright                                                                                                                                       |
| Package manager    | pnpm >=10 workspace (`packageManager: pnpm@10.33.4`)                                                                                             |
| Repo layout        | pnpm monorepo — see Directory Structure                                                                                                          |
| Node.js minimum    | >=20.19.0 (PR CI: Node 22.21.1 · release CI: Node 24.14.1)                                                                                       |

## Directory Structure

This repository contains four top-level package directories under `packages/`.
The root pnpm workspace intentionally installs desktop, Muya and legacy Muya; the
independent website package is kept outside the workspace for its separate deploy
toolchain. The root also holds shared tooling, documentation and CI-facing scripts.

```
<repo-root>/
  package.json              Workspace orchestrator. Root scripts proxy desktop
                            commands through `pnpm --filter marktext ...`.
  pnpm-workspace.yaml       `packages/*` plus nested Muya examples/e2e workspaces.
  pnpm-lock.yaml            Single lockfile shared by all workspace packages.
  eslint.config.js          Root ESLint flat config for root/desktop/legacy code;
                            `packages/muya` and `packages/website` self-lint.
  scripts/                  Install, locale, license and dependency automation.
  docs/                     Long-form developer docs and architecture review.
  packages/
    desktop/                Electron desktop application (`marktext`).
      package.json          Electron/Vue dependencies and desktop scripts;
                            depends on `@muyajs/core` via `workspace:*`.
      src/main/             Electron lifecycle, windows, menus, filesystem and IPC handlers.
      src/preload/          Sandboxed contextBridge adapter.
      src/renderer/         Vue 3 UI, Pinia stores, Muya/CodeMirror hosts and services.
      src/shared/            Serializable cross-process types and IPC contracts.
      src/common/           Small helpers shared only when browser-safe for renderer use.
      test/                  Vitest unit tests and Playwright desktop E2E tests.
      build/ static/        Packaged resources, themes, icons and locales.
    muya/                   TypeScript editor engine (`@muyajs/core`).
      src/                  Public API plus block/state/editor/renderer/selection/history/UI.
      test/spec/             CommonMark and GFM conformance suites.
      examples/              Nested workspace with a Vite demo.
      e2e/                   Nested workspace with browser-level engine tests.
    muyajs/                 Legacy JavaScript engine (`@marktext/muyajs`).
                            Kept as an isolated compatibility/archive package; the
                            desktop runtime no longer depends on it.
    website/                Next.js + React 19 product and documentation website.
      src/app/               App Router pages, metadata and sitemap routes.
      src/components/        Product and documentation UI components.
      src/lib/               Markdown, docs navigation, search and link helpers.
      content/docs/          Markdown source for published documentation.
      scripts/               Documentation index generation before dev/build.
```

The root has no `src/`, `test/`, `static/`, or `build/` of its own anymore - they all live in `packages/desktop/`.

## Development Workflow

All commands run from the repo root. The root `package.json` proxies every
desktop-specific script to `packages/desktop` via `pnpm --filter marktext`,
so the names and behavior are unchanged from the pre-monorepo layout.

```bash
# Install dependencies (runs scripts/postinstall.ts automatically — patches
# native-keymap, downloads Electron, rebuilds native modules, minifies locales)
pnpm install

# Run in development mode
# Renderer hot-reloads automatically. Pressing Ctrl+R in the dev window reloads
# the renderer (which re-runs the preload script); changes to the main process
# require restarting `pnpm run dev`.
pnpm run dev

# Preview the last electron-vite build (no rebuild). PERF_TESTING=true is set automatically.
pnpm run start

# Build without packaging — fast path for verifying the renderer/main compile
pnpm run build:unpack

# Auto-format the repo with Prettier (separate from `lint`, which only checks)
pnpm run format

# Minify locale files (required for production builds, skip during dev)
pnpm run minify-locales

# Performance debugging — exposes a Node inspector on :5858 against the previewed build
pnpm run perf:inspect       # attach when ready
pnpm run perf:inspect-brk   # break on first line

# Website
pnpm -C packages/website dev      # Next.js development server
pnpm -C packages/website build    # Next.js production build
```

If you need to invoke a script directly inside a package, use
`pnpm --filter <name> <script>` or `pnpm -C packages/<name> <script>`.

## Build Commands

```bash
pnpm run build:win    # Windows x64 — NSIS installer + zip
pnpm run build:mac    # macOS x64 + arm64 — DMG + zip
pnpm run build:linux  # Linux — AppImage, snap, deb, rpm, tar.gz
```

All platform build scripts automatically run `minify-locales` and `electron-rebuild` before packaging.

## Testing

```bash
pnpm run test          # All unit tests (Vitest)
pnpm run test:unit     # Unit tests only
pnpm run test:e2e      # End-to-end tests (Playwright)
pnpm run lint          # ESLint (run before committing; CI enforces)
pnpm run typecheck     # vue-tsc --noEmit (CI enforces)

# Run a single spec — paths are relative to packages/desktop. Use `-C` so
# pnpm resolves the spec path inside the desktop package's vitest config.
pnpm -C packages/desktop exec vitest run test/unit/specs/markdown-basic.spec.ts
pnpm -C packages/desktop exec vitest run -t 'partial test name'

# Single Playwright spec (playwright.config.ts lives in test/e2e/)
pnpm -C packages/desktop exec playwright test test/e2e/launch.spec.ts
pnpm -C packages/desktop exec playwright test -g 'partial test name'
```

## Code Style

Enforced by ESLint + Prettier. Run `pnpm run lint` and `pnpm run typecheck` before committing.

- 2-space indentation
- No semicolons
- Single quotes
- TypeScript with `strict: true`; see `packages/website/content/docs/dev/TYPESCRIPT.md`
- Cross-process types live in `packages/desktop/src/shared/types/`; ambient declarations in `packages/desktop/src/types/`
- IPC channels are typed via the contract in `packages/desktop/src/shared/types/ipc.ts`
- The renderer is fully sandboxed — every IPC and Node access goes through `window.electron.*` / `window.fileUtils.*` etc. (typed in `packages/desktop/src/types/global.d.ts`)

### Comments

Follow `.github/COMMENTING-GUIDELINES.md` for every comment you write. The core rule: a comment must describe what isn't obvious from the code — rationale, units, invariants, ownership, the abstraction a caller needs — never restate the code or echo the words already in the name. Before finishing any change, review the comments you added or touched against that document, and delete any that only repeat the code. Prefer self-explanatory names over comments; when a comment is genuinely needed, keep it short and complete and place it next to the code it describes.

## Architecture: Three-Process Electron Model

The desktop application is a layered Electron system. The renderer hosts the
product UI and editor engines; the main process owns OS capabilities; preload
is the only bridge between them; and `shared/` contains cross-process contracts.

```
main       packages/desktop/src/main/
  - Electron lifecycle, windows, menus, native dialogs, filesystem and IPC handlers
  - owns OS/native dependencies and sends domain events to renderer windows

preload    packages/desktop/src/preload/index.ts
  - runs with contextIsolation + sandbox enabled
  - exposes narrow contextBridge APIs (`window.electron`, `window.fileUtils`, ...)
  - adapts IPC calls to contracts in `src/shared/types/`

renderer   packages/desktop/src/renderer/
  - Vue 3 + Pinia application, one instance per editor window
  - owns tabs, documents, preferences, layout, project tree and editor workflows
  - hosts `@muyajs/core` for WYSIWYG mode and CodeMirror for source mode
  - must not import Electron/Node capabilities directly

shared     packages/desktop/src/shared/
  - serializable IPC/channel and domain types shared by main, preload and renderer

common     packages/desktop/src/common/
  - small cross-layer helpers; renderer imports must remain browser-safe

editor     packages/muya/ (`@muyajs/core`)
  - framework-independent TypeScript editor engine with no Electron responsibility

legacy     packages/muyajs/ (`@marktext/muyajs`)
  - isolated legacy JavaScript compatibility/archive package; not a desktop runtime dependency
```

`packages/desktop/src/main/config.ts` is the source of truth for editor window
security settings: `contextIsolation: true`, `sandbox: true`, and
`nodeIntegration: false`. Treat changes to this boundary as security-sensitive.

## IPC Conventions

Most IPC channels between main and renderer use the `mt::` prefix (e.g. `mt::open-new-tab`, `mt::file-saved`). Some internal channels do not follow this convention (e.g. `language-changed`).

See `packages/website/content/docs/dev/IPC.md` for conventions and examples.

## Further Reading

`packages/website/content/docs/dev/` contains the deeper developer documentation referenced by this guide. Same files are published as the developer docs section on https://marktext.me/docs/dev/overview:

- `ARCHITECTURE.md` — process/module layering beyond the summary above
- `BUILD.md` — full platform build prerequisites (including the Arch Linux deps added recently)
- `DEBUGGING.md` — attaching debuggers to main/renderer processes
- `INTERFACE.md` — Muya and renderer public interfaces
- `IPC.md` — full IPC channel catalog and `mt::` conventions
- `LINUX_DEV.md` — Linux-specific dev environment setup
- `PERFORMANCE.md` — perf measurement workflow (pairs with `pnpm run perf:inspect`)
- `RELEASE.md` / `RELEASE_HOTFIX.md` — release process

## Important Build Notes

- **CommonJS vs ESM**: `main` and `preload` compile to CommonJS; `renderer` is ESM-only. Do not use `require()` in renderer code.
- **Minify locales**: `pnpm run minify-locales` must run before production builds. It is included in `build:win/mac/linux` but not in `dev`.
- **Native modules**: After changing Electron version, run `pnpm run rebuild-native` (`electron-rebuild -f`).
- **Hot reload**: The renderer hot-reloads via Vite HMR. `Ctrl+R` in the dev window reloads the renderer and re-runs the preload script. Changes to `main/` source are NOT picked up by a window reload — restart `pnpm run dev` to pick them up.
- **electron-builder output**: `directories.output` in `packages/desktop/electron-builder.yml` is set to `../../dist` so installers land in the repo-root `dist/` (where CI artifact globs look for them). `out/` from electron-vite stays inside `packages/desktop/`.
- **Path aliases** (defined in `packages/desktop/electron.vite.config.ts`, mirrored in `vitest.config.ts` and `tsconfig.base.json`):
  - `@` → `packages/desktop/src/renderer/src`
  - `common` → `packages/desktop/src/common`
  - `@shared` → `packages/desktop/src/shared`
  - renderer `path` → `pathe` for sandbox-safe path operations
- **Workspace deps**: `packages/desktop` consumes `@muyajs/core` from `packages/muya` via `workspace:*`. `packages/muyajs` remains independent and is not part of the desktop dependency graph.
- **Patches**: `patch-package` patches live at `packages/desktop/patches/`. The root `postinstall` calls patch-package with `cwd=packages/desktop` so the path resolves correctly.

## Contribution

- Submit PRs to the **`develop`** branch (not `main`).
- Reference the related issue in the PR description.
- Run `pnpm run lint` before submitting.
- All PRs must pass CI before merge.
- See `.github/CONTRIBUTING.md` for the full contributing guide.
