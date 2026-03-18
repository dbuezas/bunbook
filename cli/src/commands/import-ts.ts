import { defineCommand } from "citty";
import * as path from "path";
import * as fs from "fs";
import { typeScriptToNotebook } from "../../../src/exportImport";

export default defineCommand({
  meta: {
    name: "import-ts",
    description: "Convert a .ts file (with // %% separators) to a notebook",
  },
  args: {
    input: {
      type: "positional",
      description: "Path to the TypeScript file",
      required: true,
    },
    output: {
      type: "string",
      alias: "o",
      description: "Output file path (defaults to <input>.no-output.ipynb)",
    },
  },
  run({ args }) {
    const inputPath = path.resolve(args.input);
    const outputPath = args.output ? path.resolve(args.output) : inputPath.replace(/\.ts$/, ".no-output.ipynb");

    const content = fs.readFileSync(inputPath, "utf-8");
    const notebook = typeScriptToNotebook(content);

    fs.writeFileSync(outputPath, JSON.stringify(notebook, null, 1) + "\n", "utf-8");
    console.error(`[bunbook] Written ${notebook.cells.length} cells to ${path.basename(outputPath)}`);
  },
});
