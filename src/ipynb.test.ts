import { describe, expect, test } from "bun:test";
import {
  stringToSourceLines,
  sourceToString,
  parseIpynb,
  buildEmptyIpynb,
  buildIpynb,
  IPYNB_METADATA,
} from "./ipynb";

describe("stringToSourceLines", () => {
  test("empty string returns empty array", () => {
    expect(stringToSourceLines("")).toEqual([]);
  });

  test("single line without newline", () => {
    expect(stringToSourceLines("hello")).toEqual(["hello"]);
  });

  test("multi-line", () => {
    expect(stringToSourceLines("a\nb\nc")).toEqual(["a\n", "b\n", "c"]);
  });

  test("trailing newline", () => {
    expect(stringToSourceLines("a\nb\n")).toEqual(["a\n", "b\n", ""]);
  });
});

describe("sourceToString", () => {
  test("string passthrough", () => {
    expect(sourceToString("hello")).toBe("hello");
  });

  test("array join", () => {
    expect(sourceToString(["a\n", "b"])).toBe("a\nb");
  });

  test("non-string non-array returns empty string", () => {
    expect(sourceToString(42 as any)).toBe("");
  });
});

describe("parseIpynb", () => {
  test("valid notebook JSON", () => {
    const nb = { nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [] };
    const result = parseIpynb(JSON.stringify(nb));
    expect(result).toEqual(nb);
  });

  test("empty string returns null", () => {
    expect(parseIpynb("")).toBeNull();
  });

  test("whitespace-only returns null", () => {
    expect(parseIpynb("   \n  ")).toBeNull();
  });

  test("invalid JSON returns null", () => {
    expect(parseIpynb("{not json}")).toBeNull();
  });

  test("parses notebook with cells", () => {
    const nb = {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: {},
      cells: [
        { cell_type: "code", source: ["x = 1"], metadata: {}, outputs: [], execution_count: null },
      ],
    };
    const result = parseIpynb(JSON.stringify(nb));
    expect(result!.cells).toHaveLength(1);
    expect(result!.cells[0].cell_type).toBe("code");
  });
});

describe("buildEmptyIpynb", () => {
  test("returns valid nbformat 4 structure", () => {
    const nb = buildEmptyIpynb();
    expect(nb.nbformat).toBe(4);
    expect(nb.nbformat_minor).toBe(5);
    expect(nb.metadata).toEqual(IPYNB_METADATA);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].cell_type).toBe("code");
  });

  test("single cell has empty source and outputs", () => {
    const cell = buildEmptyIpynb().cells[0];
    expect(cell.source).toEqual([]);
    expect((cell as any).outputs).toEqual([]);
    expect((cell as any).execution_count).toBeNull();
  });

  test("cell has a UUID id", () => {
    const cell = buildEmptyIpynb().cells[0];
    expect(cell.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("buildIpynb", () => {
  test("code cells", () => {
    const nb = buildIpynb([{ kind: "code", text: "const x = 1" }]);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].cell_type).toBe("code");
    expect((nb.cells[0] as any).outputs).toEqual([]);
    expect(sourceToString(nb.cells[0].source)).toBe("const x = 1");
  });

  test("markdown cells", () => {
    const nb = buildIpynb([{ kind: "markdown", text: "# Hello" }]);
    expect(nb.cells).toHaveLength(1);
    expect(nb.cells[0].cell_type).toBe("markdown");
    expect((nb.cells[0] as any).outputs).toBeUndefined();
  });

  test("mixed cells", () => {
    const nb = buildIpynb([
      { kind: "code", text: "1 + 1" },
      { kind: "markdown", text: "# Title" },
      { kind: "code", text: "2 + 2" },
    ]);
    expect(nb.cells).toHaveLength(3);
    expect(nb.cells.map((c) => c.cell_type)).toEqual(["code", "markdown", "code"]);
  });

  test("source is split into lines", () => {
    const nb = buildIpynb([{ kind: "code", text: "a\nb" }]);
    expect(nb.cells[0].source).toEqual(["a\n", "b"]);
  });

  test("has correct metadata", () => {
    const nb = buildIpynb([{ kind: "code", text: "" }]);
    expect(nb.nbformat).toBe(4);
    expect(nb.metadata).toEqual(IPYNB_METADATA);
  });
});
