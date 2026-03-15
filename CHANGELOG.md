# Changelog

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
