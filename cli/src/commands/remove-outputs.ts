import { defineCommand } from "citty";
import * as path from "path";
import * as fs from "fs";
import { parseIpynb, type IpynbCodeCell } from "../../../src/ipynb";

export default defineCommand({
  meta: {
    name: "remove-outputs",
    description: "Strip all outputs and execution counts from a notebook",
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
      description: "Output file path (defaults to input path, in-place)",
    },
  },
  run({ args }) {
    const inputPath = path.resolve(args.input);
    const outputPath = args.output ? path.resolve(args.output) : inputPath;

    const notebook = parseIpynb(fs.readFileSync(inputPath, "utf-8"));
    if (!notebook) { console.error(`Error: could not parse notebook: ${inputPath}`); process.exit(1); }

    for (const cell of notebook.cells) {
      if (cell.cell_type === "code") {
        (cell as IpynbCodeCell).outputs = [];
        (cell as IpynbCodeCell).execution_count = null;
      }
    }

    fs.writeFileSync(outputPath, JSON.stringify(notebook, null, 1) + "\n", "utf-8");
    console.error(`[bunbook] Written to ${path.basename(outputPath)}`);
  },
});
