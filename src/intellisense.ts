import * as vscode from "vscode";
import * as ts from "typescript";
import * as path from "path";

/**
 * Provides TypeScript intellisense for bunbook notebook cells by creating
 * an in-memory TypeScript LanguageService over a virtual file that
 * concatenates all code cells.
 */
export class BunbookIntellisense {
  private readonly _disposables: vscode.Disposable[] = [];
  private _service: ts.LanguageService | null = null;
  private _host: VirtualLanguageServiceHost | null = null;

  constructor(private readonly _extensionPath: string) {
    this._disposables.push(
      vscode.languages.registerCompletionItemProvider(
        { scheme: "vscode-notebook-cell", language: "bunbook-typescript" },
        {
          provideCompletionItems: (doc, pos, _token, _ctx) =>
            this._provideCompletions(doc, pos),
        },
        "."
      )
    );

    this._disposables.push(
      vscode.languages.registerHoverProvider(
        { scheme: "vscode-notebook-cell", language: "bunbook-typescript" },
        {
          provideHover: (doc, pos) => this._provideHover(doc, pos),
        }
      )
    );
  }

  dispose(): void {
    this._service?.dispose();
    for (const d of this._disposables) d.dispose();
  }

  private _ensureService(cwd: string): {
    service: ts.LanguageService;
    host: VirtualLanguageServiceHost;
  } {
    if (!this._service || !this._host) {
      this._host = new VirtualLanguageServiceHost(cwd, this._extensionPath);
      this._service = ts.createLanguageService(
        this._host,
        ts.createDocumentRegistry()
      );
    }
    return { service: this._service, host: this._host };
  }

  private _sync(
    doc: vscode.TextDocument
  ): {
    service: ts.LanguageService;
    host: VirtualLanguageServiceHost;
    cellIndex: number;
  } | null {
    const notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some(
        (c) => c.document.uri.toString() === doc.uri.toString()
      )
    );
    if (!notebook || notebook.notebookType !== "bunbook") return null;

    const cell = notebook
      .getCells()
      .find((c) => c.document.uri.toString() === doc.uri.toString());
    if (!cell) return null;

    const cwd = path.dirname(notebook.uri.fsPath);
    const { service, host } = this._ensureService(cwd);

    const codeCells = notebook
      .getCells()
      .filter((c) => c.kind === vscode.NotebookCellKind.Code);

    host.updateVirtualFile(
      codeCells.map((c) => ({
        text: c.document.getText(),
        cellIndex: c.index,
      }))
    );

    return { service, host, cellIndex: cell.index };
  }

  private _provideCompletions(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.CompletionItem[] | undefined {
    const ctx = this._sync(doc);
    if (!ctx) return undefined;

    const offset = ctx.host.cellPositionToOffset(
      ctx.cellIndex,
      doc.offsetAt(pos)
    );
    if (offset === undefined) return undefined;

    const completions = ctx.service.getCompletionsAtPosition(
      VIRTUAL_FILE,
      offset,
      {
        includeCompletionsForModuleExports: true,
        includeCompletionsWithInsertText: true,
      }
    );
    if (!completions) return undefined;

    return completions.entries.map((entry) => {
      const item = new vscode.CompletionItem(
        entry.name,
        convertKind(entry.kind)
      );
      item.sortText = entry.sortText;
      return item;
    });
  }

  private _provideHover(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.Hover | undefined {
    const ctx = this._sync(doc);
    if (!ctx) return undefined;

    const offset = ctx.host.cellPositionToOffset(
      ctx.cellIndex,
      doc.offsetAt(pos)
    );
    if (offset === undefined) return undefined;

    const info = ctx.service.getQuickInfoAtPosition(VIRTUAL_FILE, offset);
    if (!info) return undefined;

    const display = ts.displayPartsToString(info.displayParts);
    const docs = ts.displayPartsToString(info.documentation);
    const md = new vscode.MarkdownString();
    md.appendCodeblock(display, "typescript");
    if (docs) md.appendText(docs);

    return new vscode.Hover(md);
  }
}

const VIRTUAL_FILE = "/___bunbook___.ts";

// Ambient declarations for globals available in the worker
const AMBIENT_DECLARATIONS = `
declare namespace Plotly {
  interface Datum {}
  interface PlotData {
    x: (number | string | Date)[];
    y: (number | string | Date)[];
    z?: (number | string | Date)[] | (number | string | Date)[][];
    type: "scatter" | "bar" | "pie" | "histogram" | "heatmap" | "contour"
      | "scatter3d" | "surface" | "box" | "violin" | "scattergeo"
      | "choropleth" | "scattermapbox" | "candlestick" | "ohlc"
      | "scatterpolar" | "scatterternary" | "sunburst" | "treemap"
      | "funnel" | "waterfall" | "sankey" | string;
    mode?: "lines" | "markers" | "text" | "lines+markers" | "lines+text"
      | "markers+text" | "lines+markers+text" | "none" | string;
    name?: string;
    marker?: {
      color?: string | string[] | number[];
      size?: number | number[];
      symbol?: string;
      line?: { color?: string; width?: number };
      colorscale?: string | [number, string][];
      showscale?: boolean;
      opacity?: number | number[];
      [key: string]: any;
    };
    line?: {
      color?: string;
      width?: number;
      dash?: "solid" | "dot" | "dash" | "longdash" | "dashdot" | "longdashdot";
      shape?: "linear" | "spline" | "hv" | "vh" | "hvh" | "vhv";
      [key: string]: any;
    };
    text?: string | string[];
    textposition?: string;
    hoverinfo?: string;
    fill?: "none" | "tozeroy" | "tozerox" | "tonexty" | "tonextx" | "toself" | "tonext";
    fillcolor?: string;
    opacity?: number;
    orientation?: "v" | "h";
    [key: string]: any;
  }
  interface Layout {
    title?: string | { text: string; [key: string]: any };
    xaxis?: { title?: string | { text: string }; [key: string]: any };
    yaxis?: { title?: string | { text: string }; [key: string]: any };
    width?: number;
    height?: number;
    showlegend?: boolean;
    legend?: Record<string, any>;
    margin?: { l?: number; r?: number; t?: number; b?: number; pad?: number };
    paper_bgcolor?: string;
    plot_bgcolor?: string;
    font?: { family?: string; size?: number; color?: string };
    barmode?: "stack" | "group" | "overlay" | "relative";
    template?: any;
    [key: string]: any;
  }
  interface Config {
    responsive?: boolean;
    displayModeBar?: boolean | "hover";
    displaylogo?: boolean;
    scrollZoom?: boolean;
    staticPlot?: boolean;
    editable?: boolean;
    toImageButtonOptions?: Record<string, any>;
    [key: string]: any;
  }
  function newPlot(
    data: Partial<PlotData>[],
    layout?: Partial<Layout>,
    config?: Partial<Config>
  ): void;
}
`;

const AMBIENT_FILE = "/___bunbook_ambient___.d.ts";

class VirtualLanguageServiceHost implements ts.LanguageServiceHost {
  private _content = "";
  private _version = 0;
  private _cellOffsets: { cellIndex: number; start: number; length: number }[] =
    [];

  constructor(
    private readonly _cwd: string,
    private readonly _extensionPath: string
  ) {}

  getCompilationSettings(): ts.CompilerOptions {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: false,
      esModuleInterop: true,
      allowJs: true,
      lib: ["lib.es2022.d.ts"],
      types: ["bun-types"],
      typeRoots: [
        path.join(this._extensionPath, "node_modules"),
        path.join(this._cwd, "node_modules"),
      ],
    };
  }

  getScriptFileNames(): string[] {
    return [VIRTUAL_FILE, AMBIENT_FILE];
  }

  getScriptVersion(fileName: string): string {
    if (fileName === VIRTUAL_FILE) return this._version.toString();
    if (fileName === AMBIENT_FILE) return "1";
    return "0";
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    if (fileName === VIRTUAL_FILE) {
      return ts.ScriptSnapshot.fromString(this._content);
    }
    if (fileName === AMBIENT_FILE) {
      return ts.ScriptSnapshot.fromString(AMBIENT_DECLARATIONS);
    }
    if (ts.sys.fileExists(fileName)) {
      return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName)!);
    }
    return undefined;
  }

  getCurrentDirectory(): string {
    return this._cwd;
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(p: string): boolean {
    return (
      p === VIRTUAL_FILE || p === AMBIENT_FILE || ts.sys.fileExists(p)
    );
  }

  readFile(p: string): string | undefined {
    if (p === VIRTUAL_FILE) return this._content;
    if (p === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
    return ts.sys.readFile(p);
  }

  updateVirtualFile(cells: { text: string; cellIndex: number }[]): void {
    const offsets: typeof this._cellOffsets = [];
    let pos = 0;
    const parts: string[] = [];

    for (const cell of cells) {
      offsets.push({ cellIndex: cell.cellIndex, start: pos, length: cell.text.length });
      parts.push(cell.text);
      pos += cell.text.length + 1; // +1 for \n separator
    }

    this._content = parts.join("\n");
    this._cellOffsets = offsets;
    this._version++;
  }

  cellPositionToOffset(
    cellIndex: number,
    posInCell: number
  ): number | undefined {
    const entry = this._cellOffsets.find((o) => o.cellIndex === cellIndex);
    if (!entry) return undefined;
    return entry.start + posInCell;
  }
}

function convertKind(kind: string): vscode.CompletionItemKind {
  const map: Record<string, vscode.CompletionItemKind> = {
    method: vscode.CompletionItemKind.Method,
    function: vscode.CompletionItemKind.Function,
    constructor: vscode.CompletionItemKind.Constructor,
    field: vscode.CompletionItemKind.Field,
    variable: vscode.CompletionItemKind.Variable,
    class: vscode.CompletionItemKind.Class,
    interface: vscode.CompletionItemKind.Interface,
    module: vscode.CompletionItemKind.Module,
    property: vscode.CompletionItemKind.Property,
    enum: vscode.CompletionItemKind.Enum,
    keyword: vscode.CompletionItemKind.Keyword,
    constant: vscode.CompletionItemKind.Value,
    "local variable": vscode.CompletionItemKind.Variable,
    "local function": vscode.CompletionItemKind.Function,
  };
  return map[kind] ?? vscode.CompletionItemKind.Text;
}
