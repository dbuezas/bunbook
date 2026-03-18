import { defineCommand, runMain } from "citty";
import run from "./commands/run";
import exportTs from "./commands/export-ts";
import importTs from "./commands/import-ts";
import exportHtml from "./commands/export-html";
import exportMd from "./commands/export-md";
import removeOutputs from "./commands/remove-outputs";

const main = defineCommand({
  meta: {
    name: "bunbook",
    description: "TypeScript notebook runner and converter",
  },
  subCommands: {
    run,
    "export-ts": exportTs,
    "import-ts": importTs,
    "export-html": exportHtml,
    "export-md": exportMd,
    "remove-outputs": removeOutputs,
  },
});

runMain(main);
