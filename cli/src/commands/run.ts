import { defineCommand } from "citty";
import * as path from "path";
import { runNotebook } from "../runNotebook";

export default defineCommand({
  meta: {
    name: "run",
    description: "Execute all cells and save outputs to .ipynb",
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
      description: "Output file path (defaults to input path)",
    },
  },
  async run({ args }) {
    const inputPath = path.resolve(args.input);
    const outputPath = args.output ? path.resolve(args.output) : inputPath;
    await runNotebook(inputPath, outputPath);
  },
});
