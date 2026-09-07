# MarkText Website

The MarkText website is a **Next.js App Router** application built with **React** and **TypeScript**. It combines the MarkText product site with a content-driven documentation site:

- `/` is the product landing page.
- `/docs/...` serves the user and developer documentation.
- Markdown sources live under `content/docs/` and are rendered through the App Router.

## Current implementation

- `src/app/` contains the Next.js App Router entry points, layouts, metadata routes, and documentation routes.
- `src/components/` contains the product and documentation UI.
- `src/lib/docs-nav.ts` defines the documentation navigation and maps routes to Markdown files.
- `src/lib/markdown.ts` parses and transforms documentation Markdown for the web UI.
- `scripts/build-docs-index.ts` builds `public/docs-index.json`, the search index used by the documentation command palette.
- `next.config.ts` configures the Next.js build, including standalone output.

## Requirements and workspace layout

The repository guidelines require:

- **Node.js**: `>=20.19.0`
- **pnpm**: `>=10` (the repository pins `pnpm@10.33.4`)

`packages/website` is intentionally excluded from the root pnpm workspace in `pnpm-workspace.yaml`. Treat it as an independent package: install dependencies and run its checks from the repository root with `corepack pnpm -C packages/website ...`, rather than using root workspace filters.

Install the website dependencies with:

```bash
corepack pnpm -C packages/website install --ignore-workspace --frozen-lockfile
```

## Development and validation scripts

Run these commands from the repository root:

| Script | Description |
| --- | --- |
| `dev` | Builds the documentation index if it is missing, then starts the Next.js development server on port `3000`. |
| `docs:index` | Regenerates `public/docs-index.json` from the registered documentation pages. |
| `build` | Runs the `prebuild` documentation-index step and creates a production Next.js build. |
| `start` | Starts the production Next.js server after `build` has completed. |
| `lint` | Runs ESLint with warnings treated as errors. |
| `type-check` | Runs TypeScript with `--noEmit`. |

Examples:

```bash
corepack pnpm -C packages/website dev
corepack pnpm -C packages/website docs:index
corepack pnpm -C packages/website build
corepack pnpm -C packages/website start
corepack pnpm -C packages/website lint
corepack pnpm -C packages/website type-check
```

## Documentation content

The documentation navigation is registered in `src/lib/docs-nav.ts`. Each entry points to a Markdown file under `content/docs/`, with user-facing pages and developer pages grouped into tabs. When documentation files or navigation entries change, regenerate the search index with:

```bash
corepack pnpm -C packages/website docs:index
```


## Project structure

```text
packages/website/
├── content/docs/                 # Markdown documentation sources
├── public/                       # Static assets and generated docs-index.json
├── scripts/build-docs-index.ts   # Documentation search-index generator
├── src/app/                     # Next.js App Router pages and layouts
├── src/components/              # Product and documentation components
├── src/lib/                     # Navigation, Markdown, search, and site helpers
├── next.config.ts               # Next.js configuration
├── package.json                 # Website scripts and dependencies
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

## Links

- **Main project**: [MarkText Editor](https://github.com/marktext/marktext)
- **Website**: [marktext.me](https://marktext.me)
- **Documentation**: [MarkText Docs](https://marktext.me/docs)
