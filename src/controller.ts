import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn } from "child_process";
import { parseOutput } from "./outputParser";

const RUNTIME_HELPERS = `
function display(plotlyData: { data: any[]; layout?: any }) {
  const json = JSON.stringify(plotlyData);
  process.stdout.write("___PLOTLY_OUTPUT___" + json + "___END_PLOTLY___");
}
`;

export class TsNotebookController {
  private readonly _id = "ts-notebook-controller";
  private readonly _label = "TypeScript (bun)";
  private readonly _supportedLanguages = ["typescript"];
  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;

  constructor() {
    this._controller = vscode.notebooks.createNotebookController(
      this._id,
      "ts-notebook",
      this._label
    );
    this._controller.supportedLanguages = this._supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    this._controller.executeHandler = this._executeAll.bind(this);
  }

  dispose(): void {
    this._controller.dispose();
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

    // Accumulate all code cells from 0..current cell index
    const codeCells: string[] = [];
    for (let i = 0; i < notebook.cellCount; i++) {
      const c = notebook.cellAt(i);
      if (c.kind === vscode.NotebookCellKind.Code) {
        codeCells.push(c.document.getText());
        if (c === cell) break;
      }
    }

    const fullCode = RUNTIME_HELPERS + "\n" + codeCells.join("\n\n");

    // Write to temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `tsbook-${Date.now()}.mts`);

    try {
      fs.writeFileSync(tmpFile, fullCode, "utf-8");
    } catch (err) {
      execution.replaceOutput([
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.stderr(`Failed to write temp file: ${err}`),
        ]),
      ]);
      execution.end(false, Date.now());
      return;
    }

    const notebookDir = path.dirname(notebook.uri.fsPath);

    try {
      const { stdout, stderr, exitCode } = await this._runTsx(
        tmpFile,
        notebookDir,
        execution.token
      );

      const outputs = parseOutput(stdout);

      if (stderr.trim()) {
        outputs.push(
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr(stderr.trim()),
          ])
        );
      }

      execution.replaceOutput(outputs);
      execution.end(exitCode === 0, Date.now());
    } catch (err: unknown) {
      if (execution.token.isCancellationRequested) {
        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr("Execution cancelled."),
          ]),
        ]);
        execution.end(false, Date.now());
      } else {
        const message = err instanceof Error ? err.message : String(err);
        execution.replaceOutput([
          new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.stderr(message),
          ]),
        ]);
        execution.end(false, Date.now());
      }
    } finally {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private _runTsx(
    filePath: string,
    cwd: string,
    token: vscode.CancellationToken
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn("bun", ["run", filePath], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      const cancelDisposable = token.onCancellationRequested(() => {
        child.kill("SIGTERM");
      });

      child.on("close", (code) => {
        cancelDisposable.dispose();
        if (token.isCancellationRequested) {
          reject(new Error("Execution cancelled."));
        } else {
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        }
      });

      child.on("error", (err) => {
        cancelDisposable.dispose();
        reject(err);
      });
    });
  }
}
