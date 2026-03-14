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
(globalThis as any).Plotly = {
  newPlot(data: any[], layout?: any, config?: any) {
    const json = JSON.stringify({ data, layout, config });
    process.stdout.write("___PLOTLY_OUTPUT___" + json + "___END_PLOTLY___");
  },
};

// Rewrite const/let to var so declarations persist across evals on globalThis.
// Also rewrite class Foo to var Foo = class Foo.
function rewriteDeclarations(code: string): string {
  return code
    .replace(/^(export\s+)?(const|let)\s+/gm, "var ")
    .replace(/^(export\s+)?class\s+(\w+)/gm, "var $2 = class $2");
}

let buffer = "";
let processing = false;
const queue: string[] = [];

async function processCode(code: string) {
  await Bun.sleep(0);

  await Bun.write(Bun.stdout, "\n___OUT_START___\n");
  await Bun.write(Bun.stderr, "\n___ERR_START___\n");

  try {
    // Transpile TS -> JS, then rewrite declarations for persistence
    const js = transpiler.transformSync(code);
    const rewritten = rewriteDeclarations(js);
    // Indirect eval for global scope (var declarations persist on globalThis)
    const indirectEval = eval;
    // If code uses await, wrap in async IIFE. Var declarations inside the IIFE
    // won't leak to global scope, so we extract them and assign to globalThis.
    if (/\bawait\b/.test(rewritten)) {
      // For async code, assign vars to globalThis explicitly
      const asyncWrapped = `(async () => {\n${rewritten}\n})()`;
      await indirectEval(asyncWrapped);
    } else {
      indirectEval(rewritten);
    }
  } catch (err: any) {
    const msg = err?.stack ?? err?.message ?? String(err);
    console.error(msg);
  }

  await Bun.sleep(0);

  await Bun.write(Bun.stdout, "\n___OUT_END___\n");
  await Bun.write(Bun.stderr, "\n___ERR_END___\n");
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
