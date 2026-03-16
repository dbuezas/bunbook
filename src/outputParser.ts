import * as vscode from "vscode";

const PLOTLY_START = "___PLOTLY_OUTPUT___";
const PLOTLY_END = "___END_PLOTLY___";
const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js";
let plotlyOutputId = 0;

function plotlyHtml(jsonStr: string): string {
  const id = `plotly-${Date.now()}-${plotlyOutputId++}`;
  return `<div id="${id}"></div>
<script type="text/javascript">
(function() {
  var d = ${jsonStr};
  function render() { Plotly.newPlot("${id}", d.data, d.layout || {}, d.config || {}); }
  if (typeof Plotly !== "undefined") { render(); return; }
  var s = document.createElement("script");
  s.src = "${PLOTLY_CDN}";
  s.onload = render;
  document.head.appendChild(s);
})();
</script>`;
}

export function parseOutput(stdout: string): vscode.NotebookCellOutput[] {
  const outputs: vscode.NotebookCellOutput[] = [];
  let remaining = stdout;

  while (remaining.length > 0) {
    const startIdx = remaining.indexOf(PLOTLY_START);

    if (startIdx === -1) {
      // No more plotly markers — rest is plain text
      const text = remaining.trim();
      if (text) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(text),
          ])
        );
      }
      break;
    }

    // Text before the plotly marker
    const textBefore = remaining.substring(0, startIdx).trim();
    if (textBefore) {
      outputs.push(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(textBefore),
        ])
      );
    }

    const jsonStart = startIdx + PLOTLY_START.length;
    const endIdx = remaining.indexOf(PLOTLY_END, jsonStart);

    if (endIdx === -1) {
      // Malformed marker — treat rest as text
      const rest = remaining.substring(startIdx).trim();
      if (rest) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(rest),
          ])
        );
      }
      break;
    }

    const jsonStr = remaining.substring(jsonStart, endIdx);
    try {
      const plotlyData = JSON.parse(jsonStr);
      outputs.push(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.json(
            plotlyData,
            "application/vnd.plotly+json"
          ),
          vscode.NotebookCellOutputItem.text(
            plotlyHtml(jsonStr),
            "text/html"
          ),
        ])
      );
    } catch {
      // Invalid JSON — output as text
      outputs.push(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(jsonStr),
        ])
      );
    }

    remaining = remaining.substring(endIdx + PLOTLY_END.length);
  }

  return outputs;
}
