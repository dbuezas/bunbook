import * as vscode from "vscode";

interface RawCell {
  kind: "code" | "markdown";
  language?: string;
  value: string;
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
      return new vscode.NotebookCellData(kind, cell.value, language);
    });

    return new vscode.NotebookData(cells);
  }

  serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Uint8Array {
    const raw: RawNotebook = {
      cells: data.cells.map((cell) => {
        if (cell.kind === vscode.NotebookCellKind.Markup) {
          return { kind: "markdown", value: cell.value };
        }
        return {
          kind: "code",
          language: cell.languageId,
          value: cell.value,
        };
      }),
    };

    return new TextEncoder().encode(JSON.stringify(raw, null, 2) + "\n");
  }
}
