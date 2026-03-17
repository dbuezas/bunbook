# Changelog

## 0.0.12

- **`display.plotly()`** — new method for rendering interactive Plotly charts, consistent with the rest of the `display.*` API
- `Plotly.newPlot()` still works as a backwards-compatible alias
- **Full Plotly types** — replaced hand-rolled type stubs with `@types/plotly.js` for complete autocomplete coverage of all trace types, layout options, and config
- `vscode:prepublish` now runs `bun build.ts --production`, ensuring `vsce package` always produces a fresh build
- Updated all examples to use `display.plotly()`

## 0.0.11

- **`display()` API** for rich cell outputs — `display.html()`, `display.markdown()`, `display.json()`, `display.svg()`, `display.image()`, plus generic `display(data, mime)` and multi-MIME `display({ ... })` overloads
- Plotly charts now use the unified display marker protocol internally (no user-facing change)
- Intellisense support for `display.*` methods with full type declarations
- Serializer accepts `source` as a single string in addition to the standard line array format
- New `examples/display/` notebook showcasing all display types, matplotlib integration, Mermaid diagrams via CLI, and Vega-Lite charts

## 0.0.10

- Opening a legacy `.bunbook` file now shows a migration prompt to convert it to `.no-output.ipynb`, instead of opening in a broken state

## 0.0.9

- **Standard `.ipynb` format** — notebooks now use the Jupyter `.ipynb` format instead of the custom `.bunbook` format. Existing `.bunbook` files are still supported and silently migrated on save.
- **Jupyter kernel picker** — BunBook registers as "TypeScript (Bun)" in the standard Jupyter kernel picker, so any `.ipynb` file can use it.
- **Output persistence toggle** — toolbar button to switch between saving outputs to file (`foo.ipynb`) and stripping them for cleaner diffs (`foo.no-output.ipynb`). Unsaved edits are preserved across toggles.
- **Plotly renderer improvements** — custom MIME type (`application/vnd.bunbook.plotly`) stores chart data as compact single-line JSON instead of pretty-printed, significantly reducing file size. Non-VS Code viewers (GitHub, nbviewer) see a fallback message linking to the extension.
- **Intellisense across notebook types** — completions, hover, formatting, go-to-definition, and diagnostics now work in both `.no-output.ipynb` and standard `.ipynb` files.
- **Worker lifecycle** — workers are properly killed when notebooks close or when toggling output persistence. Restart button only appears when a worker is running.
- Removed custom language grammar and "Create: New BunBook Notebook" command (no longer needed with standard `.ipynb`)
- Cleaned up packaged extension: removed stale files (syntaxes, language-configuration, .github workflows)

## 0.0.8

- Prompt to install Bun when not found, with a one-click terminal install (supports macOS/Linux and Windows)
- Added GitHub Actions workflow for automated marketplace publishing on tag push
- Added `publish` script for CI to ensure the extension is built before publishing

## 0.0.7

- `.bunbook` files now store cell values as line arrays instead of single strings, producing cleaner git diffs
- Improved example notebooks with more demonstrations and better organization

## 0.0.6

- Replaced regex-based code transformations with proper AST parsing (acorn + astring), fixing edge cases with keywords inside strings, multi-line destructuring, and mixed imports like `import foo, { bar } from "mod"`
- Added go-to-definition (Cmd+Click) for functions, variables, and imports across notebook cells and into external files
- Added "BunBook Worker" output channel for debugging worker startup and runtime errors
- Worker now fails fast with an error message instead of hanging when it can't start
- Reduced vsix size by excluding examples directory and bundling acorn/astring at build time

## 0.0.5

- Fixed named imports with `as` renaming (e.g. `import { foo as bar }`)
- Fixed `import.meta` usage (dir, file, url, path) in notebook cells
- Fixed Plotly charts not rendering when called from imported .ts files
- Fixed Plotly output truncated for large datasets
- `function` and `async function` declarations now persist across cells
- `export function` and `export async function` also supported

## 0.0.4

- "Create: New BunBook Notebook" command in the command palette
- Fixed intellisense for `console`, `Bun`, and top-level `await` without needing `import 'bun'`
- Bare side-effect imports (e.g. `import 'bun'`) are now stripped in the worker
- Improved hello-world and plots examples
- Marketplace install link in README

## 0.0.3

- Bun types shipped with the extension for out-of-the-box intellisense

## 0.0.2

- One worker per notebook — switching tabs no longer kills running kernels
- TypeScript loaded from VS Code's built-in extension instead of bundled
- Fixed worker.ts missing from packaged extension
- Fixed stdout listener race condition on worker startup

## 0.0.1

- Initial release
- TypeScript notebook execution powered by Bun
- Plotly chart rendering support
- Kernel restart command
