import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const CLI = join(import.meta.dir, "..", "dist", "index.js");
const HELLO_NB = join(import.meta.dir, "..", "..", "examples", "hello-world", "hello-world.ipynb");

const CLI_DIR = join(import.meta.dir, "..");

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "bunbook-cli-test-"));
  Bun.spawnSync(["bun", "run", "build"], { cwd: CLI_DIR });
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]) {
  return Bun.spawnSync(["bun", "run", CLI, ...args], {
    cwd: tmp,
    stdout: "pipe",
    stderr: "pipe",
  });
}

// ── help ────────────────────────────────────────────────────────────────

describe("help", () => {
  test("top-level --help lists subcommands", () => {
    const { stdout } = run(["--help"]);
    const out = stdout.toString();
    expect(out).toContain("run");
    expect(out).toContain("export-ts");
    expect(out).toContain("import-ts");
    expect(out).toContain("export-html");
    expect(out).toContain("export-md");
  });

  test("subcommand --help shows args", () => {
    const { stdout } = run(["export-ts", "--help"]);
    const out = stdout.toString();
    expect(out).toContain("INPUT");
    expect(out).toContain("--output");
  });
});

// ── error handling ──────────────────────────────────────────────────────

describe("error handling", () => {
  test("missing subcommand shows help", () => {
    const { stdout } = run([]);
    expect(stdout.toString()).toContain("USAGE");
  });

  test("unknown subcommand fails", () => {
    const { exitCode } = run(["blah"]);
    expect(exitCode).not.toBe(0);
  });

  test("missing required input arg fails", () => {
    const { exitCode } = run(["export-ts"]);
    expect(exitCode).not.toBe(0);
  });
});

// ── export-ts ───────────────────────────────────────────────────────────

describe("export-ts", () => {
  test("exports notebook to .ts file", () => {
    const out = join(tmp, "hello.ts");
    const { exitCode } = run(["export-ts", HELLO_NB, "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("// %%");
    expect(content).toContain("console");
  });

  test("default output path replaces .ipynb with .ts", () => {
    // Copy notebook to tmp so default output goes there
    const nbCopy = join(tmp, "test-default.ipynb");
    Bun.spawnSync(["cp", HELLO_NB, nbCopy]);
    const { exitCode } = run(["export-ts", nbCopy]);
    expect(exitCode).toBe(0);
    expect(existsSync(join(tmp, "test-default.ts"))).toBe(true);
  });
});

// ── export-html ─────────────────────────────────────────────────────────

describe("export-html", () => {
  test("exports notebook to .html file", () => {
    const out = join(tmp, "hello.html");
    const { exitCode } = run(["export-html", HELLO_NB, "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("hello-world");
  });
});

// ── export-md ───────────────────────────────────────────────────────────

describe("export-md", () => {
  test("exports notebook to .md file", () => {
    const out = join(tmp, "hello.md");
    const { exitCode } = run(["export-md", HELLO_NB, "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("```ts");
    expect(content).toContain("console");
  });
});

// ── --hide-code / --hide-output ─────────────────────────────────────────

describe("--hide-code", () => {
  test("export-html --hide-code excludes code from output", () => {
    const out = join(tmp, "hide-code.html");
    const { exitCode } = run(["export-html", HELLO_NB, "--hide-code", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).not.toContain("console.log");
    expect(content).toContain("<!DOCTYPE html>");
  });

  test("export-md --hide-code excludes code from output", () => {
    const out = join(tmp, "hide-code.md");
    const { exitCode } = run(["export-md", HELLO_NB, "--hide-code", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).not.toContain("console.log");
  });
});

describe("--hide-output", () => {
  test("export-html --run --hide-output excludes outputs", () => {
    const out = join(tmp, "hide-output.html");
    const { exitCode } = run(["export-html", HELLO_NB, "--run", "--hide-output", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("console.log");
    expect(content).not.toContain("class=\"outputs\"");
  });

  test("export-md --run --hide-output excludes outputs", () => {
    const out = join(tmp, "hide-output.md");
    const { exitCode } = run(["export-md", HELLO_NB, "--run", "--hide-output", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("console.log");
    expect(content).not.toContain("┌");
  });
}, 30_000);

// ── -r alias ────────────────────────────────────────────────────────────

describe("-r alias", () => {
  test("export-html -r works like --run", () => {
    const out = join(tmp, "alias-r.html");
    const { exitCode } = run(["export-html", HELLO_NB, "-r", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("Hello console!");
  });
}, 30_000);

// ── --run flag ──────────────────────────────────────────────────────────

describe("--run flag", () => {
  test("export-html --run produces html with outputs", () => {
    const out = join(tmp, "run-then-export.html");
    const { exitCode } = run(["export-html", HELLO_NB, "--run", "--output", out]);
    expect(exitCode).toBe(0);
    const content = readFileSync(out, "utf-8");
    expect(content).toContain("<!DOCTYPE html>");
    expect(content).toContain("Hello console!");
  });
}, 30_000);

// ── import-ts ───────────────────────────────────────────────────────────

describe("import-ts", () => {
  test("round-trip: export-ts then import-ts produces valid notebook", () => {
    const tsFile = join(tmp, "roundtrip.ts");
    const nbFile = join(tmp, "roundtrip.no-output.ipynb");

    // export to ts
    run(["export-ts", HELLO_NB, "--output", tsFile]);

    // import back
    const { exitCode } = run(["import-ts", tsFile, "--output", nbFile]);
    expect(exitCode).toBe(0);

    const nb = JSON.parse(readFileSync(nbFile, "utf-8"));
    expect(nb.cells.length).toBeGreaterThan(0);
    expect(nb.cells[0].cell_type).toBe("code");
  });
});

// ── remove-outputs ──────────────────────────────────────────────────────

describe("remove-outputs", () => {
  test("strips outputs and execution counts", () => {
    const out = join(tmp, "stripped.ipynb");
    const { exitCode } = run(["remove-outputs", HELLO_NB, "--output", out]);
    expect(exitCode).toBe(0);

    const nb = JSON.parse(readFileSync(out, "utf-8"));
    const codeCells = nb.cells.filter((c: any) => c.cell_type === "code");
    expect(codeCells.every((c: any) => c.outputs.length === 0)).toBe(true);
    expect(codeCells.every((c: any) => c.execution_count === null)).toBe(true);
  });

  test("in-place when no --output given", () => {
    const nbCopy = join(tmp, "inplace.ipynb");
    Bun.spawnSync(["cp", HELLO_NB, nbCopy]);
    const { exitCode } = run(["remove-outputs", nbCopy]);
    expect(exitCode).toBe(0);

    const nb = JSON.parse(readFileSync(nbCopy, "utf-8"));
    const codeCells = nb.cells.filter((c: any) => c.cell_type === "code");
    expect(codeCells.every((c: any) => c.outputs.length === 0)).toBe(true);
  });
});

// ── run ─────────────────────────────────────────────────────────────────

describe("run", () => {
  test("executes notebook and writes outputs", () => {
    const out = join(tmp, "executed.ipynb");
    const { exitCode, stderr } = run(["run", HELLO_NB, "--output", out]);
    expect(exitCode).toBe(0);
    expect(stderr.toString()).toContain("[bunbook]");

    const nb = JSON.parse(readFileSync(out, "utf-8"));
    const codeCells = nb.cells.filter((c: any) => c.cell_type === "code");
    expect(codeCells.length).toBeGreaterThan(0);
    // Executed cells should have outputs
    expect(codeCells[0].outputs.length).toBeGreaterThan(0);
    expect(codeCells[0].execution_count).toBe(1);
  });
}, 30_000);
