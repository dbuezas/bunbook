# Changelog

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
