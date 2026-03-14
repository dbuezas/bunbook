# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

```sh
bun install          # install dependencies
bun run compile      # one-off build
bun run watch        # rebuild on changes
bun start            # build, package .vsix, install locally
bun run package      # create .vsix (cleans node_modules to production deps, then restores)
```

Press F5 in VS Code to launch the Extension Development Host (uses `samples/with-dependencies/`).

## Packaging

`bun run package` does: `rm -rf node_modules && bun install --production && bunx @vscode/vsce package && bun install`. This is needed because `vsce` doesn't support Bun's package manager — the clean production install ensures only `@types/bun` (and transitive `bun-types`, `@types/node`) end up in the .vsix. The `.vscodeignore` further trims `node_modules` to only `.d.ts` and `package.json` files.

## Architecture

BunBook is a VS Code notebook extension. Files with `.bunbook` extension open as notebooks with TypeScript cells executed by Bun.

### Extension entry (`src/extension.ts`)
Registers three components: serializer, controller, intellisense. Also registers the `bunbook.restartKernel` command.

### Notebook serializer (`src/serializer.ts`)
`.bunbook` files are JSON: `{ cells: [{ kind: "code"|"markdown", language?, value }] }`.

### Kernel controller (`src/controller.ts`)
Manages **one persistent Bun worker process per open notebook** (keyed by notebook URI in a `Map<string, WorkerState>`). Communication uses stdin/stdout marker protocol:

- Controller writes: `___EVAL_START___` + code + `___EVAL_END___`
- Worker responds: `___OUT_START___`...`___OUT_END___` on stdout, `___ERR_START___`...`___ERR_END___` on stderr
- Worker startup: waits for `___WORKER_READY___` before sending code

The `_tryResolve()` method buffers stdout/stderr and resolves the pending eval promise when all four markers are found.

### Worker (`src/worker.ts`)
Copied as-is to `out/worker.ts` (not bundled — Bun runs TypeScript directly). Key transformations before eval:

1. `Bun.Transpiler` converts TS → JS
2. `const`/`let` → `var` for globalThis persistence across cells
3. Static `import` → dynamic `await import()` with paths resolved via `Bun.resolveSync()`
4. Code wrapped in async IIFE, then variables hoisted to `globalThis`

Plotly calls are intercepted: `globalThis.Plotly.newPlot()` writes `___PLOTLY_OUTPUT___` + JSON + `___END_PLOTLY___` markers to stdout.

### Output parser (`src/outputParser.ts`)
Splits worker stdout into text outputs and Plotly JSON outputs (MIME type `application/vnd.plotly+json`).

### Intellisense (`src/intellisense.ts`)
Creates a TypeScript LanguageService over a **virtual file** that concatenates all code cells. Cell offset tracking (`_cellOffsets`) maps between virtual file positions and individual cell positions.

TypeScript is loaded at runtime from VS Code's built-in `vscode.typescript-language-features` extension (not bundled). Falls back to `require("typescript")`.

Provides: completions, hover, formatting, and diagnostics (debounced 500ms). Ambient declarations define Plotly types inline.

### Renderer (`src/renderer/index.ts`)
Browser-side ESM module. Lazy-loads Plotly.js from CDN. Renders `application/vnd.plotly+json` output items. Uses ResizeObserver for responsive charts.

### Build (`build.ts`)
Uses `Bun.build()` for two bundles:
- Extension: CJS, target node, externals `vscode` + `typescript`
- Renderer: ESM, target browser

Worker.ts is copied verbatim (Bun runs it directly as TypeScript).
