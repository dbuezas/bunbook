import { join } from "path";
import { copyFileSync, mkdirSync } from "fs";

const args = process.argv.slice(2);
const production = args.includes("--production");

const root = join(import.meta.dir, "..");

// Bundle the CLI entry point (all shared src/ modules are inlined)
const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  format: "esm",
  target: "node",
  sourcemap: production ? "none" : "linked",
  minify: production,
  naming: "index.js",
  banner: "#!/usr/bin/env bun",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Copy worker.ts and transformCode.js from the parent extension package.
// The worker is run directly by bun, so it must stay as TypeScript.
// transformCode.js is the bundled ESM that worker.ts imports at runtime.
mkdirSync("dist", { recursive: true });
copyFileSync(join(root, "src/worker.ts"), "dist/worker.ts");

// transformCode.js must be built first in the parent — run parent build if missing
const transformCodePath = join(root, "out/transformCode.js");
try {
  copyFileSync(transformCodePath, "dist/transformCode.js");
} catch {
  console.error("Error: out/transformCode.js not found. Run `bun run compile` in the root first.");
  process.exit(1);
}

console.log("Build complete.");
