import * as vscode from "vscode";
import { BunbookSerializer } from "./serializer";
import { BunbookController } from "./controller";
import { BunbookIntellisense } from "./intellisense";

let controller: BunbookController;
let intellisense: BunbookIntellisense;

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

  context.subscriptions.push(
    vscode.commands.registerCommand("bunbook.restartKernel", () => {
      const notebook = vscode.window.activeNotebookEditor?.notebook;
      controller.restart(notebook);
    })
  );

  intellisense = new BunbookIntellisense(context.extensionUri.fsPath);
  context.subscriptions.push({ dispose: () => intellisense.dispose() });
}

export function deactivate() {}
