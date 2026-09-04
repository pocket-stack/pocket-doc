/** Small, bounded source window. Wide characters occupy two keyboard cells;
 * source offsets remain UTF-16 and surrogate pairs are never split. */
export function sourceWindow(text: string, caret: number): string[] {
  const rows: string[] = [];
  let row = "", cells = 0, offset = 0, cursorRow = 0;
  for (const char of text) {
    if (offset === caret) { row += "\u0001"; cursorRow = rows.length; }
    if (char === "\n") { rows.push(row); row = ""; cells = 0; }
    else {
      const width = char.codePointAt(0)! > 255 ? 2 : 1;
      if (cells + width > 46) { rows.push(row); row = ""; cells = 0; }
      row += char; cells += width;
    }
    offset += char.length;
  }
  if (caret >= offset) { row += "\u0001"; cursorRow = rows.length; }
  rows.push(row);
  const first = Math.max(0, cursorRow - 4);
  return rows.slice(first, first + 9);
}
