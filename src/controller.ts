import * as vscode from "vscode";
import * as path from "path";
import { spawn, ChildProcess } from "child_process";
import { parseOutput } from "./outputParser";

const EVAL_START = "___EVAL_START___";
const EVAL_END = "___EVAL_END___";
const OUT_START = "___OUT_START___";
const OUT_END = "___OUT_END___";
const ERR_START = "___ERR_START___";
const ERR_END = "___ERR_END___";

interface WorkerState {
  worker: ChildProcess;
  ready: Promise<void>;
  stdoutBuffer: string;
  stderrBuffer: string;
  pendingResolve:
    | ((result: { stdout: string; stderr: string }) => void)
    | null;
  pendingReject: ((err: Error) => void) | null;
}

export class BunbookController {
  private readonly _id = "bunbook-controller";
  private readonly _label = "TypeScript (bun)";
  private readonly _supportedLanguages = ["bunbook-typescript"];
  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private readonly _workers = new Map<string, WorkerState>();

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._controller = vscode.notebooks.createNotebookController(
      this._id,
      "bunbook",
      this._label
    );
    this._controller.supportedLanguages = this._supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);
    this._controller.interruptHandler = this._interrupt.bind(this);
  }

  dispose(): void {
    for (const key of this._workers.keys()) {
      this._killWorker(key);
    }
    this._controller.dispose();
  }

  restart(notebook?: vscode.NotebookDocument): void {
    if (notebook) {
      this._killWorker(notebook.uri.toString());
    } else {
      for (const key of this._workers.keys()) {
        this._killWorker(key);
      }
    }
    this._executionOrder = 0;
  }

  private _interrupt(): void {
    for (const key of this._workers.keys()) {
      this._killWorker(key);
    }
    this._executionOrder = 0;
  }

  private _killWorker(notebookUri: string): void {
    const state = this._workers.get(notebookUri);
    if (!state) return;

    state.worker.kill("SIGTERM");
    const reject = state.pendingReject;
    this._workers.delete(notebookUri);
    if (reject) reject(new Error("Worker restarted"));
  }

  private _ensureWorker(notebook: vscode.NotebookDocument): Promise<void> {
    const key = notebook.uri.toString();
    const existing = this._workers.get(key);
    if (existing) return existing.ready;

    const cwd = path.dirname(notebook.uri.fsPath);
    const workerPath = path.join(
      this._extensionUri.fsPath,
      "out",
      "worker.ts"
    );

    const state: WorkerState = {
      worker: spawn("bun", ["run", workerPath], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      }),
      ready: null!,
      stdoutBuffer: "",
      stderrBuffer: "",
      pendingResolve: null,
      pendingReject: null,
    };

    let ready = false;

    state.ready = new Promise<void>((resolve) => {
      state.worker.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        if (!ready) {
          const idx = text.indexOf("___WORKER_READY___");
          if (idx !== -1) {
            ready = true;
            const remainder = text.slice(idx + "___WORKER_READY___".length);
            if (remainder) {
              state.stdoutBuffer += remainder;
            }
            resolve();
            this._tryResolve(state);
            return;
          }
          return;
        }
        state.stdoutBuffer += text;
        this._tryResolve(state);
      });

      state.worker.stderr!.on("data", (data: Buffer) => {
        state.stderrBuffer += data.toString();
        this._tryResolve(state);
      });

      state.worker.on("exit", () => {
        this._workers.delete(key);
      });
    });

    this._workers.set(key, state);
    return state.ready;
  }

  private _tryResolve(state: WorkerState): void {
    if (!state.pendingResolve) return;

    const outStart = state.stdoutBuffer.indexOf(OUT_START);
    const outEnd = state.stdoutBuffer.indexOf(OUT_END);
    const errStart = state.stderrBuffer.indexOf(ERR_START);
    const errEnd = state.stderrBuffer.indexOf(ERR_END);

    if (outStart !== -1 && outEnd !== -1 && errStart !== -1 && errEnd !== -1) {
      const stdout = state.stdoutBuffer.slice(
        outStart + OUT_START.length,
        outEnd
      );
      const stderr = state.stderrBuffer.slice(
        errStart + ERR_START.length,
        errEnd
      );

      state.stdoutBuffer = state.stdoutBuffer.slice(outEnd + OUT_END.length);
      state.stderrBuffer = state.stderrBuffer.slice(errEnd + ERR_END.length);

      const resolve = state.pendingResolve;
      state.pendingResolve = null;
      state.pendingReject = null;
      resolve({ stdout, stderr });
    }
  }

  private async _eval(
    state: WorkerState,
    code: string,
    token: vscode.CancellationToken
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (!state.worker.stdin) {
        reject(new Error("Worker not running"));
        return;
      }

      state.pendingResolve = resolve;
      state.pendingReject = reject;

      const cancelDisposable = token.onCancellationRequested(() => {
        state.pendingResolve = null;
        state.pendingReject = null;
        reject(new Error("Execution cancelled."));
      });

      state.worker.stdin.write(EVAL_START + code + EVAL_END);

      const origResolve = state.pendingResolve;
      state.pendingResolve = (result) => {
        cancelDisposable.dispose();
        origResolve(result);
      };
    });
  }

  private async _executeAll(
    cells: vscode.NotebookCell[],
    notebook: vscode.NotebookDocument,
    controller: vscode.NotebookController
  ): Promise<void> {
    for (const cell of cells) {
      await this._executeCell(cell, notebook, controller);
    }
  }

  private async _executeCell(
    cell: vscode.NotebookCell,
    notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    try {
      await this._ensureWorker(notebook);
      const state = this._workers.get(notebook.uri.toString());
      if (!state) throw new Error("Worker not running");

      const code = cell.document.getText();
      const { stdout, stderr } = await this._eval(state, code, execution.token);

      const outputs = parseOutput(stdout);

      if (stderr.trim()) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr(stderr.trim()),
          ])
        );
      }

      execution.replaceOutput(outputs);
      execution.end(true, Date.now());
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stderr(message),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }
}
