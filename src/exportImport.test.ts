import { describe, expect, test } from "bun:test";
import {
  notebookToTypeScript,
  typeScriptToNotebook,
  notebookToHtml,
  notebookToMarkdown,
} from "./exportImport";
import { sourceToString, type IpynbCell, type IpynbCodeCell } from "./ipynb";

function codeCell(source: string, outputs: any[] = []): IpynbCodeCell {
  return {
    cell_type: "code",
    source,
    metadata: {},
    outputs,
    execution_count: null,
  };
}

function mdCell(source: string): IpynbCell {
  return { cell_type: "markdown", source, metadata: {} };
}

// ── notebookToTypeScript ─────────────────────────────────────────────────

describe("notebookToTypeScript", () => {
  test("code cells get // %% headers", () => {
    const result = notebookToTypeScript([codeCell("const x = 1")]);
    expect(result).toContain("// %% cell 1");
    expect(result).toContain("const x = 1");
  });

  test("multiple code cells numbered sequentially", () => {
    const result = notebookToTypeScript([codeCell("a"), codeCell("b")]);
    expect(result).toContain("// %% cell 1");
    expect(result).toContain("// %% cell 2");
  });

  test("markdown cells wrapped in /* */", () => {
    const result = notebookToTypeScript([mdCell("# Hello")]);
    expect(result).toContain("// %% markdown");
    expect(result).toContain("/*\n# Hello\n*/");
  });

  test("empty markdown cells are skipped", () => {
    const result = notebookToTypeScript([mdCell(""), codeCell("x")]);
    expect(result).not.toContain("markdown");
    expect(result).toContain("// %% cell 1");
  });

  test("ends with newline", () => {
    const result = notebookToTypeScript([codeCell("x")]);
    expect(result.endsWith("\n")).toBe(true);
  });

  test("markdown cell numbering doesn't affect code cell numbering", () => {
    const result = notebookToTypeScript([
      codeCell("a"),
      mdCell("text"),
      codeCell("b"),
    ]);
    expect(result).toContain("// %% cell 1");
    expect(result).toContain("// %% cell 2");
  });
});

// ── typeScriptToNotebook ────────────────────────────────────────────────

describe("typeScriptToNotebook", () => {
  test("with separators creates multiple cells", () => {
    const ts = "// %% cell 1\nconst x = 1\n\n// %% cell 2\nconst y = 2\n";
    const nb = typeScriptToNotebook(ts);
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0].cell_type).toBe("code");
    expect(nb.cells[1].cell_type).toBe("code");
  });

  test("without separators creates single cell", () => {
    const ts = "const x = 1\nconst y = 2";
    const nb = typeScriptToNotebook(ts);
    expect(nb.cells).toHaveLength(1);
    expect(sourceToString(nb.cells[0].source)).toBe("const x = 1\nconst y = 2");
  });

  test("markdown blocks become markdown cells", () => {
    const ts = "// %% markdown\n/*\n# Title\n*/\n\n// %% cell 1\ncode\n";
    const nb = typeScriptToNotebook(ts);
    const md = nb.cells.find((c) => c.cell_type === "markdown");
    expect(md).toBeDefined();
    expect(sourceToString(md!.source)).toBe("# Title");
  });

  test("empty segments are filtered out", () => {
    const ts = "// %% cell 1\n\n\n// %% cell 2\ncode\n";
    const nb = typeScriptToNotebook(ts);
    // First cell is empty (just whitespace) so filtered, only second remains
    expect(nb.cells).toHaveLength(1);
    expect(sourceToString(nb.cells[0].source)).toBe("code");
  });

  test("round-trip: toTypeScript → toNotebook preserves content", () => {
    const cells: IpynbCell[] = [
      codeCell("const x = 1"),
      mdCell("# Heading"),
      codeCell("console.log(x)"),
    ];
    const ts = notebookToTypeScript(cells);
    const nb = typeScriptToNotebook(ts);
    expect(nb.cells).toHaveLength(3);
    expect(nb.cells[0].cell_type).toBe("code");
    expect(sourceToString(nb.cells[0].source)).toBe("const x = 1");
    expect(nb.cells[1].cell_type).toBe("markdown");
    expect(sourceToString(nb.cells[1].source)).toBe("# Heading");
    expect(nb.cells[2].cell_type).toBe("code");
    expect(sourceToString(nb.cells[2].source)).toBe("console.log(x)");
  });
});

// ── notebookToHtml ──────────────────────────────────────────────────────

describe("notebookToHtml", () => {
  test("contains doctype and title", () => {
    const html = notebookToHtml("Test", []);
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Test</title>");
  });

  test("code blocks are escaped", () => {
    const html = notebookToHtml("Test", [codeCell("if (a < b) {}")]);
    expect(html).toContain("a &lt; b");
    expect(html).toContain("language-typescript");
  });

  test("title is escaped", () => {
    const html = notebookToHtml("<script>alert(1)</script>", []);
    expect(html).toContain("&lt;script&gt;");
  });

  test("plotly CDN script included only when needed", () => {
    const htmlWithout = notebookToHtml("Test", [codeCell("x")]);
    expect(htmlWithout).not.toContain("cdn.plot.ly");

    const plotlyCell = codeCell("x", [
      {
        output_type: "display_data",
        data: { "application/vnd.bunbook.plotly": '{"data":[],"layout":{}}' },
      },
    ]);
    const htmlWith = notebookToHtml("Test", [plotlyCell]);
    expect(htmlWith).toContain("cdn.plot.ly");
  });

  test("markdown cells have data-markdown attribute", () => {
    const html = notebookToHtml("Test", [mdCell("# Hi")]);
    expect(html).toContain('data-markdown="# Hi"');
    expect(html).toContain("markdown-cell");
  });

  test("stream outputs rendered", () => {
    const cell = codeCell("x", [
      { output_type: "stream", name: "stdout", text: "hello" },
    ]);
    const html = notebookToHtml("Test", [cell]);
    expect(html).toContain("hello");
    expect(html).toContain("stdout");
  });

  test("stderr has stderr class", () => {
    const cell = codeCell("x", [
      { output_type: "stream", name: "stderr", text: "err" },
    ]);
    const html = notebookToHtml("Test", [cell]);
    expect(html).toContain("stderr");
  });
});

// ── notebookToMarkdown ─────────────────────────────────────────────────

describe("notebookToMarkdown", () => {
  test("code as fenced blocks", () => {
    const md = notebookToMarkdown([codeCell("const x = 1")]);
    expect(md).toContain("```ts\nconst x = 1\n```");
  });

  test("markdown passthrough", () => {
    const md = notebookToMarkdown([mdCell("# Hello")]);
    expect(md).toContain("# Hello");
    expect(md).not.toContain("```");
  });

  test("plotly placeholder", () => {
    const cell = codeCell("x", [
      {
        output_type: "display_data",
        data: { "application/vnd.bunbook.plotly": '{"data":[]}' },
      },
    ]);
    const md = notebookToMarkdown([cell]);
    expect(md).toContain("Interactive Plotly chart");
  });

  test("stream outputs as code blocks", () => {
    const cell = codeCell("x", [
      { output_type: "stream", name: "stdout", text: "output" },
    ]);
    const md = notebookToMarkdown([cell]);
    expect(md).toContain("```\noutput\n```");
  });

  test("stderr formatted as blockquote", () => {
    const cell = codeCell("x", [
      { output_type: "stream", name: "stderr", text: "error msg" },
    ]);
    const md = notebookToMarkdown([cell]);
    expect(md).toContain("**stderr:**");
    expect(md).toContain("> ");
  });

  test("empty cells are skipped", () => {
    const md = notebookToMarkdown([codeCell(""), mdCell("")]);
    expect(md.trim()).toBe("");
  });

  test("ends with newline", () => {
    const md = notebookToMarkdown([codeCell("x")]);
    expect(md.endsWith("\n")).toBe(true);
  });
});
