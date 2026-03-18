import { describe, expect, test } from "bun:test";
import { transformDeclarations, extractVarNames } from "./transformCode";

const identity = (s: string) => s;

/** Normalize whitespace for comparing generated code */
function norm(code: string): string {
  return code.replace(/\s+/g, " ").trim();
}

describe("transformDeclarations", () => {
  describe("const/let → var", () => {
    test("const becomes var", () => {
      const result = transformDeclarations("const x = 1;", identity);
      expect(result).toContain("var x = 1");
    });

    test("let becomes var", () => {
      const result = transformDeclarations("let y = 2;", identity);
      expect(result).toContain("var y = 2");
    });

    test("var stays var", () => {
      const result = transformDeclarations("var z = 3;", identity);
      expect(result).toContain("var z = 3");
    });
  });

  describe("imports", () => {
    test("default import", () => {
      const result = transformDeclarations('import foo from "mod";', identity);
      expect(result).toContain("await import");
      expect(result).toContain(".default");
      expect(result).toContain("var foo");
    });

    test("named imports", () => {
      const result = transformDeclarations('import { a, b } from "mod";', identity);
      expect(result).toContain("await import");
      expect(norm(result)).toContain("var {a, b}");
    });

    test("namespace import", () => {
      const result = transformDeclarations('import * as ns from "mod";', identity);
      expect(result).toContain("var ns");
      expect(result).toContain("await import");
    });

    test("side-effect import", () => {
      const result = transformDeclarations('import "mod";', identity);
      expect(result).toContain("await import");
      expect(result).not.toContain("var");
    });

    test("mixed default + named", () => {
      const result = transformDeclarations('import foo, { bar } from "mod";', identity);
      const n = norm(result);
      expect(n).toContain("await import");
      expect(n).toContain("var foo");
      expect(n).toContain("{bar}");
    });

    test("resolveImport is called", () => {
      const resolver = (s: string) => `/resolved/${s}`;
      const result = transformDeclarations('import foo from "mod";', resolver);
      expect(result).toContain("/resolved/mod");
    });

    test("aliased named import", () => {
      const result = transformDeclarations('import { a as b } from "mod";', identity);
      expect(norm(result)).toContain("a: b");
    });
  });

  describe("function declarations", () => {
    test("function → var", () => {
      const result = transformDeclarations("function foo() { return 1; }", identity);
      expect(norm(result)).toContain("var foo = function foo()");
    });

    test("async function → var", () => {
      const result = transformDeclarations("async function bar() {}", identity);
      expect(norm(result)).toContain("var bar = async function bar()");
    });

    test("generator function → var", () => {
      const result = transformDeclarations("function* gen() { yield 1; }", identity);
      expect(norm(result)).toContain("var gen = function* gen()");
    });
  });

  describe("class declarations", () => {
    test("class → var", () => {
      const result = transformDeclarations("class Foo {}", identity);
      expect(norm(result)).toContain("var Foo = class Foo");
    });
  });

  describe("exports", () => {
    test("named export with declaration", () => {
      const result = transformDeclarations("export const x = 1;", identity);
      expect(result).toContain("var x = 1");
      expect(result).not.toContain("export");
    });

    test("export default declaration", () => {
      const result = transformDeclarations("export default function foo() {}", identity);
      expect(norm(result)).toContain("var foo = function foo()");
      expect(result).not.toContain("export");
    });

    test("re-export is dropped", () => {
      const result = transformDeclarations("var a = 1; var b = 2; export { a, b };", identity);
      expect(result).not.toContain("export");
      expect(result).toContain("var a = 1");
    });
  });

  test("preserves regular expressions and other code", () => {
    const code = 'const x = 1;\nconsole.log("hello");';
    const result = transformDeclarations(code, identity);
    expect(result).toContain("var x = 1");
    expect(result).toContain('console.log("hello")');
  });
});

describe("extractVarNames", () => {
  test("simple var", () => {
    expect(extractVarNames("var x = 1;")).toEqual(["x"]);
  });

  test("multiple declarations", () => {
    expect(extractVarNames("var a = 1; var b = 2;")).toEqual(["a", "b"]);
  });

  test("destructured object", () => {
    expect(extractVarNames("var { a, b } = obj;")).toEqual(["a", "b"]);
  });

  test("destructured array", () => {
    expect(extractVarNames("var [a, b] = arr;")).toEqual(["a", "b"]);
  });

  test("nested destructuring", () => {
    expect(extractVarNames("var { a: { b } } = obj;")).toEqual(["b"]);
  });

  test("rest elements", () => {
    expect(extractVarNames("var [a, ...rest] = arr;")).toEqual(["a", "rest"]);
  });

  test("default values", () => {
    expect(extractVarNames("var { a = 1 } = obj;")).toEqual(["a"]);
  });

  test("ignores non-variable declarations", () => {
    expect(extractVarNames("function foo() {}")).toEqual([]);
  });

  test("const and let also work", () => {
    expect(extractVarNames("const x = 1; let y = 2;")).toEqual(["x", "y"]);
  });

  test("array with holes", () => {
    expect(extractVarNames("var [, b] = arr;")).toEqual(["b"]);
  });
});
