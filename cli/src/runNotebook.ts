import * as path from "path";
import * as fs from "fs";
import { spawn } from "child_process";
import { parseIpynb, sourceToString, stringToSourceLines, IPYNB_METADATA, type IpynbCodeCell, type IpynbOutput, type IpynbNotebook } from "../../src/ipynb";
import { parseOutputRaw, type RawOutputItem } from "../../src/outputParserRaw";

const EVAL_START = "___EVAL_START___";
const EVAL_END = "___EVAL_END___";
const OUT_START = "___OUT_START___";
const OUT_END = "___OUT_END___";
const ERR_START = "___ERR_START___";
const ERR_END = "___ERR_END___";
const WORKER_READY = "___WORKER_READY___";

function rawItemsToIpynbOutput(items: RawOutputItem[]): IpynbOutput {
  const data: Record<string, unknown> = {};
  for (const item of items) {
    if (item.mime === "text/plain" || item.mime === "text/html" || item.mime === "text/markdown") {
      data[item.mime] = stringToSourceLines(item.data);
    } else {
      data[item.mime] = item.data;
    }
  }
  return { output_type: "display_data", data, metadata: {} };
}

function textToIpynbOutput(text: string): IpynbOutput {
  return { output_type: "stream", name: "stdout", text: stringToSourceLines(text) };
}

export async function runNotebook(inputPath: string, outputPath: string) {
  if (!fs.existsSync(inputPath)) {
    console.error(`Error: file not found: ${inputPath}`);
    process.exit(1);
  }

  const text = fs.readFileSync(inputPath, "utf-8");
  const notebook = parseIpynb(text);
  if (!notebook) {
    console.error(`Error: could not parse notebook: ${inputPath}`);
    process.exit(1);
  }

  const codeCells = notebook.cells.filter((c) => c.cell_type === "code");
  console.log(`[bunbook] Running ${codeCells.length} code cells from ${path.basename(inputPath)}`);

  const workerInDist = path.join(import.meta.dir, "worker.ts");
  const workerInSource = path.join(import.meta.dir, "..", "..", "out", "worker.ts");
  const workerPath = Bun.file(workerInDist).size > 0 ? workerInDist : workerInSource;
  const cwd = path.dirname(inputPath);

  const worker = spawn("bun", ["run", workerPath], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  worker.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      console.error("Error: bun not found. Install it from https://bun.sh");
    } else {
      console.error(`Worker error: ${err.message}`);
    }
    process.exit(1);
  });

  let stdoutBuf = "";
  let stderrBuf = "";
  let pendingResolve: ((r: { stdout: string; stderr: string }) => void) | null = null;

  function tryResolve() {
    if (!pendingResolve) return;
    const outStart = stdoutBuf.indexOf(OUT_START);
    const outEnd = stdoutBuf.indexOf(OUT_END);
    const errStart = stderrBuf.indexOf(ERR_START);
    const errEnd = stderrBuf.indexOf(ERR_END);
    if (outStart === -1 || outEnd === -1 || errStart === -1 || errEnd === -1) return;

    const stdout = stdoutBuf.slice(outStart + OUT_START.length, outEnd);
    const stderr = stderrBuf.slice(errStart + ERR_START.length, errEnd);
    stdoutBuf = stdoutBuf.slice(outEnd + OUT_END.length);
    stderrBuf = stderrBuf.slice(errEnd + ERR_END.length);

    const resolve = pendingResolve;
    pendingResolve = null;
    resolve({ stdout, stderr });
  }

  worker.stdout!.on("data", (data: Buffer) => { stdoutBuf += data.toString(); tryResolve(); });
  worker.stderr!.on("data", (data: Buffer) => { stderrBuf += data.toString(); tryResolve(); });

  function evalCode(code: string): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      pendingResolve = resolve;
      worker.stdin!.write(EVAL_START + code + EVAL_END);
    });
  }

  await new Promise<void>((resolve) => {
    const check = (data: Buffer) => {
      stdoutBuf += data.toString();
      const idx = stdoutBuf.indexOf(WORKER_READY);
      if (idx !== -1) {
        stdoutBuf = stdoutBuf.slice(idx + WORKER_READY.length);
        worker.stdout!.off("data", check);
        resolve();
      }
    };
    worker.stdout!.on("data", check);
  });

  let executionCount = 1;

  for (let i = 0; i < notebook.cells.length; i++) {
    const cell = notebook.cells[i];
    if (cell.cell_type !== "code") continue;

    const source = sourceToString(cell.source);
    if (!source.trim()) {
      (cell as IpynbCodeCell).outputs = [];
      (cell as IpynbCodeCell).execution_count = null;
      continue;
    }

    process.stderr.write(`[bunbook] Cell ${executionCount}/${codeCells.length} ... `);

    const { stdout, stderr } = await evalCode(source);
    const rawOutputs = parseOutputRaw(stdout);

    const outputs: IpynbOutput[] = rawOutputs.map((o) =>
      o.items ? rawItemsToIpynbOutput(o.items) : textToIpynbOutput(o.text!)
    );

    if (stderr.trim()) {
      outputs.push({ output_type: "stream", name: "stderr", text: stringToSourceLines(stderr.trim()) });
      process.stderr.write("error\n");
    } else {
      process.stderr.write("ok\n");
    }

    (cell as IpynbCodeCell).outputs = outputs;
    (cell as IpynbCodeCell).execution_count = executionCount++;
  }

  worker.stdin!.end();
  worker.kill("SIGTERM");

  const result = { ...notebook, metadata: IPYNB_METADATA };
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 1) + "\n", "utf-8");
  console.log(`\x1b[32m[bunbook] Written to ${path.basename(outputPath)}\x1b[0m`);

  return result as IpynbNotebook;
}
