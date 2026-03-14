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

export class BunbookController {
  private readonly _id = "bunbook-controller";
  private readonly _label = "TypeScript (bun)";
  private readonly _supportedLanguages = ["typescript"];
  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;
  private _worker: ChildProcess | null = null;
  private _workerCwd: string | null = null;
  private _workerReady: Promise<void> | null = null;
  private _stdoutBuffer = "";
  private _stderrBuffer = "";
  private _pendingResolve:
    | ((result: { stdout: string; stderr: string }) => void)
    | null = null;

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
    this._killWorker();
    this._controller.dispose();
  }

  restart(): void {
    this._killWorker();
    this._executionOrder = 0;
  }

  private _interrupt(): void {
    this._killWorker();
    this._executionOrder = 0;
  }

  private _killWorker(): void {
    if (this._worker) {
      this._worker.kill("SIGTERM");
      this._worker = null;
      this._workerCwd = null;
      this._workerReady = null;
      this._stdoutBuffer = "";
      this._stderrBuffer = "";
      this._pendingResolve = null;
    }
  }

  private _ensureWorker(cwd: string): Promise<void> {
    if (this._worker && this._workerCwd === cwd && this._workerReady) {
      return this._workerReady;
    }

    this._killWorker();

    const workerPath = path.join(
      this._extensionUri.fsPath,
      "out",
      "worker.ts"
    );

    this._workerReady = new Promise<void>((resolve) => {
      this._worker = spawn("bun", ["run", workerPath], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this._workerCwd = cwd;

      const onReady = (data: Buffer) => {
        const text = data.toString();
        if (text.includes("___WORKER_READY___")) {
          // Remove ready marker from buffer
          this._stdoutBuffer = text.split("___WORKER_READY___").pop() ?? "";
          resolve();
        }
      };

      this._worker!.stdout!.once("data", onReady);

      this._worker!.stdout!.on("data", (data: Buffer) => {
        this._stdoutBuffer += data.toString();
        this._tryResolve();
      });

      this._worker!.stderr!.on("data", (data: Buffer) => {
        this._stderrBuffer += data.toString();
        this._tryResolve();
      });

      this._worker!.on("exit", () => {
        this._worker = null;
        this._workerCwd = null;
        this._workerReady = null;
      });
    });

    return this._workerReady;
  }

  private _tryResolve(): void {
    if (!this._pendingResolve) return;

    const outStart = this._stdoutBuffer.indexOf(OUT_START);
    const outEnd = this._stdoutBuffer.indexOf(OUT_END);
    const errStart = this._stderrBuffer.indexOf(ERR_START);
    const errEnd = this._stderrBuffer.indexOf(ERR_END);

    if (outStart !== -1 && outEnd !== -1 && errStart !== -1 && errEnd !== -1) {
      const stdout = this._stdoutBuffer.slice(
        outStart + OUT_START.length,
        outEnd
      );
      const stderr = this._stderrBuffer.slice(
        errStart + ERR_START.length,
        errEnd
      );

      this._stdoutBuffer = this._stdoutBuffer.slice(
        outEnd + OUT_END.length
      );
      this._stderrBuffer = this._stderrBuffer.slice(
        errEnd + ERR_END.length
      );

      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      resolve({ stdout, stderr });
    }
  }

  private async _eval(
    code: string,
    token: vscode.CancellationToken
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      if (!this._worker?.stdin) {
        reject(new Error("Worker not running"));
        return;
      }

      this._pendingResolve = resolve;

      const cancelDisposable = token.onCancellationRequested(() => {
        this._pendingResolve = null;
        this._killWorker();
        reject(new Error("Execution cancelled."));
      });

      this._worker.stdin.write(EVAL_START + code + EVAL_END);

      // Clean up cancel listener when resolved
      const origResolve = this._pendingResolve;
      this._pendingResolve = (result) => {
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

    const notebookDir = path.dirname(notebook.uri.fsPath);

    try {
      await this._ensureWorker(notebookDir);

      const code = cell.document.getText();
      const { stdout, stderr } = await this._eval(code, execution.token);

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
