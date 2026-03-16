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
  private readonly _label = "TypeScript (Bun)";
  private readonly _supportedLanguages = ["typescript"];
  private readonly _bunbookController: vscode.NotebookController;
  private readonly _jupyterController: vscode.NotebookController;
  private _executionOrder = 0;
  private readonly _workers = new Map<string, WorkerState>();
  private readonly _outputChannel: vscode.OutputChannel;
  private _onWorkersChanged: (() => void) | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._outputChannel = vscode.window.createOutputChannel("BunBook Worker");

    this._bunbookController = vscode.notebooks.createNotebookController(
      "bunbook-no-output-controller",
      "bunbook",
      this._label
    );
    this._setupController(this._bunbookController);

    this._jupyterController = vscode.notebooks.createNotebookController(
      "bunbook-jupyter-controller",
      "jupyter-notebook",
      this._label
    );
    this._setupController(this._jupyterController);
  }

  private _setupController(controller: vscode.NotebookController): void {
    controller.supportedLanguages = this._supportedLanguages;
    controller.supportsExecutionOrder = true;
    controller.executeHandler = this._executeAll.bind(this);
    controller.interruptHandler = this._interrupt.bind(this);
  }

  set onWorkersChanged(cb: (() => void) | undefined) {
    this._onWorkersChanged = cb;
  }

  hasWorker(notebookUri: string): boolean {
    return this._workers.has(notebookUri);
  }

  killWorkerByUri(notebookUri: string): void {
    this._killWorker(notebookUri);
  }

  dispose(): void {
    for (const key of this._workers.keys()) {
      this._killWorker(key);
    }
    this._bunbookController.dispose();
    this._jupyterController.dispose();
    this._outputChannel.dispose();
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
    this._onWorkersChanged?.();
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

    state.ready = new Promise<void>((resolve, reject) => {
      state.worker.stdout!.on("data", (data: Buffer) => {
        const text = data.toString();
        this._outputChannel.append(`[stdout] ${text}`);
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
        const text = data.toString();
        this._outputChannel.append(`[stderr] ${text}`);
        state.stderrBuffer += text;
        this._tryResolve(state);
      });

      state.worker.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          this._workers.delete(key);
          reject(new Error("Bun not found"));
        }
      });

      state.worker.on("exit", (code) => {
        this._outputChannel.appendLine(`[worker] exited with code ${code}`);
        this._workers.delete(key);
        this._onWorkersChanged?.();
        if (!ready) {
          reject(new Error(`Worker exited with code ${code} before becoming ready. Check "BunBook Worker" output for details.`));
        }
      });
    });

    this._workers.set(key, state);
    this._onWorkersChanged?.();
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
    controller: vscode.NotebookController
  ): Promise<void> {
    const execution = controller.createNotebookCellExecution(cell);
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
      if (message === "Bun not found") {
        const installCmd = process.platform === "win32"
          ? "powershell -c \"irm bun.sh/install.ps1 | iex\""
          : "curl -fsSL https://bun.sh/install | bash";
        const action = await vscode.window.showErrorMessage(
          `Bun is not installed. It is required to run BunBook cells. Will run: ${installCmd}`,
          "Install Bun"
        );
        if (action === "Install Bun") {
          const terminal = vscode.window.createTerminal("Install Bun");
          terminal.show();
          terminal.sendText(installCmd);
        }
      }
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stderr(message),
        ]),
      ]);
      execution.end(false, Date.now());
    }
  }
}
