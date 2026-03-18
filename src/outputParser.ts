import * as vscode from "vscode";
export { parseOutputRaw, type RawOutput, type RawOutputItem } from "./outputParserRaw";

const DISPLAY_START = "___DISPLAY_OUTPUT___";
const DISPLAY_END = "___END_DISPLAY___";

const BINARY_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function parseOutput(stdout: string): vscode.NotebookCellOutput[] {
  const outputs: vscode.NotebookCellOutput[] = [];
  let remaining = stdout;

  while (remaining.length > 0) {
    const startIdx = remaining.indexOf(DISPLAY_START);

    if (startIdx === -1) {
      // No more display markers — rest is plain text
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

    // Text before the display marker
    const textBefore = remaining.substring(0, startIdx).trim();
    if (textBefore) {
      outputs.push(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(textBefore),
        ])
      );
    }

    const jsonStart = startIdx + DISPLAY_START.length;
    const endIdx = remaining.indexOf(DISPLAY_END, jsonStart);

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
      const payload: { items: { mime: string; data: string }[] } =
        JSON.parse(jsonStr);
      const outputItems = payload.items.map((item) => {
        if (BINARY_MIME_TYPES.has(item.mime)) {
          // Decode base64 to Uint8Array for binary MIME types
          const bytes = Uint8Array.from(Buffer.from(item.data, "base64"));
          return new vscode.NotebookCellOutputItem(bytes, item.mime);
        }
        // Text-based MIME type
        return new vscode.NotebookCellOutputItem(
          new TextEncoder().encode(item.data),
          item.mime
        );
      });
      outputs.push(new vscode.NotebookCellOutput(outputItems));
    } catch {
      // Invalid JSON — output as text
      outputs.push(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.text(jsonStr),
        ])
      );
    }

    remaining = remaining.substring(endIdx + DISPLAY_END.length);
  }

  return outputs;
}
