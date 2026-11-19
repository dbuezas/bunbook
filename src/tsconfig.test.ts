import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as ts from "typescript";
import { VirtualLanguageServiceHost } from "./languageServiceHost";
import { findTsconfig, resolveCompilerOptions, type TsconfigSettings } from "./tsconfig";

const EXTENSION_PATH = "/fake/extension";

let root: string;

function write(rel: string, content: string): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function settings(overrides: Partial<TsconfigSettings> = {}): TsconfigSettings {
  return { useTsconfig: true, tsconfigPath: "", baseDir: root, ...overrides };
}

/** Creates a language service over `cells` the way the extension does. */
function serviceFor(notebookDir: string, cells: string[], s = settings()) {
  const configPath = findTsconfig(ts, notebookDir, s);
  const { options } = resolveCompilerOptions(ts, {
    notebookDir,
    extensionPath: EXTENSION_PATH,
    configPath,
  });
  let now = 0;
  const host = new VirtualLanguageServiceHost(ts, notebookDir, options, () => now);
  host.updateVirtualFile(cells.map((text, cellIndex) => ({ text, cellIndex })));
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const typeOf = (name: string) => {
    const content = host.readFile(host.virtualFile)!;
    const info = service.getQuickInfoAtPosition(host.virtualFile, content.indexOf(name));
    return info ? ts.displayPartsToString(info.displayParts) : undefined;
  };
  return { host, service, typeOf, advanceClock: (ms: number) => (now += ms) };
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "bunbook-tsconfig-")));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("findTsconfig", () => {
  test("finds the nearest tsconfig.json in a parent directory", () => {
    const config = write("tsconfig.json", "{}");
    fs.mkdirSync(path.join(root, "notebooks", "deep"), { recursive: true });
    expect(findTsconfig(ts, path.join(root, "notebooks", "deep"), settings())).toBe(config);
  });

  test("prefers a tsconfig.json closer to the notebook", () => {
    write("tsconfig.json", "{}");
    const closer = write("notebooks/tsconfig.json", "{}");
    expect(findTsconfig(ts, path.join(root, "notebooks"), settings())).toBe(closer);
  });

  test("resolves an explicit relative path against baseDir", () => {
    write("notebooks/tsconfig.json", "{}");
    const explicit = write("config/tsconfig.notebooks.json", "{}");
    const found = findTsconfig(
      ts,
      path.join(root, "notebooks"),
      settings({ tsconfigPath: "config/tsconfig.notebooks.json" })
    );
    expect(found).toBe(explicit);
  });

  test("returns undefined when the explicit path does not exist", () => {
    write("tsconfig.json", "{}");
    expect(findTsconfig(ts, root, settings({ tsconfigPath: "missing.json" }))).toBeUndefined();
  });

  test("returns undefined when useTsconfig is disabled", () => {
    write("tsconfig.json", "{}");
    expect(findTsconfig(ts, root, settings({ useTsconfig: false }))).toBeUndefined();
  });
});

describe("resolveCompilerOptions", () => {
  test("uses BunBook defaults when there is no tsconfig", () => {
    const { options, configPath, errors } = resolveCompilerOptions(ts, {
      notebookDir: root,
      extensionPath: EXTENSION_PATH,
      configPath: undefined,
    });
    expect(configPath).toBeUndefined();
    expect(errors).toEqual([]);
    expect(options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
    expect(options.strict).toBe(false);
    expect(options.lib).toEqual(["lib.es2022.d.ts"]);
    expect(options.typeRoots).toEqual([
      path.join(root, "node_modules", "@types"),
      path.join(root, "node_modules"),
      path.join(EXTENSION_PATH, "node_modules", "@types"),
      path.join(EXTENSION_PATH, "node_modules"),
    ]);
  });

  test("tsconfig options override defaults, and emit options are forced off", () => {
    const configPath = write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          strict: true,
          composite: true,
          declaration: true,
          noEmit: false,
          typeRoots: ["./types"],
        },
      })
    );
    const { options, errors } = resolveCompilerOptions(ts, {
      notebookDir: root,
      extensionPath: EXTENSION_PATH,
      configPath,
    });
    expect(errors).toEqual([]);
    expect(options.strict).toBe(true);
    expect(options.noEmit).toBe(true);
    expect(options.composite).toBe(false);
    expect(options.declaration).toBe(false);
    // Defaults the tsconfig does not set are kept.
    expect(options.lib).toEqual(["lib.es2022.d.ts"]);
    // The tsconfig's type roots come first, BunBook's are appended.
    expect(options.typeRoots).toEqual([
      path.join(root, "types"),
      path.join(EXTENSION_PATH, "node_modules", "@types"),
      path.join(EXTENSION_PATH, "node_modules"),
    ]);
  });

  test("does not report 'no inputs found' for configs whose include matches nothing", () => {
    const configPath = write("tsconfig.json", JSON.stringify({ include: ["src/**/*"] }));
    const { errors } = resolveCompilerOptions(ts, {
      notebookDir: root,
      extensionPath: EXTENSION_PATH,
      configPath,
    });
    expect(errors).toEqual([]);
  });

  test("falls back to defaults and reports errors for an unreadable tsconfig", () => {
    const configPath = write("tsconfig.json", "{ not json");
    const { options, configPath: used, errors } = resolveCompilerOptions(ts, {
      notebookDir: root,
      extensionPath: EXTENSION_PATH,
      configPath,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(used).toBeUndefined();
    expect(options.moduleResolution).toBe(ts.ModuleResolutionKind.Bundler);
  });
});

describe("language service with tsconfig", () => {
  test("resolves `paths` aliases declared in an extended tsconfig", () => {
    write("packages/sdk/src/client.ts", "export class Client { connect(): void {} }\n");
    write(
      "tsconfig.base.json",
      JSON.stringify({ compilerOptions: { paths: { "@sdk/*": ["./packages/sdk/src/*"] } } })
    );
    write("notebooks/tsconfig.json", JSON.stringify({ extends: "../tsconfig.base.json" }));

    const { typeOf, service, host } = serviceFor(path.join(root, "notebooks"), [
      'import { Client } from "@sdk/client";',
      "const client = new Client();",
    ]);

    expect(typeOf("client =")).toBe("const client: Client");
    const errors = service.getSemanticDiagnostics(host.virtualFile);
    expect(errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });

  test("without a tsconfig, `paths` aliases do not resolve", () => {
    write("packages/sdk/src/client.ts", "export class Client {}\n");
    fs.mkdirSync(path.join(root, "notebooks"));
    const { typeOf } = serviceFor(path.join(root, "notebooks"), [
      'import { Client } from "@sdk/client";',
      "const client = new Client();",
    ]);
    expect(typeOf("client =")).toBe("const client: any");
  });

  test("picks up changes to dependencies on disk without recreating the service", () => {
    const dep = write("notebooks/lib.ts", "export const value = 1;\n");
    fs.utimesSync(dep, new Date(1_000_000), new Date(1_000_000));
    const { typeOf, host, advanceClock } = serviceFor(path.join(root, "notebooks"), [
      'import { value } from "./lib";',
      "const copy = value;",
    ]);
    expect(typeOf("copy =")).toBe("const copy: 1");

    fs.writeFileSync(dep, 'export const value = "changed";\n');
    fs.utimesSync(dep, new Date(2_000_000), new Date(2_000_000));
    advanceClock(5_000);
    // Any edit to the notebook triggers a new program.
    host.updateVirtualFile([
      { text: 'import { value } from "./lib";', cellIndex: 0 },
      { text: "const copy = value;", cellIndex: 1 },
    ]);
    expect(typeOf("copy =")).toBe('const copy: "changed"');
  });
});
