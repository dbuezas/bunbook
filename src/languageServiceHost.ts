import * as path from "path";
import type * as TS from "typescript";

// Virtual file name only — the host prepends cwd to get the full path
const VIRTUAL_FILENAME = "___bunbook___.ts";

// Prepended to the virtual file so TypeScript treats it as a module (enabling top-level await)
const VIRTUAL_PREAMBLE = "export {};\n";

// Ambient declarations for globals available in the worker.
// This file must remain a script (no imports) so declarations are global.
// We use /// <reference types="plotly.js" /> to get Plotly types, then
// re-declare the Plotly const with our element-less API.
export const AMBIENT_DECLARATIONS = `
/// <reference types="bun-types" />
/// <reference types="plotly.js" />

// BunBook's Plotly API: same as Plotly.js but without the root element parameter.
interface BunBookPlotly {
  newPlot(
    data: Plotly.Data[],
    layout?: Partial<Plotly.Layout>,
    config?: Partial<Plotly.Config>
  ): void;
}

declare const Plotly: BunBookPlotly;

interface DisplayFunction {
  /** Generic display: raw string + MIME type */
  (data: string, mime?: string): void;
  /** Multi-MIME display: record of MIME type → data */
  (record: Record<string, string>): void;
  /** Display HTML content */
  html(html: string): void;
  /** Display an image from a buffer (defaults to image/png) */
  image(buffer: Buffer | Uint8Array, mime?: string): void;
  /** Display Markdown content */
  markdown(md: string): void;
  /** Display a JSON object */
  json(obj: any): void;
  /** Display SVG content */
  svg(svg: string): void;
  /** Render an interactive Plotly chart */
  plotly(data: Plotly.Data[], layout?: Partial<Plotly.Layout>, config?: Partial<Plotly.Config>): void;
}

declare const display: DisplayFunction;
`;

const AMBIENT_FILE = "/___bunbook_ambient___.d.ts";

// How long a file's mtime is trusted before being checked again. The language
// service asks for every file's version on each request (every keystroke), so
// this keeps a large dependency graph from being stat'ed on each one.
const MTIME_CACHE_MS = 1000;

export class VirtualLanguageServiceHost implements TS.LanguageServiceHost {
  private _content = "";
  private _version = 0;
  private _cellOffsets: { cellIndex: number; start: number; length: number }[] =
    [];
  private readonly _mtimes = new Map<string, { version: string; checkedAt: number }>();

  readonly virtualFile: string;

  constructor(
    private readonly _ts: typeof TS,
    readonly cwd: string,
    private readonly _options: TS.CompilerOptions,
    private readonly _now: () => number = Date.now
  ) {
    this.virtualFile = path.join(cwd, VIRTUAL_FILENAME);
  }

  getCompilationSettings(): TS.CompilerOptions {
    return this._options;
  }

  getScriptFileNames(): string[] {
    return [this.virtualFile, AMBIENT_FILE];
  }

  getScriptVersion(fileName: string): string {
    if (fileName === this.virtualFile) return this._version.toString();
    if (fileName === AMBIENT_FILE) return "1";
    // Version external files by mtime so edits to them (or reinstalled
    // node_modules) are picked up without reloading the window.
    const now = this._now();
    const cached = this._mtimes.get(fileName);
    if (cached && now - cached.checkedAt < MTIME_CACHE_MS) return cached.version;
    const mtime = this._ts.sys.getModifiedTime?.(fileName);
    const version = mtime ? mtime.getTime().toString() : "0";
    this._mtimes.set(fileName, { version, checkedAt: now });
    return version;
  }

  getScriptSnapshot(fileName: string): TS.IScriptSnapshot | undefined {
    if (fileName === this.virtualFile) {
      return this._ts.ScriptSnapshot.fromString(this._content);
    }
    if (fileName === AMBIENT_FILE) {
      return this._ts.ScriptSnapshot.fromString(AMBIENT_DECLARATIONS);
    }
    const content = this._ts.sys.readFile(fileName);
    return content === undefined ? undefined : this._ts.ScriptSnapshot.fromString(content);
  }

  getCurrentDirectory(): string {
    return this.cwd;
  }

  getDefaultLibFileName(options: TS.CompilerOptions): string {
    return this._ts.getDefaultLibFilePath(options);
  }

  fileExists(p: string): boolean {
    return p === this.virtualFile || p === AMBIENT_FILE || this._ts.sys.fileExists(p);
  }

  readFile(p: string): string | undefined {
    if (p === this.virtualFile) return this._content;
    if (p === AMBIENT_FILE) return AMBIENT_DECLARATIONS;
    return this._ts.sys.readFile(p);
  }

  directoryExists(p: string): boolean {
    return this._ts.sys.directoryExists(p);
  }

  // getDirectories is intentionally not implemented: without it TypeScript does
  // not enumerate type roots for implicit type libraries, so only explicitly
  // referenced types (and `types` from the tsconfig) are loaded.

  updateVirtualFile(cells: { text: string; cellIndex: number }[]): void {
    const offsets: typeof this._cellOffsets = [];
    let pos = VIRTUAL_PREAMBLE.length;
    const parts: string[] = [];

    for (const cell of cells) {
      offsets.push({
        cellIndex: cell.cellIndex,
        start: pos,
        length: cell.text.length,
      });
      parts.push(cell.text);
      pos += cell.text.length + 1; // +1 for \n separator
    }

    this._content = VIRTUAL_PREAMBLE + parts.join("\n");
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
