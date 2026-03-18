import { defineCommand } from "citty";
import * as path from "path";
import * as fs from "fs";
import { parseIpynb } from "../../../src/ipynb";
import { notebookToMarkdown } from "../../../src/exportImport";
import { runNotebook } from "../runNotebook";

export default defineCommand({
  meta: {
    name: "export-md",
    description: "Export notebook to .md",
  },
  args: {
    input: {
      type: "positional",
      description: "Path to the notebook (.ipynb)",
      required: true,
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output file path (defaults to <input>.md)",
    },
    run: {
      type: "boolean",
      description: "Execute the notebook before exporting",
    },
  },
  async run({ args }) {
    const inputPath = path.resolve(args.input);
    const outputPath = args.output ? path.resolve(args.output) : inputPath.replace(/\.no-output\.ipynb$|\.ipynb$/, ".md");

    const notebook = args.run
      ? await runNotebook(inputPath, inputPath)
      : parseIpynb(fs.readFileSync(inputPath, "utf-8"));
    if (!notebook) { console.error(`Error: could not parse notebook: ${inputPath}`); process.exit(1); }

    fs.writeFileSync(outputPath, notebookToMarkdown(notebook.cells), "utf-8");
    console.error(`[bunbook] Written to ${path.basename(outputPath)}`);
  },
});
