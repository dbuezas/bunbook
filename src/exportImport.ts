import {
  parseIpynb,
  buildIpynb,
  sourceToString,
  type IpynbNotebook,
  type IpynbCodeCell,
  type IpynbCell,
  type IpynbOutput,
} from "./ipynb";

// ── Export to TypeScript ─────────────────────────────────────────────────────

export function notebookToTypeScript(cells: IpynbCell[]): string {
  const parts: string[] = [];
  let cellIndex = 0;

  for (const cell of cells) {
    const source = sourceToString(cell.source);
    if (cell.cell_type === "markdown") {
      if (source.trim()) {
        parts.push(`// %% markdown\n/*\n${source}\n*/`);
      }
    } else {
      parts.push(`// %% cell ${++cellIndex}\n${source}`);
    }
  }

  return parts.join("\n\n") + "\n";
}

// ── Import from TypeScript ───────────────────────────────────────────────────

export function typeScriptToNotebook(content: string): IpynbNotebook {
  const SEPARATOR = /^\/\/ %%.*$/m;
  const lines = content.split("\n");

  const segments: { header: string; lines: string[] }[] = [];
  let current: { header: string; lines: string[] } = { header: "", lines: [] };

  for (const line of lines) {
    if (SEPARATOR.test(line)) {
      if (current.lines.join("").trim() || current.header) {
        segments.push(current);
      }
      current = { header: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.join("").trim() || current.header) {
    segments.push(current);
  }

  if (segments.length === 0) {
    return buildIpynb([{ kind: "code", text: content.trimEnd() }]);
  }

  const cells = segments
    .map((seg) => {
      const isMarkdown = seg.header.includes("markdown");
      const text = seg.lines.join("\n").trimEnd();
      if (isMarkdown) {
        const unwrapped = text.replace(/^\/\*\n?/, "").replace(/\n?\*\/$/, "").trim();
        return { kind: "markdown" as const, text: unwrapped };
      }
      return { kind: "code" as const, text };
    })
    .filter((c) => c.text.trim());

  return buildIpynb(cells);
}

// ── Export to HTML ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceArrayToString(source: string[] | string | undefined): string {
  if (!source) return "";
  return Array.isArray(source) ? source.join("") : source;
}

function renderOutput(output: IpynbOutput, plotIndex: { n: number }): string {
  if (output.output_type === "stream") {
    const text = sourceArrayToString(output.text as string[] | string);
    const cls = (output.name as string) === "stderr" ? "stderr" : "stdout";
    return `<pre class="output ${cls}">${escapeHtml(text)}</pre>`;
  }

  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const data = output.data as Record<string, unknown> | undefined;
    if (!data) return "";

    if (data["application/vnd.bunbook.plotly"]) {
      const id = `plot-${plotIndex.n++}`;
      const json = typeof data["application/vnd.bunbook.plotly"] === "string"
        ? data["application/vnd.bunbook.plotly"]
        : JSON.stringify(data["application/vnd.bunbook.plotly"]);
      return `<div id="${id}" class="plotly-chart"></div>\n<script>Plotly.newPlot(${JSON.stringify(id)}, ${json});</script>`;
    }

    if (data["text/html"]) {
      return `<div class="output html-output">${sourceArrayToString(data["text/html"] as string[] | string)}</div>`;
    }

    if (data["image/svg+xml"]) {
      return `<div class="output svg-output">${sourceArrayToString(data["image/svg+xml"] as string[] | string)}</div>`;
    }

    if (data["image/png"]) {
      return `<img class="output" src="data:image/png;base64,${data["image/png"]}" />`;
    }

    if (data["image/jpeg"]) {
      return `<img class="output" src="data:image/jpeg;base64,${data["image/jpeg"]}" />`;
    }

    if (data["text/markdown"]) {
      const md = sourceArrayToString(data["text/markdown"] as string[] | string);
      return `<div class="output markdown-output" data-markdown="${escapeHtml(md)}"></div>`;
    }

    if (data["text/plain"]) {
      return `<pre class="output stdout">${escapeHtml(sourceArrayToString(data["text/plain"] as string[] | string))}</pre>`;
    }

    if (data["application/json"]) {
      const json = typeof data["application/json"] === "string"
        ? data["application/json"]
        : JSON.stringify(data["application/json"], null, 2);
      return `<pre class="output json-output">${escapeHtml(json)}</pre>`;
    }
  }

  return "";
}

export function notebookToHtml(title: string, cells: IpynbCell[]): string {
  const plotIndex = { n: 0 };
  const cellsHtml = cells.map((cell) => {
    if (cell.cell_type === "markdown") {
      const source = sourceToString(cell.source);
      return `<div class="cell markdown-cell" data-markdown="${escapeHtml(source)}"></div>`;
    }

    const source = sourceToString(cell.source);
    const outputs = ((cell as IpynbCodeCell).outputs ?? []).map((o) => renderOutput(o, plotIndex)).filter(Boolean);

    return `<div class="cell code-cell">
  <pre><code class="language-typescript">${escapeHtml(source)}</code></pre>${outputs.length ? `\n  <div class="outputs">${outputs.join("\n  ")}</div>` : ""}
</div>`;
  }).join("\n");

  const needsPlotly = plotIndex.n > 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css" />
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>${needsPlotly ? `\n  <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>` : ""}
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; }
    h1 { font-size: 1.4em; color: #555; font-weight: normal; margin-bottom: 2em; }
    .cell { margin-bottom: 1.5em; }
    .code-cell pre { background: #f6f8fa; border-radius: 6px; padding: 12px 16px; margin: 0; overflow-x: auto; }
    .code-cell pre code { font-family: "SF Mono", Consolas, monospace; font-size: 13px; }
    .outputs { margin-top: 4px; }
    .output { margin: 0; padding: 8px 12px; border-left: 3px solid #e0e0e0; font-family: "SF Mono", Consolas, monospace; font-size: 13px; white-space: pre-wrap; word-break: break-word; background: #fafafa; }
    .output.stderr { border-left-color: #f97316; background: #fff7ed; color: #9a3412; }
    .output.html-output, .output.svg-output { border: none; padding: 8px 0; background: none; }
    .output.json-output { background: #f6f8fa; }
    .plotly-chart { width: 100%; min-height: 400px; }
    img.output { max-width: 100%; display: block; margin: 4px 0; }
    .markdown-cell { line-height: 1.6; }
    .markdown-cell h1, .markdown-cell h2, .markdown-cell h3 { margin-top: 1em; }
    .markdown-cell code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
    .markdown-cell pre code { background: none; padding: 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${cellsHtml}
  <script>
    document.querySelectorAll('.markdown-cell[data-markdown]').forEach(el => {
      el.innerHTML = marked.parse(el.getAttribute('data-markdown'));
    });
    document.querySelectorAll('.markdown-output[data-markdown]').forEach(el => {
      el.innerHTML = marked.parse(el.getAttribute('data-markdown'));
    });
    hljs.highlightAll();
  </script>
</body>
</html>
`;
}

// ── Export to Markdown ───────────────────────────────────────────────────────

function renderOutputMd(output: IpynbOutput): string {
  if (output.output_type === "stream") {
    const text = sourceArrayToString(output.text as string[] | string).trim();
    if (!text) return "";
    return (output.name as string) === "stderr"
      ? `> **stderr:**\n> \`\`\`\n${text.split("\n").map((l) => `> ${l}`).join("\n")}\n> \`\`\``
      : "```\n" + text + "\n```";
  }

  if (output.output_type === "display_data" || output.output_type === "execute_result") {
    const data = output.data as Record<string, unknown> | undefined;
    if (!data) return "";

    if (data["application/vnd.bunbook.plotly"]) {
      return "> *[Interactive Plotly chart — open in VS Code with BunBook to view]*";
    }
    if (data["text/markdown"]) {
      return sourceArrayToString(data["text/markdown"] as string[] | string).trim();
    }
    if (data["text/html"]) {
      return sourceArrayToString(data["text/html"] as string[] | string).trim();
    }
    if (data["image/svg+xml"]) {
      return sourceArrayToString(data["image/svg+xml"] as string[] | string).trim();
    }
    if (data["image/png"]) {
      return `![output](data:image/png;base64,${data["image/png"]})`;
    }
    if (data["image/jpeg"]) {
      return `![output](data:image/jpeg;base64,${data["image/jpeg"]})`;
    }
    if (data["text/plain"]) {
      const text = sourceArrayToString(data["text/plain"] as string[] | string).trim();
      return text ? "```\n" + text + "\n```" : "";
    }
    if (data["application/json"]) {
      const json = typeof data["application/json"] === "string"
        ? data["application/json"]
        : JSON.stringify(data["application/json"], null, 2);
      return "```json\n" + json + "\n```";
    }
  }

  return "";
}

export function notebookToMarkdown(cells: IpynbCell[]): string {
  const parts: string[] = [];

  for (const cell of cells) {
    const source = sourceToString(cell.source);

    if (cell.cell_type === "markdown") {
      if (source.trim()) parts.push(source);
      continue;
    }

    if (source.trim()) {
      parts.push("```ts\n" + source + "\n```");
    }

    const outputs = (cell as IpynbCodeCell).outputs ?? [];
    for (const output of outputs) {
      const rendered = renderOutputMd(output);
      if (rendered) parts.push(rendered);
    }
  }

  return parts.join("\n\n") + "\n";
}
