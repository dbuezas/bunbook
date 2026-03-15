import * as vscode from "vscode";

interface RawCell {
  kind: "code" | "markdown";
  language?: string;
  value: string | string[];
}

interface RawNotebook {
  cells: RawCell[];
}

export class BunbookSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): vscode.NotebookData {
    const text = new TextDecoder().decode(content).trim();

    let raw: RawNotebook;
    if (!text) {
      raw = { cells: [{ kind: "code", language: "bunbook-typescript", value: "" }] };
    } else {
      try {
        raw = JSON.parse(text);
      } catch {
        raw = { cells: [{ kind: "code", language: "bunbook-typescript", value: "" }] };
      }
    }

    const cells = raw.cells.map((cell) => {
      const kind =
        cell.kind === "markdown"
          ? vscode.NotebookCellKind.Markup
          : vscode.NotebookCellKind.Code;
      const language =
        cell.kind === "markdown" ? "markdown" : cell.language ?? "bunbook-typescript";
      const value = Array.isArray(cell.value) ? cell.value.join("\n") : cell.value;
      return new vscode.NotebookCellData(kind, value, language);
    });

    return new vscode.NotebookData(cells);
  }

  serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Uint8Array {
    const raw: RawNotebook = {
      cells: data.cells.map((cell) => {
        const lines = cell.value.split("\n");
        if (cell.kind === vscode.NotebookCellKind.Markup) {
          return { kind: "markdown" as const, value: lines };
        }
        return {
          kind: "code" as const,
          language: cell.languageId,
          value: lines,
        };
      }),
    };

    return new TextEncoder().encode(JSON.stringify(raw, null, 2) + "\n");
  }
}
