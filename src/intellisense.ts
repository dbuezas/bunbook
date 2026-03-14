import * as vscode from "vscode";
import type * as TS from "typescript";
import * as path from "path";

let ts: typeof TS;

function loadTypeScript(): typeof TS {
  if (ts) return ts;
  // Use TypeScript from VS Code's built-in extensions
  const tsExtension = vscode.extensions.getExtension(
    "vscode.typescript-language-features"
  );
  if (tsExtension) {
    // Try sibling node_modules (VS Code bundles TS at extensions/node_modules/typescript)
    const paths = [
      path.join(tsExtension.extensionPath, "node_modules", "typescript"),
      path.join(tsExtension.extensionPath, "..", "node_modules", "typescript"),
    ];
    for (const tsPath of paths) {
      try {
        ts = require(tsPath);
        return ts;
      } catch {
        // try next path
      }
    }
  }
  // Fallback: try resolving from node_modules (dev / has typescript installed)
  ts = require("typescript");
  return ts;
}

/**
 * Provides TypeScript intellisense for bunbook notebook cells by creating
 * an in-memory TypeScript LanguageService over a virtual file that
 * concatenates all code cells.
 */
export class BunbookIntellisense {
  private readonly _disposables: vscode.Disposable[] = [];
  private _service: TS.LanguageService | null = null;
  private _host: VirtualLanguageServiceHost | null = null;

  private readonly _diagnostics: vscode.DiagnosticCollection;
  private _debounceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly _extensionPath: string) {
    this._diagnostics =
      vscode.languages.createDiagnosticCollection("bunbook-typescript");
    this._disposables.push(this._diagnostics);

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

    this._disposables.push(
      vscode.languages.registerDocumentFormattingEditProvider(
        { scheme: "vscode-notebook-cell", language: "bunbook-typescript" },
        {
          provideDocumentFormattingEdits: (doc, options) =>
            this._provideFormatting(doc, options),
        }
      )
    );

    // Update diagnostics on cell content changes
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const notebook = vscode.workspace.notebookDocuments.find((nb) =>
          nb.getCells().some(
            (c) => c.document.uri.toString() === e.document.uri.toString()
          )
        );
        if (notebook?.notebookType === "bunbook") {
          this._debouncedDiagnostics(notebook);
        }
      })
    );

    // Update on cell structure changes (add/remove/reorder)
    this._disposables.push(
      vscode.workspace.onDidChangeNotebookDocument((e) => {
        if (e.notebook.notebookType === "bunbook") {
          this._debouncedDiagnostics(e.notebook);
        }
      })
    );

    // Clear diagnostics when notebook closes
    this._disposables.push(
      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        if (notebook.notebookType === "bunbook") {
          for (const cell of notebook.getCells()) {
            this._diagnostics.delete(cell.document.uri);
          }
        }
      })
    );
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._service?.dispose();
    for (const d of this._disposables) d.dispose();
  }

  private _debouncedDiagnostics(notebook: vscode.NotebookDocument): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._updateDiagnostics(notebook);
    }, 500);
  }

  private _updateDiagnostics(notebook: vscode.NotebookDocument): void {
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

    const syntactic = service.getSyntacticDiagnostics(host.virtualFile);
    const semantic = service.getSemanticDiagnostics(host.virtualFile);
    const allDiags = [...syntactic, ...semantic];

    // Group diagnostics by cell
    const diagsByCell = new Map<number, vscode.Diagnostic[]>();
    for (const cell of codeCells) {
      diagsByCell.set(cell.index, []);
    }

    for (const diag of allDiags) {
      if (diag.start === undefined || diag.length === undefined) continue;

      const cellPos = host.offsetToCellPosition(diag.start);
      if (!cellPos) continue;

      const cell = codeCells.find((c) => c.index === cellPos.cellIndex);
      if (!cell) continue;

      const startPos = cell.document.positionAt(cellPos.positionInCell);
      const endPos = cell.document.positionAt(
        cellPos.positionInCell + diag.length
      );

      const severity =
        diag.category === ts.DiagnosticCategory.Error
          ? vscode.DiagnosticSeverity.Error
          : diag.category === ts.DiagnosticCategory.Warning
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      const message = ts.flattenDiagnosticMessageText(
        diag.messageText,
        "\n"
      );

      const vsDiag = new vscode.Diagnostic(
        new vscode.Range(startPos, endPos),
        message,
        severity
      );
      vsDiag.source = "bunbook";

      diagsByCell.get(cell.index)?.push(vsDiag);
    }

    // Apply diagnostics per cell
    for (const cell of codeCells) {
      this._diagnostics.set(
        cell.document.uri,
        diagsByCell.get(cell.index) ?? []
      );
    }
  }

  private _ensureService(cwd: string): {
    service: TS.LanguageService;
    host: VirtualLanguageServiceHost;
  } {
    loadTypeScript();
    if (!this._service || !this._host || this._host.cwd !== cwd) {
      this._service?.dispose();
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
    service: TS.LanguageService;
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
      ctx.host.virtualFile,
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

  private _provideFormatting(
    doc: vscode.TextDocument,
    options: vscode.FormattingOptions
  ): vscode.TextEdit[] | undefined {
    const ctx = this._sync(doc);
    if (!ctx) return undefined;

    const formatSettings: TS.FormatCodeSettings = {
      tabSize: options.tabSize,
      indentSize: options.tabSize,
      convertTabsToSpaces: options.insertSpaces,
      newLineCharacter: "\n",
      insertSpaceAfterCommaDelimiter: true,
      insertSpaceAfterSemicolonInForStatements: true,
      insertSpaceBeforeAndAfterBinaryOperators: true,
      insertSpaceAfterKeywordsInControlFlowStatements: true,
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: false,
      insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: false,
      insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: false,
      placeOpenBraceOnNewLineForFunctions: false,
      placeOpenBraceOnNewLineForControlBlocks: false,
      semicolons: ts.SemicolonPreference.Ignore,
    };

    // Get the range of just this cell within the virtual file
    const cellEntry = ctx.host.getCellOffset(ctx.cellIndex);
    if (!cellEntry) return undefined;

    const edits = ctx.service.getFormattingEditsForRange(
      ctx.host.virtualFile,
      cellEntry.start,
      cellEntry.start + cellEntry.length,
      formatSettings
    );

    return edits
      .map((edit) => {
        const cellPos = ctx.host.offsetToCellPosition(edit.span.start);
        if (!cellPos || cellPos.cellIndex !== ctx.cellIndex) return null;

        const startPos = doc.positionAt(cellPos.positionInCell);
        const endCellPos = ctx.host.offsetToCellPosition(
          edit.span.start + edit.span.length
        );
        // If end falls outside this cell, clamp to end of cell
        const endOffset =
          endCellPos && endCellPos.cellIndex === ctx.cellIndex
            ? endCellPos.positionInCell
            : doc.getText().length;
        const endPos = doc.positionAt(endOffset);

        return vscode.TextEdit.replace(
          new vscode.Range(startPos, endPos),
          edit.newText
        );
      })
      .filter((e): e is vscode.TextEdit => e !== null);
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

    const info = ctx.service.getQuickInfoAtPosition(ctx.host.virtualFile, offset);
    if (!info) return undefined;

    const display = ts.displayPartsToString(info.displayParts);
    const docs = ts.displayPartsToString(info.documentation);
    const md = new vscode.MarkdownString();
    md.appendCodeblock(display, "typescript");
    if (docs) md.appendText(docs);

    return new vscode.Hover(md);
  }
}

// Virtual file name only — the host prepends cwd to get the full path
const VIRTUAL_FILENAME = "___bunbook___.ts";

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

class VirtualLanguageServiceHost implements TS.LanguageServiceHost {
  private _content = "";
  private _version = 0;
  private _cellOffsets: { cellIndex: number; start: number; length: number }[] =
    [];

  readonly virtualFile: string;

  constructor(
    readonly cwd: string,
    private readonly _extensionPath: string
  ) {
    this.virtualFile = path.join(cwd, VIRTUAL_FILENAME);
  }

  getCompilationSettings(): TS.CompilerOptions {
    return {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: false,
      esModuleInterop: true,
      allowJs: true,
      lib: ["lib.es2022.d.ts"],
      typeRoots: [
        path.join(this.cwd, "node_modules", "@types"),
        path.join(this._extensionPath, "node_modules", "@types"),
      ],
    };
  }

  getScriptFileNames(): string[] {
    return [this.virtualFile, AMBIENT_FILE];
  }

  getScriptVersion(fileName: string): string {
    if (fileName === this.virtualFile) return this._version.toString();
    if (fileName === AMBIENT_FILE) return "1";
    return "0";
  }

  getScriptSnapshot(fileName: string): TS.IScriptSnapshot | undefined {
    if (fileName === this.virtualFile) {
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
    return this.cwd;
  }

  getDefaultLibFileName(options: TS.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options);
  }

  fileExists(p: string): boolean {
    return (
      p === this.virtualFile || p === AMBIENT_FILE || ts.sys.fileExists(p)
    );
  }

  readFile(p: string): string | undefined {
    if (p === this.virtualFile) return this._content;
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

  getCellOffset(
    cellIndex: number
  ): { start: number; length: number } | undefined {
    const entry = this._cellOffsets.find((o) => o.cellIndex === cellIndex);
    if (!entry) return undefined;
    return { start: entry.start, length: entry.length };
  }

  cellPositionToOffset(
    cellIndex: number,
    posInCell: number
  ): number | undefined {
    const entry = this._cellOffsets.find((o) => o.cellIndex === cellIndex);
    if (!entry) return undefined;
    return entry.start + posInCell;
  }

  offsetToCellPosition(
    offset: number
  ): { cellIndex: number; positionInCell: number } | undefined {
    for (const entry of this._cellOffsets) {
      if (offset >= entry.start && offset < entry.start + entry.length) {
        return {
          cellIndex: entry.cellIndex,
          positionInCell: offset - entry.start,
        };
      }
    }
    return undefined;
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
