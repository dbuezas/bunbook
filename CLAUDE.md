# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working Guidelines

- After changing code, run the relevant tests (`bun test`). Add new tests when the change is non-trivial.
- Keep `README.md` in sync with any user-facing changes (CLI commands, new flags, features, examples).
- Keep example notebooks (`examples/`) in sync if the change affects how notebooks are written or executed.

## Build & Dev Commands

```sh
bun install          # install dependencies
bun run compile      # one-off build
bun start            # build, package .vsix, install locally
```

Press F5 in VS Code to launch the Extension Development Host (uses `examples/with-dependencies/`).

## Architecture

BunBook is a VS Code notebook extension that runs TypeScript cells via Bun.

### Output persistence toggle

Files use two naming conventions:
- `foo.ipynb` — opened by Jupyter's editor, outputs saved to file
- `foo.no-output.ipynb` — opened by BunBook's serializer with `transientOutputs: true`, outputs never saved (cleaner git diffs)

A toolbar toggle renames the file between the two. The toggle snapshots dirty cell edits, reverts/closes the old editor, renames on disk (stripping outputs when converting to `.no-output.ipynb`), reopens with the correct editor, and restores dirty edits.

### Extension entry (`src/extension.ts`)
Registers the serializer (for `*.no-output.ipynb`), controller, intellisense, toggle commands, and notebook close cleanup (kills workers).

### Notebook serializer (`src/serializer.ts`)
Reads/writes standard ipynb format (nbformat 4.5). Registered with `transientOutputs: true` so outputs are never persisted. Always writes BunBook kernelspec metadata.

### Kernel controller (`src/controller.ts`)
Registers two controllers:
- `bunbook-no-output-controller` for the `bunbook` notebook type (`*.no-output.ipynb`)
- `bunbook-jupyter-controller` for `jupyter-notebook` (appears in Jupyter's kernel picker)

Both share the same execution logic. Manages **one persistent Bun worker process per open notebook** (keyed by notebook URI). Communication uses stdin/stdout marker protocol:

- Controller writes: `___EVAL_START___` + code + `___EVAL_END___`
- Worker responds: `___OUT_START___`...`___OUT_END___` on stdout, `___ERR_START___`...`___ERR_END___` on stderr
- Worker startup: waits for `___WORKER_READY___` before sending code

### Worker (`src/worker.ts`)
Copied as-is to `out/worker.ts` (not bundled — Bun runs TypeScript directly). Key transformations before eval:

1. `Bun.Transpiler` converts TS → JS
2. `const`/`let` → `var` for globalThis persistence across cells
3. Static `import` → dynamic `await import()` with paths resolved via `Bun.resolveSync()`
4. Code wrapped in async IIFE, then variables hoisted to `globalThis`

Plotly calls are intercepted: `display.plotly()` (and its alias `Plotly.newPlot()`) writes display markers to stdout.

### Output parser (`src/outputParser.ts`)
Splits worker stdout into text outputs and Plotly outputs. Plotly charts produce two MIME types: `application/vnd.bunbook.plotly` (compact JSON string for the VS Code renderer) and `text/html` (fallback message linking to the extension for non-VS Code viewers like nbviewer/GitHub). The custom MIME type avoids `+json` suffix so Jupyter's serializer stores it as a single-line string instead of pretty-printed JSON.

### Intellisense (`src/intellisense.ts`)
Creates a TypeScript LanguageService over a **virtual file** that concatenates all code cells. Cell offset tracking (`_cellOffsets`) maps between virtual file positions and individual cell positions. Works with both `bunbook` and `jupyter-notebook` notebook types.

TypeScript is loaded at runtime from VS Code's built-in `vscode.typescript-language-features` extension (not bundled). Falls back to `require("typescript")`.

Provides: completions, hover, formatting, go-to-definition, and diagnostics (debounced 500ms). Ambient declarations define Plotly types inline.

### Renderer (`src/renderer/index.ts`)
Browser-side ESM module for VS Code's notebook webview. Renders `application/vnd.bunbook.plotly` output items by parsing the JSON string and calling Plotly.js. Lazy-loads Plotly from CDN (temporarily removing `window.define` to avoid AMD/RequireJS conflicts). Uses ResizeObserver for responsive charts.

### Build (`build.ts`)
Uses `Bun.build()` for:
- Extension: CJS, target node, externals `vscode` + `typescript`
- Renderer: ESM, target browser
- transformCode: ESM, bundled with acorn+astring so the worker doesn't need node_modules

Worker.ts is copied verbatim (Bun runs it directly as TypeScript).
