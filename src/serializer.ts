import * as vscode from "vscode";
import * as crypto from "crypto";
import {
  type IpynbNotebook,
  type IpynbCell,
  IPYNB_METADATA,
  stringToSourceLines,
  sourceToString,
  parseIpynb,
} from "./ipynb";

const decoder = new TextDecoder();

export class BunbookSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): vscode.NotebookData {
    const text = decoder.decode(content).trim();
    const json = text ? parseIpynb(text) : null;
    return json ? this._deserializeIpynb(json) : this._emptyNotebook();
  }

  private _emptyNotebook(): vscode.NotebookData {
    return new vscode.NotebookData([
      new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "", "typescript"),
    ]);
  }

  private _deserializeIpynb(raw: IpynbNotebook): vscode.NotebookData {
    if (!Array.isArray(raw.cells) || raw.cells.length === 0) {
      return this._emptyNotebook();
    }

    const cells = raw.cells.map((cell) => {
      const kind = cell.cell_type === "markdown"
        ? vscode.NotebookCellKind.Markup
        : vscode.NotebookCellKind.Code;
      const language = cell.cell_type === "markdown" ? "markdown" : "typescript";
      const value = sourceToString(cell.source);
      const cellData = new vscode.NotebookCellData(kind, value, language);
      if (cell.id) cellData.metadata = { id: cell.id };
      return cellData;
    });

    return new vscode.NotebookData(cells);
  }

  serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
  ): Uint8Array {
    const cells: IpynbCell[] = data.cells.map((cell) => {
      const id = cell.metadata?.id ?? crypto.randomUUID();
      const source = stringToSourceLines(cell.value);

      if (cell.kind === vscode.NotebookCellKind.Markup) {
        return { cell_type: "markdown" as const, id, source, metadata: {} };
      }

      return { cell_type: "code" as const, id, source, metadata: {}, outputs: [], execution_count: null };
    });

    const notebook: IpynbNotebook = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: IPYNB_METADATA,
      cells,
    };

    return new TextEncoder().encode(JSON.stringify(notebook, null, 1) + "\n");
  }
}
