import * as path from "path";
import type * as TS from "typescript";

/**
 * Compiler options BunBook uses when no tsconfig.json applies to a notebook.
 * These mirror what the worker supports at runtime (Bun, ESM, top-level await).
 */
export function defaultCompilerOptions(ts: typeof TS): TS.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: false,
    esModuleInterop: true,
    allowJs: true,
    lib: ["lib.es2022.d.ts"],
  };
}

/**
 * Options that are always forced, whatever the tsconfig says. The language
 * service never emits, and emit-only options (composite, declaration…) would
 * only produce irrelevant diagnostics for the virtual notebook file.
 */
function forcedCompilerOptions(): TS.CompilerOptions {
  return {
    noEmit: true,
    composite: false,
    declaration: false,
    declarationMap: false,
    emitDeclarationOnly: false,
    incremental: false,
    sourceMap: false,
    inlineSourceMap: false,
  };
}

// "No inputs were found in config file": irrelevant, BunBook supplies its own virtual file.
const IGNORED_CONFIG_DIAGNOSTICS = new Set([18003]);

export interface TsconfigSettings {
  /** When false, tsconfig files are ignored and the defaults are used. */
  useTsconfig: boolean;
  /**
   * Explicit tsconfig path. Absolute, or relative to `baseDir`.
   * When empty, the nearest tsconfig.json above the notebook is used.
   */
  tsconfigPath: string;
  /** Directory relative `tsconfigPath` values resolve against (usually the workspace folder). */
  baseDir: string;
}

/**
 * Returns the tsconfig that applies to a notebook in `notebookDir`, or
 * undefined when none applies.
 */
export function findTsconfig(
  ts: typeof TS,
  notebookDir: string,
  settings: TsconfigSettings
): string | undefined {
  if (!settings.useTsconfig) return undefined;

  const explicit = settings.tsconfigPath.trim();
  if (explicit) {
    const resolved = path.resolve(settings.baseDir, explicit);
    return ts.sys.fileExists(resolved) ? resolved : undefined;
  }

  return ts.findConfigFile(notebookDir, ts.sys.fileExists, "tsconfig.json");
}

export interface ResolvedCompilerOptions {
  options: TS.CompilerOptions;
  /** The tsconfig used, if any. */
  configPath: string | undefined;
  /** Human-readable problems found while reading the tsconfig. */
  errors: string[];
}

/**
 * Builds the compiler options for a notebook's language service.
 *
 * Precedence: BunBook defaults < tsconfig < forced options. Type roots always
 * include BunBook's own (for `bun-types`, Plotly and the `display` ambient
 * declarations), appended after any the tsconfig declares.
 */
export function resolveCompilerOptions(
  ts: typeof TS,
  params: {
    notebookDir: string;
    extensionPath: string;
    configPath: string | undefined;
  }
): ResolvedCompilerOptions {
  const { notebookDir, extensionPath, configPath } = params;
  const errors: string[] = [];
  let fromConfig: TS.CompilerOptions = {};

  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) {
      errors.push(formatDiagnostic(ts, read.error));
    } else {
      const parsed = ts.parseJsonConfigFileContent(
        read.config,
        ts.sys,
        path.dirname(configPath),
        undefined,
        configPath
      );
      for (const diag of parsed.errors) {
        if (!IGNORED_CONFIG_DIAGNOSTICS.has(diag.code)) {
          errors.push(formatDiagnostic(ts, diag));
        }
      }
      fromConfig = parsed.options;
    }
  }

  const typeRoots = dedupe([
    ...(fromConfig.typeRoots ?? [
      path.join(notebookDir, "node_modules", "@types"),
      path.join(notebookDir, "node_modules"),
    ]),
    path.join(extensionPath, "node_modules", "@types"),
    path.join(extensionPath, "node_modules"),
  ]);

  return {
    options: {
      ...defaultCompilerOptions(ts),
      ...fromConfig,
      ...forcedCompilerOptions(),
      typeRoots,
    },
    configPath: errors.length > 0 && Object.keys(fromConfig).length === 0 ? undefined : configPath,
    errors,
  };
}

function formatDiagnostic(ts: typeof TS, diag: TS.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diag.messageText, "\n");
  return diag.file ? `${diag.file.fileName}: ${message}` : message;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
