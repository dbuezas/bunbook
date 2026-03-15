import { parse } from "acorn";
import { generate } from "astring";
import type { Node } from "acorn";

// acorn node types we use (acorn doesn't export these)
interface AcornImportDeclaration extends Node {
  type: "ImportDeclaration";
  specifiers: Array<{
    type: string;
    local: { name: string };
    imported?: { name: string };
  }>;
  source: { value: string; raw: string };
}

interface AcornVariableDeclaration extends Node {
  type: "VariableDeclaration";
  kind: "var" | "let" | "const";
  declarations: Array<{ id: any; init: any; type: string; start: number; end: number }>;
}

interface AcornFunctionDeclaration extends Node {
  type: "FunctionDeclaration";
  id: { name: string } | null;
  async: boolean;
  generator: boolean;
  params: any[];
  body: any;
}

interface AcornClassDeclaration extends Node {
  type: "ClassDeclaration";
  id: { name: string } | null;
  superClass: any;
  body: any;
}

interface AcornExportNamedDeclaration extends Node {
  type: "ExportNamedDeclaration";
  declaration: any;
  specifiers: any[];
  source: any;
}

interface AcornExportDefaultDeclaration extends Node {
  type: "ExportDefaultDeclaration";
  declaration: any;
}

interface AcornProgram extends Node {
  type: "Program";
  body: Node[];
}

type ResolveImport = (specifier: string) => string;

function transformImport(node: AcornImportDeclaration, resolveImport: ResolveImport): Node {
  const resolved = resolveImport(node.source.value);
  const importCall: any = {
    type: "AwaitExpression",
    argument: {
      type: "ImportExpression",
      source: { type: "Literal", value: resolved, raw: JSON.stringify(resolved) },
    },
  };

  const specifiers = node.specifiers;

  // Side-effect import: import "mod" → await import("mod")
  if (specifiers.length === 0) {
    return {
      type: "ExpressionStatement",
      expression: importCall,
      start: node.start,
      end: node.end,
    } as any;
  }

  const hasDefault = specifiers.some((s) => s.type === "ImportDefaultSpecifier");
  const hasNamespace = specifiers.some((s) => s.type === "ImportNamespaceSpecifier");
  const named = specifiers.filter((s) => s.type === "ImportSpecifier");

  // Pure namespace: import * as ns from "mod" → var ns = await import("mod")
  if (hasNamespace && !hasDefault && named.length === 0) {
    const ns = specifiers.find((s) => s.type === "ImportNamespaceSpecifier")!;
    return varDecl(
      { type: "Identifier", name: ns.local.name } as any,
      importCall,
      node,
    );
  }

  // Pure default: import foo from "mod" → var foo = (await import("mod")).default
  if (hasDefault && !hasNamespace && named.length === 0) {
    const def = specifiers.find((s) => s.type === "ImportDefaultSpecifier")!;
    return varDecl(
      { type: "Identifier", name: def.local.name } as any,
      {
        type: "MemberExpression",
        object: importCall,
        property: { type: "Identifier", name: "default" },
        computed: false,
        optional: false,
      },
      node,
    );
  }

  // Pure named: import { a, b as c } from "mod" → var { a, b: c } = await import("mod")
  if (!hasDefault && !hasNamespace && named.length > 0) {
    return varDecl(namedPattern(named), importCall, node);
  }

  // Mixed: import foo, { bar } from "mod"
  // → var __mod = await import("mod"); var foo = __mod.default; var { bar } = __mod;
  // We generate a block of statements and return them wrapped.
  const tmpName = `__import_${node.start}`;
  const tmpId: any = { type: "Identifier", name: tmpName };
  const stmts: any[] = [varDecl(tmpId, importCall, node)];

  if (hasDefault) {
    const def = specifiers.find((s) => s.type === "ImportDefaultSpecifier")!;
    stmts.push(
      varDecl(
        { type: "Identifier", name: def.local.name } as any,
        {
          type: "MemberExpression",
          object: { type: "Identifier", name: tmpName },
          property: { type: "Identifier", name: "default" },
          computed: false,
          optional: false,
        },
        node,
      ),
    );
  }
  if (hasNamespace) {
    const ns = specifiers.find((s) => s.type === "ImportNamespaceSpecifier")!;
    stmts.push(
      varDecl({ type: "Identifier", name: ns.local.name } as any, tmpId, node),
    );
  }
  if (named.length > 0) {
    stmts.push(
      varDecl(namedPattern(named), { type: "Identifier", name: tmpName }, node),
    );
  }

  // Return a block-like marker that we'll flatten later
  return { type: "__MultiStatement", stmts } as any;
}

function namedPattern(named: AcornImportDeclaration["specifiers"]): any {
  return {
    type: "ObjectPattern",
    properties: named.map((s) => ({
      type: "Property",
      key: { type: "Identifier", name: s.imported?.name ?? s.local.name },
      value: { type: "Identifier", name: s.local.name },
      kind: "init",
      computed: false,
      method: false,
      shorthand: s.imported?.name === s.local.name || !s.imported,
    })),
  };
}

function varDecl(id: any, init: any, loc: Node): any {
  return {
    type: "VariableDeclaration",
    kind: "var" as const,
    declarations: [{ type: "VariableDeclarator", id, init, start: loc.start, end: loc.end }],
    start: loc.start,
    end: loc.end,
  };
}

function transformNode(node: Node, resolveImport: ResolveImport): Node | Node[] {
  switch (node.type) {
    case "ImportDeclaration": {
      const result = transformImport(node as AcornImportDeclaration, resolveImport);
      if ((result as any).type === "__MultiStatement") {
        return (result as any).stmts;
      }
      return result;
    }

    case "VariableDeclaration": {
      const vd = node as AcornVariableDeclaration;
      vd.kind = "var";
      return vd;
    }

    case "FunctionDeclaration": {
      const fd = node as AcornFunctionDeclaration;
      if (!fd.id) return node;
      // var name = function name(...) { ... }
      return varDecl(
        { type: "Identifier", name: fd.id.name },
        {
          type: "FunctionExpression",
          id: fd.id,
          params: fd.params,
          body: fd.body,
          async: fd.async,
          generator: fd.generator,
          start: fd.start,
          end: fd.end,
        },
        fd,
      );
    }

    case "ClassDeclaration": {
      const cd = node as AcornClassDeclaration;
      if (!cd.id) return node;
      // var name = class name { ... }
      return varDecl(
        { type: "Identifier", name: cd.id.name },
        {
          type: "ClassExpression",
          id: cd.id,
          superClass: cd.superClass,
          body: cd.body,
          start: cd.start,
          end: cd.end,
        },
        cd,
      );
    }

    case "ExportNamedDeclaration": {
      const end = node as AcornExportNamedDeclaration;
      if (end.declaration) {
        return transformNode(end.declaration, resolveImport);
      }
      // export { a, b } — just drop the export, identifiers are already in scope
      return { type: "EmptyStatement", start: node.start, end: node.end } as any;
    }

    case "ExportDefaultDeclaration": {
      const edd = node as AcornExportDefaultDeclaration;
      if (edd.declaration) {
        return transformNode(edd.declaration, resolveImport);
      }
      return { type: "EmptyStatement", start: node.start, end: node.end } as any;
    }

    default:
      return node;
  }
}

export function transformDeclarations(code: string, resolveImport: ResolveImport): string {
  const ast = parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  }) as AcornProgram;

  const newBody: Node[] = [];
  for (const node of ast.body) {
    const result = transformNode(node, resolveImport);
    if (Array.isArray(result)) {
      newBody.push(...result);
    } else {
      newBody.push(result);
    }
  }
  ast.body = newBody;

  return generate(ast);
}

function collectBindingNames(pattern: any): string[] {
  const names: string[] = [];
  switch (pattern.type) {
    case "Identifier":
      names.push(pattern.name);
      break;
    case "ObjectPattern":
      for (const prop of pattern.properties) {
        if (prop.type === "RestElement") {
          names.push(...collectBindingNames(prop.argument));
        } else {
          names.push(...collectBindingNames(prop.value));
        }
      }
      break;
    case "ArrayPattern":
      for (const elem of pattern.elements) {
        if (elem) names.push(...collectBindingNames(elem));
      }
      break;
    case "RestElement":
      names.push(...collectBindingNames(pattern.argument));
      break;
    case "AssignmentPattern":
      names.push(...collectBindingNames(pattern.left));
      break;
  }
  return names;
}

export function extractVarNames(code: string): string[] {
  const ast = parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowAwaitOutsideFunction: true,
  }) as AcornProgram;

  const names: string[] = [];
  for (const node of ast.body) {
    if (node.type === "VariableDeclaration") {
      for (const decl of (node as AcornVariableDeclaration).declarations) {
        names.push(...collectBindingNames(decl.id));
      }
    }
  }
  return names;
}
