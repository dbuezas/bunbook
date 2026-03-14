import { watch } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const watchMode = args.includes("--watch");
const production = args.includes("--production");

async function build() {
  const [extension, renderer] = await Promise.all([
    Bun.build({
      entrypoints: ["src/extension.ts"],
      outdir: "out",
      external: ["vscode"],
      format: "cjs",
      target: "node",
      sourcemap: production ? "none" : "linked",
      minify: production,
      naming: "extension.js",
    }),
    Bun.build({
      entrypoints: ["src/renderer/index.ts"],
      outdir: "out/renderer",
      format: "esm",
      target: "browser",
      sourcemap: production ? "none" : "linked",
      minify: production,
      naming: "index.js",
    }),
  ]);

  // Copy worker.ts as-is (Bun runs it directly, no bundling needed)
  await Bun.write("out/worker.ts", Bun.file("src/worker.ts"));

  const results = [extension, renderer];
  const errors = results.flatMap((r) =>
    r.logs.filter((l) => l.level === "error")
  );
  if (results.some((r) => !r.success)) {
    for (const e of errors) console.error(e);
    return false;
  }
  return true;
}

const ok = await build();
if (!watchMode) {
  console.log(ok ? "Build complete." : "Build failed.");
  process.exit(ok ? 0 : 1);
}

console.log("Watching for changes...");

let debounce: Timer | null = null;
watch(join(import.meta.dir, "src"), { recursive: true }, () => {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(async () => {
    const ok = await build();
    console.log(ok ? "Rebuilt." : "Build failed.");
  }, 100);
});
