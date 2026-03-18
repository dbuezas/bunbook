const DISPLAY_START = "___DISPLAY_OUTPUT___";
const DISPLAY_END = "___END_DISPLAY___";

export interface RawOutputItem {
  mime: string;
  data: string; // text for text MIMEs, base64 for binary MIMEs
}

export interface RawOutput {
  items?: RawOutputItem[]; // defined = display_data
  text?: string;           // defined = plain stdout text
}

/** Parse worker stdout into raw outputs with no VS Code dependencies. */
export function parseOutputRaw(stdout: string): RawOutput[] {
  const outputs: RawOutput[] = [];
  let remaining = stdout;

  while (remaining.length > 0) {
    const startIdx = remaining.indexOf(DISPLAY_START);

    if (startIdx === -1) {
      const text = remaining.trim();
      if (text) outputs.push({ text });
      break;
    }

    const textBefore = remaining.substring(0, startIdx).trim();
    if (textBefore) outputs.push({ text: textBefore });

    const jsonStart = startIdx + DISPLAY_START.length;
    const endIdx = remaining.indexOf(DISPLAY_END, jsonStart);

    if (endIdx === -1) {
      const rest = remaining.substring(startIdx).trim();
      if (rest) outputs.push({ text: rest });
      break;
    }

    const jsonStr = remaining.substring(jsonStart, endIdx);
    try {
      const payload: { items: RawOutputItem[] } = JSON.parse(jsonStr);
      outputs.push({ items: payload.items });
    } catch {
      outputs.push({ text: jsonStr });
    }

    remaining = remaining.substring(endIdx + DISPLAY_END.length);
  }

  return outputs;
}
