import * as vscode from "vscode";
import { TsNotebookSerializer } from "./serializer";
import { TsNotebookController } from "./controller";

let controller: TsNotebookController;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
      "ts-notebook",
      new TsNotebookSerializer(),
      { transientOutputs: true }
    )
  );

  controller = new TsNotebookController();
  context.subscriptions.push({ dispose: () => controller.dispose() });
}

export function deactivate() {}
