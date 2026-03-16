import * as vscode from "vscode";
import * as crypto from "crypto";

// --- ipynb types ---

interface IpynbCodeCell {
  cell_type: "code";
  id?: string;
  source: string[];
  metadata: Record<string, unknown>;
  outputs: unknown[];
  execution_count: number | null;
}

interface IpynbMarkdownCell {
  cell_type: "markdown";
  id?: string;
  source: string[];
  metadata: Record<string, unknown>;
}

type IpynbCell = IpynbCodeCell | IpynbMarkdownCell;

interface IpynbNotebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: IpynbCell[];
}

/** Split a string into ipynb source lines: each line ends with \n except the last. */
function stringToSourceLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

const decoder = new TextDecoder();

const IPYNB_METADATA = {
  kernelspec: {
    name: "bunbook",
    display_name: "TypeScript (Bun)",
    language: "typescript",
  },
  language_info: {
    name: "typescript",
    file_extension: ".ts",
  },
};

export class BunbookSerializer implements vscode.NotebookSerializer {
  deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
  ): vscode.NotebookData {
    const text = decoder.decode(content).trim();

    if (!text) {
      return this._emptyNotebook();
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      return this._emptyNotebook();
    }

    // Legacy .bunbook format: { cells: [{ kind, language, value }] }
    if (Array.isArray(json.cells) && json.cells[0]?.kind !== undefined) {
      return this._deserializeLegacy(json.cells);
    }

    return this._deserializeIpynb(json as IpynbNotebook);
  }

  private _deserializeLegacy(
    cells: Array<{ kind: string; language?: string; value: string }>
  ): vscode.NotebookData {
    return new vscode.NotebookData(
      cells.map(
        (cell) =>
          new vscode.NotebookCellData(
            cell.kind === "markdown"
              ? vscode.NotebookCellKind.Markup
              : vscode.NotebookCellKind.Code,
            cell.value,
            cell.language ?? "typescript"
          )
      )
    );
  }

  private _emptyNotebook(): vscode.NotebookData {
    return new vscode.NotebookData([
      new vscode.NotebookCellData(
        vscode.NotebookCellKind.Code,
        "",
        "typescript"
      ),
    ]);
  }

  private _deserializeIpynb(raw: IpynbNotebook): vscode.NotebookData {
    if (!Array.isArray(raw.cells) || raw.cells.length === 0) {
      return this._emptyNotebook();
    }

    const cells = raw.cells.map((cell) => {
      const kind =
        cell.cell_type === "markdown"
          ? vscode.NotebookCellKind.Markup
          : vscode.NotebookCellKind.Code;
      const language =
        cell.cell_type === "markdown" ? "markdown" : "typescript";
      const value = Array.isArray(cell.source) ? cell.source.join("") : "";
      const cellData = new vscode.NotebookCellData(kind, value, language);

      if (cell.id) {
        cellData.metadata = { id: cell.id };
      }

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
        return {
          cell_type: "markdown" as const,
          id,
          source,
          metadata: {},
        };
      }

      return {
        cell_type: "code" as const,
        id,
        source,
        metadata: {},
        outputs: [],
        execution_count: null,
      };
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
