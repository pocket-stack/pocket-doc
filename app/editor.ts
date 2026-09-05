export type SourceRow = { text: string; start: number; end: number };
export const textCells = (text: string) => Array.from(text).reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 2 : 1), 0);

/** Uses the same advance for text, selection and caret geometry. */
export const sourceAdvance = (text: string, cellWidth: number) => textCells(text) * cellWidth;

/** Only the bounded source excerpt is laid out locally; preserve UTF-16 offsets. */
export function sourceLayout(text: string, columns = 46): SourceRow[] {
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
  return rows;
}

export function sourceRows(text: string, caret: number, columns = 46): SourceRow[] {
  const rows = sourceLayout(text, columns);
  let current = rows.findIndex(row => caret >= row.start && caret <= row.end);
  if (current < 0) current = rows.length - 1;
  const first = Math.max(0, current - 4);
  return rows.slice(first, first + 9);
}

/** Relative movement respects wrapped lines, wide glyphs and UTF-16 pairs. */
export function moveSourceCaret(text: string, caret: number, dx: number, dy: number, columns: number): number {
  const rows = sourceLayout(text, columns);
  const index = Math.max(0, rows.findIndex(row => caret >= row.start && caret <= row.end));
  const row = rows[index], target = rows[Math.max(0, Math.min(rows.length - 1, index + dy))];
  let next = caret;
  if (dy) {
    const column = textCells(row.text.slice(0, caret - row.start));
    let cells = 0; next = target.start;
    for (const char of target.text) {
      const width = textCells(char); if (cells + width > column) break;
      cells += width; next += char.length;
    }
  }
  for (let i = 0; i < Math.abs(dx); i++) {
    if (dx < 0 && next > 0) next -= next > 1 && /[\uDC00-\uDFFF]/.test(text[next - 1]) ? 2 : 1;
    else if (dx > 0 && next < text.length) next += /[\uD800-\uDBFF]/.test(text[next]) ? 2 : 1;
  }
  return next;
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
