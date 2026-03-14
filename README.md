# BunBook

A VS Code notebook extension for running TypeScript with [Bun](https://bun.sh). Fast startup, shared state across cells, inline Plotly charts, and full TypeScript intellisense.

[Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=DavidBuezas.bunbook)

![BunBook screenshot](https://raw.githubusercontent.com/dbuezas/bunbook/main/screenshot.png)

## Features

- **Bun runtime** — cells execute via Bun with near-instant startup
- **Shared state** — variables defined in one cell are available in subsequent cells
- **Imports** — `import` from local files or `node_modules` dependencies
- **Plotly charts** — render interactive charts inline with `Plotly.newPlot()`
- **TypeScript intellisense** — autocomplete, hover info, and diagnostics across cells
- **Formatting** — auto-format cells with VS Code's format command
- **Kernel restart** — reset all state with the restart button in the toolbar

## Requirements

- [Bun](https://bun.sh) installed and available in your PATH
- VS Code 1.85.0+

## Getting Started

1. Create a `.bunbook` file
2. Add code cells and write TypeScript
3. Run cells with `Shift+Enter` or the play button

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

See `samples/with-dependencies/` for a full example with linear regression and Plotly charts.

## Development

```sh
bun install
bun start
```

This builds, packages, and installs the extension locally. Reload VS Code to pick up changes.
