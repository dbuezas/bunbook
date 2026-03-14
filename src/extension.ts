import * as vscode from "vscode";
import { BunbookSerializer } from "./serializer";
import { BunbookController } from "./controller";

let controller: BunbookController;

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
      controller.restart();
    })
  );
}

export function deactivate() {}
