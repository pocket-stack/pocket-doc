export type SourceRow = { text: string; start: number; end: number };
export const textCells = (text: string) => Array.from(text).reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 2 : 1), 0);

/** Only the bounded source excerpt is laid out locally; preserve UTF-16 offsets. */
export function sourceRows(text: string, caret: number, columns = 46): SourceRow[] {
  const rows: SourceRow[] = [];
  let part = "", cells = 0, offset = 0, start = 0;
  const push = () => { rows.push({ text: part, start, end: offset }); part = ""; cells = 0; };
  for (const char of text) {
    if (char === "\n") { push(); offset++; start = offset; continue; }
    const width = char.codePointAt(0)! > 255 ? 2 : 1;
    if (cells + width > columns) { push(); start = offset; }
    part += char; cells += width; offset += char.length;
  }
  push();
  let current = rows.findIndex(row => caret >= row.start && caret <= row.end);
  if (current < 0) current = rows.length - 1;
  const first = Math.max(0, current - 4);
  return rows.slice(first, first + 9);
}

export function sourceWindow(text: string, caret: number, columns = 46): string[] {
  let marked = false;
  return sourceRows(text, caret, columns).map(row => {
    if (!marked && caret >= row.start && caret <= row.end) {
      marked = true;
      const at = caret - row.start;
      return row.text.slice(0, at) + "\u0001" + row.text.slice(at);
    }
    return row.text;
  });
}
