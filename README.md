# BunBook

A VS Code notebook extension for running TypeScript with [Bun](https://bun.sh). Fast startup, shared state across cells, inline Plotly charts, and full TypeScript intellisense.

## [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=DavidBuezas.bunbook)

![BunBook screenshot](https://raw.githubusercontent.com/dbuezas/bunbook/main/screenshot.png)

## Features

- **Bun runtime** — cells execute via Bun with near-instant startup
- **Shared state** — variables defined in one cell are available in subsequent cells
- **Imports** — `import` from local files or `node_modules` dependencies
- **Plotly charts** — render interactive charts inline with `Plotly.newPlot()`
- **TypeScript intellisense** — autocomplete, hover info, and diagnostics across cells
- **Formatting** — auto-format cells with VS Code's format command
- **Kernel restart** — reset all state with the restart button in the toolbar
- **Standard `.ipynb` format** — notebooks are standard Jupyter files

## Requirements

- [Bun](https://bun.sh) installed and available in your PATH
- VS Code 1.85.0+

## Getting Started

1. Create a `.ipynb` file
2. Select the **TypeScript (Bun)** kernel
3. Write TypeScript in code cells
4. Run cells with `Shift+Enter` or the play button

## Output Persistence Toggle

Use the toolbar toggle to control whether cell outputs are saved to the file:

- **Outputs saved** (`foo.ipynb`) — outputs are persisted in the file. Use this when you want GitHub or nbviewer to render outputs inline.
- **Outputs not saved** (`foo.no-output.ipynb`) — outputs are never written to the file. This keeps git diffs clean since only your code is stored.

Toggling renames the file between `.ipynb` and `.no-output.ipynb`. Your unsaved edits are preserved.

## Plotly Charts

Use `Plotly.newPlot()` to render interactive charts:

```typescript
Plotly.newPlot([{ x: [1, 2, 3], y: [1, 4, 9], type: "scatter" }], {
  title: "My Chart",
});
```

The API matches [Plotly.js](https://plotly.com/javascript/) but without the first `element` parameter:

```typescript
Plotly.newPlot(data, layout?, config?)
```

## Using Dependencies

Create a `package.json` in your notebook's directory and install packages with `bun install`. Imports work as expected:

```typescript
import { mean, standardDeviation } from "simple-statistics";

const data = [1, 2, 3, 4, 5];
console.log(mean(data));
```

## Examples

- [`hello-world.ipynb`](examples/hello-world/hello-world.ipynb) — minimal notebook, no setup needed
- [`plots.ipynb`](examples/plots/plots.ipynb) — Plotly charts with shared state across cells
- [`demo.ipynb`](examples/with-dependencies/demo.ipynb) — npm dependencies, local file imports, and linear regression with Plotly

## Development

```sh
bun install
bun start
```

This builds, packages, and installs the extension locally. Reload VS Code to pick up changes.
