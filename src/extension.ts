import * as vscode from "vscode";
import { BunbookSerializer } from "./serializer";
import { BunbookController } from "./controller";
import { BunbookIntellisense } from "./intellisense";

let controller: BunbookController;
let intellisense: BunbookIntellisense;

function isNoOutputFile(uri: vscode.Uri): boolean {
  return uri.fsPath.endsWith(".no-output.ipynb");
}

function toggledUri(uri: vscode.Uri): vscode.Uri {
  if (isNoOutputFile(uri)) {
    return vscode.Uri.file(uri.fsPath.replace(/\.no-output\.ipynb$/, ".ipynb"));
  }
  return vscode.Uri.file(uri.fsPath.replace(/\.ipynb$/, ".no-output.ipynb"));
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      "bunbook",
      new BunbookSerializer(),
      { transientOutputs: true }
    )
  );

  controller = new BunbookController(context.extensionUri);
  context.subscriptions.push({ dispose: () => controller.dispose() });

  // Sync context keys for toolbar visibility
  function syncContextKeys() {
    const notebook = vscode.window.activeNotebookEditor?.notebook;
    if (!notebook) return;
    const persists = !isNoOutputFile(notebook.uri);
    vscode.commands.executeCommand("setContext", "bunbook.persistOutputs", persists);
    const hasWorker = controller.hasWorker(notebook.uri.toString());
    vscode.commands.executeCommand("setContext", "bunbook.hasWorker", hasWorker);
  }

  controller.onWorkersChanged = () => syncContextKeys();

  context.subscriptions.push(
    vscode.window.onDidChangeActiveNotebookEditor(() => syncContextKeys())
  );
  syncContextKeys();

  context.subscriptions.push(
    vscode.commands.registerCommand("bunbook.restartKernel", () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      controller.restart(notebook);
    })
  );

  // Toggle: rename between foo.ipynb and foo.no-output.ipynb.
  // Snapshots dirty cell edits, closes, renames, reopens, restores.
  async function toggleSaveOutputs() {
    const notebook = vscode.window.activeNotebookEditor?.notebook;
    if (!notebook) return;

    const oldUri = notebook.uri;
    const newUri = toggledUri(oldUri);
    const toNoOutput = isNoOutputFile(newUri);

    // Snapshot all cell contents to restore dirty edits later
    const cellTexts: string[] = [];
    for (let i = 0; i < notebook.cellCount; i++) {
      cellTexts.push(notebook.cellAt(i).document.getText());
    }

    // Kill the worker for the old URI
    controller.killWorkerByUri(oldUri.toString());

    // Revert (clears dirty flag) and close — no save prompt
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");

    // Rename file on disk
    await vscode.workspace.fs.rename(oldUri, newUri);

    // When converting to no-output, strip outputs from file
    if (toNoOutput) {
      const raw = await vscode.workspace.fs.readFile(newUri);
      const json = JSON.parse(Buffer.from(raw).toString("utf-8"));
      for (const cell of json.cells ?? []) {
        if (cell.cell_type === "code") {
          cell.outputs = [];
          cell.execution_count = null;
        }
      }
      await vscode.workspace.fs.writeFile(
        newUri,
        Buffer.from(JSON.stringify(json, null, 1) + "\n", "utf-8")
      );
    }

    // Open with the correct editor type
    await vscode.commands.executeCommand("vscode.openWith", newUri,
      toNoOutput ? "bunbook" : "jupyter-notebook"
    );

    // Wait for editor to open, then restore dirty cell edits
    const newNotebook = await new Promise<vscode.NotebookDocument | undefined>((resolve) => {
      const editor = vscode.window.activeNotebookEditor;
      if (editor?.notebook.uri.toString() === newUri.toString()) {
        resolve(editor.notebook);
        return;
      }
      const disposable = vscode.window.onDidChangeActiveNotebookEditor((e) => {
        if (e?.notebook.uri.toString() === newUri.toString()) {
          disposable.dispose();
          resolve(e.notebook);
        }
      });
      setTimeout(() => { disposable.dispose(); resolve(undefined); }, 5000);
    });

    if (newNotebook) {
      for (let i = 0; i < cellTexts.length && i < newNotebook.cellCount; i++) {
        const cell = newNotebook.cellAt(i);
        const currentText = cell.document.getText();
        if (currentText !== cellTexts[i]) {
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            cell.document.positionAt(0),
            cell.document.positionAt(currentText.length)
          );
          edit.replace(cell.document.uri, fullRange, cellTexts[i]);
          await vscode.workspace.applyEdit(edit);
        }
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("bunbook.enableSaveOutputs", toggleSaveOutputs),
    vscode.commands.registerCommand("bunbook.disableSaveOutputs", toggleSaveOutputs)
  );

  // Kill worker when a notebook is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseNotebookDocument((notebook) => {
      controller.killWorkerByUri(notebook.uri.toString());
    })
  );

  intellisense = new BunbookIntellisense(context.extensionUri.fsPath);
  context.subscriptions.push({ dispose: () => intellisense.dispose() });
}

export function deactivate() {}
