import { describe, expect, test } from "bun:test";
import { parseOutputRaw } from "./outputParserRaw";

const DISPLAY_START = "___DISPLAY_OUTPUT___";
const DISPLAY_END = "___END_DISPLAY___";

function wrapDisplay(payload: object): string {
  return `${DISPLAY_START}${JSON.stringify(payload)}${DISPLAY_END}`;
}

describe("parseOutputRaw", () => {
  test("empty input returns empty array", () => {
    expect(parseOutputRaw("")).toEqual([]);
  });

  test("whitespace-only returns empty array", () => {
    expect(parseOutputRaw("   ")).toEqual([]);
  });

  test("plain text output", () => {
    const result = parseOutputRaw("hello world");
    expect(result).toEqual([{ text: "hello world" }]);
  });

  test("single display output", () => {
    const items = [{ mime: "text/html", data: "<b>hi</b>" }];
    const result = parseOutputRaw(wrapDisplay({ items }));
    expect(result).toEqual([{ items }]);
  });

  test("text before display", () => {
    const items = [{ mime: "text/plain", data: "x" }];
    const result = parseOutputRaw(`before${wrapDisplay({ items })}`);
    expect(result).toEqual([{ text: "before" }, { items }]);
  });

  test("text after display", () => {
    const items = [{ mime: "text/plain", data: "x" }];
    const result = parseOutputRaw(`${wrapDisplay({ items })}after`);
    expect(result).toEqual([{ items }, { text: "after" }]);
  });

  test("mixed text and display", () => {
    const items = [{ mime: "text/html", data: "<p>chart</p>" }];
    const result = parseOutputRaw(`hello${wrapDisplay({ items })}world`);
    expect(result).toEqual([{ text: "hello" }, { items }, { text: "world" }]);
  });

  test("multiple displays", () => {
    const items1 = [{ mime: "text/plain", data: "a" }];
    const items2 = [{ mime: "text/plain", data: "b" }];
    const result = parseOutputRaw(`${wrapDisplay({ items: items1 })}${wrapDisplay({ items: items2 })}`);
    expect(result).toEqual([{ items: items1 }, { items: items2 }]);
  });

  test("malformed marker - missing end", () => {
    const input = `text${DISPLAY_START}{"items":[]}`;
    const result = parseOutputRaw(input);
    // text before marker + remaining as text (no end marker found)
    expect(result).toEqual([{ text: "text" }, { text: `${DISPLAY_START}{"items":[]}` }]);
  });

  test("malformed JSON inside markers falls back to text", () => {
    const input = `${DISPLAY_START}not json${DISPLAY_END}`;
    const result = parseOutputRaw(input);
    expect(result).toEqual([{ text: "not json" }]);
  });

  test("plotly-style output with complex items", () => {
    const items = [
      { mime: "application/vnd.bunbook.plotly", data: '{"data":[],"layout":{}}' },
    ];
    const result = parseOutputRaw(wrapDisplay({ items }));
    expect(result).toEqual([{ items }]);
  });

  test("binary MIME types preserved", () => {
    const items = [{ mime: "image/png", data: "iVBOR..." }];
    const result = parseOutputRaw(wrapDisplay({ items }));
    expect(result).toEqual([{ items }]);
  });
});
