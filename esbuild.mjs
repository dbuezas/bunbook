import * as esbuild from "esbuild";

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const production = args.includes("--production");

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: !production,
  minify: production,
};

/** @type {esbuild.BuildOptions} */
const rendererConfig = {
  entryPoints: ["src/renderer/index.ts"],
  bundle: true,
  outfile: "out/renderer/index.js",
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: !production,
  minify: production,
};

async function main() {
  if (watch) {
    const extCtx = await esbuild.context(extensionConfig);
    const renCtx = await esbuild.context(rendererConfig);
    await Promise.all([extCtx.watch(), renCtx.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(rendererConfig),
    ]);
    console.log("Build complete.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
