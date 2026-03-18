# bunbook-cli

CLI for [BunBook](https://marketplace.visualstudio.com/items?itemName=DavidBuezas.bunbook) — run, export, and convert TypeScript notebooks from the terminal or CI pipelines.

## Requirements

[Bun](https://bun.sh) installed and available in your PATH.

## Usage

No install needed — use `bunx`:

```sh
bunx bunbook-cli --help
```

```
USAGE bunbook run|export-ts|import-ts|export-html|export-md|remove-outputs

COMMANDS

        run    Execute all cells and save outputs to .ipynb
  export-ts    Convert notebook to a runnable .ts file
  import-ts    Convert a .ts file (with // %% separators) to a notebook
export-html    Export notebook to self-contained .html with interactive charts
  export-md    Export notebook to .md
remove-outputs Strip all outputs and execution counts from a notebook

Use bunbook <command> --help for more information about a command.
```

## Commands

### `run`

Execute all cells and save outputs back to the notebook file.

```sh
bunx bunbook-cli run notebook.ipynb
bunx bunbook-cli run notebook.ipynb -o result.ipynb
```

### `export-html`

Export to a self-contained HTML file with interactive Plotly charts.

```sh
bunx bunbook-cli export-html notebook.ipynb
bunx bunbook-cli export-html notebook.ipynb -o report.html
bunx bunbook-cli export-html notebook.ipynb --run          # execute first, then export
```

### `export-md`

Export to a Markdown file with fenced code blocks.

```sh
bunx bunbook-cli export-md notebook.ipynb
bunx bunbook-cli export-md notebook.ipynb -o README.md
bunx bunbook-cli export-md notebook.ipynb --run
```

### `export-ts`

Convert a notebook to a runnable `.ts` file with `// %%` cell separators.

```sh
bunx bunbook-cli export-ts notebook.ipynb
bunx bunbook-cli export-ts notebook.ipynb -o script.ts
bunx bunbook-cli export-ts notebook.ipynb --run
```

### `import-ts`

Convert a `.ts` file (with `// %%` cell separators) back to a notebook.

```sh
bunx bunbook-cli import-ts script.ts
bunx bunbook-cli import-ts script.ts -o notebook.no-output.ipynb
```

### `remove-outputs`

Strip all outputs and execution counts from a notebook. Useful before committing.

```sh
bunx bunbook-cli remove-outputs notebook.ipynb           # in-place
bunx bunbook-cli remove-outputs notebook.ipynb -o clean.ipynb
```

## Options

All commands accept:

| Flag | Short | Description |
|---|---|---|
| `--output <path>` | `-o` | Output file path (defaults vary by command) |
| `--help` | `-h` | Show help for the command |

Export commands (`export-html`, `export-md`, `export-ts`) additionally accept:

| Flag | Description |
|---|---|
| `--run` | Execute the notebook before exporting |

## CI Example

Run a notebook and publish the HTML output as a build artifact:

```yaml
- run: bunx bunbook-cli export-html report.ipynb --run -o report.html
```
