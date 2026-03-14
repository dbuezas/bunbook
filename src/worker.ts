// Persistent Bun worker that reads code from stdin and evals it.
// Protocol: code is delimited by ___EVAL_START___ and ___EVAL_END___ markers on stdin.
// Output is delimited by ___OUT_START___ / ___OUT_END___ and ___ERR_START___ / ___ERR_END___.
//
// To share state across cells, we rewrite top-level const/let/class declarations
// to var (which persists on globalThis in indirect eval) and use Bun.Transpiler
// to convert TypeScript to JavaScript before eval.

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
  const unquoted = specifier.slice(1, -1); // strip quotes
  const quote = specifier[0];
  try {
    const resolved = Bun.resolveSync(unquoted, process.cwd());
    return `${quote}${resolved}${quote}`;
  } catch {
    return specifier;
  }
}

// Rewrite const/let to var so declarations persist across evals on globalThis.
// Also rewrite class Foo to var Foo = class Foo.
// Also rewrite static imports to dynamic await import() so they work in eval.
function rewriteDeclarations(code: string): string {
  return code
    .replace(
      /^import\s+(\{[^}]+\})\s+from\s+(['"][^'"]+['"])\s*;?$/gm,
      (_, bindings, spec) => {
        // Convert import-style "as" to destructuring-style ":"
        // e.g. { foo as bar } -> { foo: bar }
        const destructured = bindings.replace(/\bas\b/g, ":");
        return `var ${destructured} = await import(${resolveImportPath(spec)});`;
      }
    )
    .replace(
      /^import\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?$/gm,
      (_, name, spec) => `var ${name} = (await import(${resolveImportPath(spec)})).default;`
    )
    .replace(
      /^import\s+\*\s+as\s+(\w+)\s+from\s+(['"][^'"]+['"])\s*;?$/gm,
      (_, name, spec) => `var ${name} = await import(${resolveImportPath(spec)});`
    )
    .replace(/^import\s+(['"][^'"]+['"])\s*;?$/gm, "")
    .replace(/^(export\s+)?(const|let)\s+/gm, "var ")
    .replace(/^(export\s+)?class\s+(\w+)/gm, "var $2 = class $2")
    .replace(/^(export\s+)?(async\s+)?function\s+(\w+)/gm, (_, _exp, async_, name) =>
      `var ${name} = ${async_ ?? ""}function ${name}`
    )
    // import.meta is not valid in eval context; replace with Bun equivalents
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
    const rewritten = rewriteDeclarations(js);
    // Use indirect eval for global scope. Wrap in async IIFE to support
    // top-level await and dynamic imports. Var declarations inside the IIFE
    // are captured and assigned to globalThis so they persist across cells.
    const indirectEval = eval;
    // Extract var names to hoist to globalThis after the IIFE runs
    const varNames: string[] = [];
    rewritten.replace(/^var\s+(?:\{([^}]+)\}|(\w+))/gm, (_, destructured, simple) => {
      if (simple) varNames.push(simple);
      if (destructured) {
        // Handle destructured: { a, b: c } -> extract a, c
        destructured.split(",").forEach((part: string) => {
          const name = part.includes(":") ? part.split(":").pop()!.trim() : part.trim();
          if (name) varNames.push(name);
        });
      }
      return "";
    });
    const hoistCode = varNames
      .map((n) => `globalThis.${n} = ${n};`)
      .join("\n");
    const wrapped = `(async () => {\n${rewritten}\n${hoistCode}\n})()`;
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
