[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://www.buymeacoffee.com/dbuezas)

# BunBook

A VS Code notebook extension for running TypeScript with [Bun](https://bun.sh). Fast startup, shared state across cells, inline Plotly charts, and full TypeScript intellisense.

Also comes with a CLI to run and export without vscode (see below).

## [Install from Marketplace](https://marketplace.visualstudio.com/items?itemName=DavidBuezas.bunbook)

![demo](https://github.com/user-attachments/assets/ff75308f-2340-4b2e-815e-e2c474829b9e)

## Features

- **Bun runtime** — cells execute via Bun with near-instant startup
- **Shared state** — variables defined in one cell are available in subsequent cells
- **Imports** — `import` from local files or `node_modules` dependencies
- **Rich outputs** — `display()` API for HTML, Markdown, JSON, SVG, images, and custom MIME types
- **Plotly charts** — render interactive charts inline with `display.plotly()`
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

## Rich Outputs with `display()`

Use `display()` to render rich content in cell outputs:

```typescript
display.html("<h1>Hello World</h1>");
display.markdown("## Bold **text**");
display.json({ name: "test", value: 42 });
display.svg(
  '<svg width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>'
);
display.image(pngBuffer); // Buffer | Uint8Array, defaults to image/png
display.image(jpegBuffer, "image/jpeg"); // explicit MIME
display.plotly([{ x: [1, 2], y: [1, 4], type: "scatter" }]); // interactive Plotly chart
display("raw string", "text/plain"); // generic: data + MIME
display({ "text/html": "<b>hi</b>", "text/plain": "hi" }); // multi-MIME
```

Combine with CLI tools for even more output types:

```typescript
// Matplotlib plot
const png = await Bun.$`python3 -c ${matplotlibScript}`.arrayBuffer();
display.image(new Uint8Array(png));

// Mermaid diagram
const svg =
  await Bun.$`bunx -p @mermaid-js/mermaid-cli mmdc -i - -o - -e svg < ${diagram}`.text();
display.svg(svg);
```

## Plotly Charts

Use `display.plotly()` to render interactive charts:

```typescript
display.plotly([{ x: [1, 2, 3], y: [1, 4, 9], type: "scatter" }], {
  title: "My Chart",
});
```

The API matches [Plotly.js](https://plotly.com/javascript/) but without the first `element` parameter:

```typescript
display.plotly(data, layout?, config?)
```

`Plotly.newPlot(data, layout?, config?)` still works as an alias.

## Using Dependencies

Create a `package.json` in your notebook's directory and install packages with `bun install`. Imports work as expected:

```typescript
import { mean, standardDeviation } from "simple-statistics";

const data = [1, 2, 3, 4, 5];
console.log(mean(data));
```

## Toolbar & Command Palette

The notebook toolbar `...` overflow menu exposes:

| Command                                    | Description                                                         |
| ------------------------------------------ | ------------------------------------------------------------------- |
| **BunBook: Enable/Disable saving outputs** | Toggle whether outputs are persisted in the file                    |
| **BunBook: Export to TypeScript File**     | Save notebook as a `.ts` file with `// %%` cell separators          |
| **BunBook: Import from TypeScript File**   | Convert a `.ts` file back to a notebook                             |
| **BunBook: Export to HTML**                | Export to a self-contained HTML file with interactive Plotly charts |
| **BunBook: Export to Markdown**            | Export to a `.md` file with fenced code blocks                      |

All of these are also available via the Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`).

## CLI

The [`bunbook-cli`](https://www.npmjs.com/package/bunbook-cli) package lets you run and convert notebooks from the terminal or CI pipelines — no install needed with `bunx`:

```sh
bunx bunbook-cli run notebook.ipynb           # execute cells, save outputs
bunx bunbook-cli export-html notebook.ipynb --run -o report.html
bunx bunbook-cli remove-outputs notebook.ipynb  # strip outputs before committing
```

See the [CLI README](cli/README.md) for full documentation.

## Examples

- [`hello-world.ipynb`](examples/hello-world/hello-world.ipynb) — minimal notebook, no setup needed
- [`plots.ipynb`](examples/plots/plots.ipynb) — Plotly charts with shared state across cells
- [`with-dependencies.ipynb`](examples/with-dependencies/with-dependencies.ipynb) — npm dependencies, local file imports, and linear regression with Plotly
- [`display.ipynb`](examples/display/display.ipynb) — rich outputs: HTML, Markdown, JSON, SVG, images, matplotlib, Mermaid, and Vega-Lite

## Development

```sh
bun install
bun start
```

This builds, packages, and installs the extension locally. Reload VS Code to pick up changes.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dbuezas/bunbook&type=Date)](https://star-history.com/#dbuezas/bunbook&Date)

