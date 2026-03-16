import * as vscode from "vscode";

const PLOTLY_START = "___PLOTLY_OUTPUT___";
const PLOTLY_END = "___END_PLOTLY___";

const PLOTLY_FALLBACK_HTML = `<p style="color:#888;font-size:13px">Plotly chart — install <a href="https://marketplace.visualstudio.com/items?itemName=DavidBuezas.bunbook">BunBook</a> in VS Code to view interactive plots.</p>`;

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
      JSON.parse(jsonStr); // validate
      outputs.push(
        new vscode.NotebookCellOutput([
          new vscode.NotebookCellOutputItem(
            new TextEncoder().encode(jsonStr),
            "application/vnd.bunbook.plotly"
          ),
          vscode.NotebookCellOutputItem.text(
            PLOTLY_FALLBACK_HTML,
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
