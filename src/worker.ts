// Persistent Bun worker that reads code from stdin and evals it.
// Protocol: code is delimited by ___EVAL_START___ and ___EVAL_END___ markers on stdin.
// Output is delimited by ___OUT_START___ / ___OUT_END___ and ___ERR_START___ / ___ERR_END___.
//
// To share state across cells, we rewrite top-level const/let/class declarations
// to var (which persists on globalThis in indirect eval) and use Bun.Transpiler
// to convert TypeScript to JavaScript before eval.

import { transformDeclarations, extractVarNames } from "./transformCode.js";

const EVAL_START = "___EVAL_START___";
const EVAL_END = "___EVAL_END___";

const transpiler = new Bun.Transpiler({ loader: "ts" });

// Provide Plotly.newPlot globally so cells can call it directly.
// Instead of rendering, it serializes the data as a marker for the renderer.
// Uses process.stdout.write (not console.log, which truncates large arrays).
(globalThis as any).Plotly = {
  newPlot(data: any[], layout?: any, config?: any) {
    const json = JSON.stringify({ data, layout, config });
    process.stdout.write("___PLOTLY_OUTPUT___" + json + "___END_PLOTLY___");
  },
};

// Resolve a module specifier to an absolute path from the notebook's cwd.
function resolveImportPath(specifier: string): string {
  try {
    return Bun.resolveSync(specifier, process.cwd());
  } catch {
    return specifier;
  }
}

// Replace import.meta references which are not valid in eval context.
function replaceImportMeta(code: string): string {
  return code
    .replace(/\bimport\.meta\.dir\b/g, "process.cwd()")
    .replace(/\bimport\.meta\.file\b/g, "__filename")
    .replace(/\bimport\.meta\.url\b/g, `"file://" + process.cwd() + "/"`)
    .replace(/\bimport\.meta\.path\b/g, "process.cwd()")
    .replace(/\bimport\.meta\b/g, `({ dir: process.cwd(), file: __filename, url: "file://" + process.cwd() + "/", path: process.cwd() })`);
}

let buffer = "";
let processing = false;
const queue: string[] = [];

// Helper: write to stdout/stderr via process (Node-style) and wait for flush.
// All output (markers, user code, Plotly) goes through process.stdout/stderr
// to avoid ordering issues between Bun.write and process.stdout.write.
function writeOut(data: string): Promise<void> {
  return new Promise((r) => { process.stdout.write(data, () => r()); });
}
function writeErr(data: string): Promise<void> {
  return new Promise((r) => { process.stderr.write(data, () => r()); });
}

async function processCode(code: string) {
  await Bun.sleep(0);

  await writeOut("\n___OUT_START___\n");
  await writeErr("\n___ERR_START___\n");

  try {
    // Transpile TS -> JS, then rewrite declarations for persistence
    const js = transpiler.transformSync(code);
    const rewritten = transformDeclarations(js, resolveImportPath);
    // Replace import.meta after AST transform (string-level is fine here)
    const final = replaceImportMeta(rewritten);

    // Use indirect eval for global scope. Wrap in async IIFE to support
    // top-level await and dynamic imports. Var declarations inside the IIFE
    // are captured and assigned to globalThis so they persist across cells.
    const indirectEval = eval;

    // Extract var names to hoist to globalThis after the IIFE runs
    const varNames = extractVarNames(final);
    const hoistCode = varNames
      .map((n) => `globalThis.${n} = ${n};`)
      .join("\n");
    const wrapped = `(async () => {\n${final}\n${hoistCode}\n})()`;
    await indirectEval(wrapped);
  } catch (err: any) {
    const msg = err?.stack ?? err?.message ?? String(err);
    console.error(msg);
  }

  await writeOut("\n___OUT_END___\n");
  await writeErr("\n___ERR_END___\n");
}

async function processQueue() {
  if (processing) return;
  processing = true;
  while (queue.length > 0) {
    const code = queue.shift()!;
    await processCode(code);
  }
  processing = false;
}

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk: string) => {
  buffer += chunk;

  while (true) {
    const startIdx = buffer.indexOf(EVAL_START);
    const endIdx = buffer.indexOf(EVAL_END);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) break;

    const code = buffer.slice(startIdx + EVAL_START.length, endIdx);
    buffer = buffer.slice(endIdx + EVAL_END.length);
    queue.push(code);
  }

  processQueue();
});

process.stdout.write("___WORKER_READY___\n");
