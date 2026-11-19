import * as path from "path";
import type * as TS from "typescript";
import * as vscode from "vscode";
import { SUPPORTED_CELL_LANGUAGES } from "./language";
import { VirtualLanguageServiceHost } from "./languageServiceHost";
import { findTsconfig, resolveCompilerOptions } from "./tsconfig";

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
  /** Identifies the notebook directory + tsconfig the current service was built for. */
  private _serviceKey: string | null = null;
  private readonly _log: vscode.OutputChannel;

  private readonly _diagnostics: vscode.DiagnosticCollection;
  private _debounceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly _extensionPath: string) {
    this._diagnostics =
      vscode.languages.createDiagnosticCollection("bunbook");
    this._disposables.push(this._diagnostics);
    this._log = vscode.window.createOutputChannel("BunBook IntelliSense");
    this._disposables.push(this._log);

    const selector = SUPPORTED_CELL_LANGUAGES.map((language) => ({
      scheme: "vscode-notebook-cell",
      language,
    }));

    // Rebuild the service when a tsconfig (or a file it extends) or the
    // related settings change.
    const tsconfigWatcher = vscode.workspace.createFileSystemWatcher("**/*tsconfig*.json");
    const invalidate = () => this._invalidateService();
    tsconfigWatcher.onDidChange(invalidate);
    tsconfigWatcher.onDidCreate(invalidate);
    tsconfigWatcher.onDidDelete(invalidate);
    this._disposables.push(tsconfigWatcher);
    this._disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("bunbook.useTsconfig") || e.affectsConfiguration("bunbook.tsconfigPath")) {
          invalidate();
        }
      })
    );

    this._disposables.push(
      vscode.languages.registerCompletionItemProvider(
        selector,
        {
          provideCompletionItems: (doc, pos, _token, _ctx) =>
            this._provideCompletions(doc, pos),
        },
        "."
      )
    );

    this._disposables.push(
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (doc, pos) => this._provideHover(doc, pos),
      })
    );

    this._disposables.push(
      vscode.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: (doc, options) =>
          this._provideFormatting(doc, options),
      })
    );

    this._disposables.push(
      vscode.languages.registerDefinitionProvider(selector, {
        provideDefinition: (doc, pos) => this._provideDefinition(doc, pos),
      })
    );

    // Update diagnostics on cell content changes
    this._disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        const notebook = this._findBunbookNotebook(e.document.uri);
        if (notebook) {
          this._debouncedDiagnostics(notebook);
        }
      })
    );

    // Update on cell structure changes (add/remove/reorder)
    this._disposables.push(
      vscode.workspace.onDidChangeNotebookDocument((e) => {
        if (this._isBunbookNotebook(e.notebook)) {
          this._debouncedDiagnostics(e.notebook);
        }
      })
    );

    // Clear diagnostics when notebook closes
    this._disposables.push(
      vscode.workspace.onDidCloseNotebookDocument((notebook) => {
        if (this._isBunbookNotebook(notebook)) {
          for (const cell of notebook.getCells()) {
            this._diagnostics.delete(cell.document.uri);
          }
        }
      })
    );
  }

  private _isBunbookNotebook(notebook: vscode.NotebookDocument): boolean {
    return notebook.notebookType === "bunbook" || notebook.notebookType === "jupyter-notebook";
  }

  private _findBunbookNotebook(cellUri: vscode.Uri): vscode.NotebookDocument | undefined {
    return vscode.workspace.notebookDocuments.find(
      (nb) =>
        this._isBunbookNotebook(nb) &&
        nb.getCells().some((c) => c.document.uri.toString() === cellUri.toString())
    );
  }

  dispose(): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._invalidateService();
    for (const d of this._disposables) d.dispose();
  }

  private _debouncedDiagnostics(notebook: vscode.NotebookDocument): void {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._updateDiagnostics(notebook);
    }, 500);
  }

  private _updateDiagnostics(notebook: vscode.NotebookDocument): void {
    const { service, host } = this._ensureService(notebook);

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

      const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");

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

  private _invalidateService(): void {
    this._service?.dispose();
    this._service = null;
    this._host = null;
    this._serviceKey = null;
  }

  private _ensureService(notebook: vscode.NotebookDocument): {
    service: TS.LanguageService;
    host: VirtualLanguageServiceHost;
  } {
    loadTypeScript();
    const notebookDir = path.dirname(notebook.uri.fsPath);
    const config = vscode.workspace.getConfiguration("bunbook", notebook.uri);
    const configPath = findTsconfig(ts, notebookDir, {
      useTsconfig: config.get<boolean>("useTsconfig", true),
      tsconfigPath: config.get<string>("tsconfigPath", ""),
      baseDir: vscode.workspace.getWorkspaceFolder(notebook.uri)?.uri.fsPath ?? notebookDir,
    });
    const key = `${notebookDir}\0${configPath ?? ""}`;

    if (!this._service || !this._host || this._serviceKey !== key) {
      this._service?.dispose();
      const resolved = resolveCompilerOptions(ts, {
        notebookDir,
        extensionPath: this._extensionPath,
        configPath,
      });
      this._log.appendLine(
        `${notebook.uri.fsPath}: using ${resolved.configPath ?? "built-in compiler options (no tsconfig.json)"}`
      );
      for (const error of resolved.errors) {
        this._log.appendLine(`  tsconfig error: ${error}`);
      }
      this._host = new VirtualLanguageServiceHost(ts, notebookDir, resolved.options);
      this._service = ts.createLanguageService(
        this._host,
        ts.createDocumentRegistry()
      );
      this._serviceKey = key;
    }
    return { service: this._service, host: this._host };
  }

  private _sync(doc: vscode.TextDocument): {
    service: TS.LanguageService;
    host: VirtualLanguageServiceHost;
    cellIndex: number;
  } | null {
    const notebook = this._findBunbookNotebook(doc.uri);
    if (!notebook) return null;

    const cell = notebook
      .getCells()
      .find((c) => c.document.uri.toString() === doc.uri.toString());
    if (!cell) return null;

    const { service, host } = this._ensureService(notebook);

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

    const info = ctx.service.getQuickInfoAtPosition(
      ctx.host.virtualFile,
      offset
    );
    if (!info) return undefined;

    const display = ts.displayPartsToString(info.displayParts);
    const docs = ts.displayPartsToString(info.documentation);
    const md = new vscode.MarkdownString();
    md.appendCodeblock(display, "typescript");
    if (docs) md.appendText(docs);

    return new vscode.Hover(md);
  }

  private _provideDefinition(
    doc: vscode.TextDocument,
    pos: vscode.Position
  ): vscode.Location | vscode.Location[] | undefined {
    const ctx = this._sync(doc);
    if (!ctx) return undefined;

    const offset = ctx.host.cellPositionToOffset(
      ctx.cellIndex,
      doc.offsetAt(pos)
    );
    if (offset === undefined) return undefined;

    const defs = ctx.service.getDefinitionAtPosition(
      ctx.host.virtualFile,
      offset
    );
    if (!defs || defs.length === 0) return undefined;

    const notebook = vscode.workspace.notebookDocuments.find((nb) =>
      nb.getCells().some((c) => c.document.uri.toString() === doc.uri.toString())
    );

    return defs
      .map((def) => {
        // Definition is inside the virtual file → map back to the notebook cell
        if (def.fileName === ctx.host.virtualFile && notebook) {
          const cellPos = ctx.host.offsetToCellPosition(def.textSpan.start);
          if (!cellPos) return null;
          const cell = notebook.getCells().find((c) => c.index === cellPos.cellIndex);
          if (!cell) return null;
          const startPos = cell.document.positionAt(cellPos.positionInCell);
          return new vscode.Location(cell.document.uri, startPos);
        }
        // Definition is in an external file (node_modules, etc.)
        const uri = vscode.Uri.file(def.fileName);
        const startPos = new vscode.Position(0, 0);
        // Read the file to compute proper position from the offset
        if (ts.sys.fileExists(def.fileName)) {
          const content = ts.sys.readFile(def.fileName);
          if (content) {
            let line = 0;
            let col = 0;
            for (let i = 0; i < def.textSpan.start && i < content.length; i++) {
              if (content[i] === "\n") {
                line++;
                col = 0;
              } else {
                col++;
              }
            }
            return new vscode.Location(uri, new vscode.Position(line, col));
          }
        }
        return new vscode.Location(uri, startPos);
      })
      .filter((loc): loc is vscode.Location => loc !== null);
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
