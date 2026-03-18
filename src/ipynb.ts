import * as crypto from "crypto";

// --- ipynb types ---

export interface IpynbCodeCell {
  cell_type: "code";
  id?: string;
  source: string[] | string;
  metadata: Record<string, unknown>;
  outputs: IpynbOutput[];
  execution_count: number | null;
}

export interface IpynbMarkdownCell {
  cell_type: "markdown";
  id?: string;
  source: string[] | string;
  metadata: Record<string, unknown>;
}

export type IpynbCell = IpynbCodeCell | IpynbMarkdownCell;

export interface IpynbOutput {
  output_type: "stream" | "display_data" | "execute_result" | "error";
  [key: string]: unknown;
}

export interface IpynbNotebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: IpynbCell[];
}

export const IPYNB_METADATA = {
  kernelspec: {
    name: "bunbook",
    display_name: "TypeScript (Bun)",
    language: "typescript",
  },
  language_info: {
    name: "typescript",
    file_extension: ".ts",
  },
};

/** Split a string into ipynb source lines: each line ends with \n except the last. */
export function stringToSourceLines(value: string): string[] {
  if (value === "") return [];
  const lines = value.split("\n");
  return lines.map((line, i) => (i < lines.length - 1 ? line + "\n" : line));
}

export function sourceToString(source: string[] | string): string {
  return Array.isArray(source) ? source.join("") : (typeof source === "string" ? source : "");
}

export function parseIpynb(text: string): IpynbNotebook | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as IpynbNotebook;
  } catch {
    return null;
  }
}

export function buildEmptyIpynb(): IpynbNotebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: IPYNB_METADATA,
    cells: [
      { cell_type: "code", id: crypto.randomUUID(), source: [], metadata: {}, outputs: [], execution_count: null },
    ],
  };
}

export function buildIpynb(cells: { kind: "code" | "markdown"; text: string }[]): IpynbNotebook {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: IPYNB_METADATA,
    cells: cells.map((c) => {
      const id = crypto.randomUUID();
      const source = stringToSourceLines(c.text);
      if (c.kind === "markdown") {
        return { cell_type: "markdown" as const, id, source, metadata: {} };
      }
      return { cell_type: "code" as const, id, source, metadata: {}, outputs: [], execution_count: null };
    }),
  };
}
