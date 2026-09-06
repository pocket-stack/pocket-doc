import { createEditHistory } from "../app/history.ts";
import { expect, test } from "bun:test";
import { moveSourceCaret, sourceWindow } from "../app/editor.ts";
import { slotRow, ROW_SLOTS } from "../app/window.ts";
test("source window preserves Unicode pairs, Markdown pipes and a separate caret", () => {
  const source = "中文😀|table\n" + "a".repeat(100);
  const rows = sourceWindow(source, 2);
  expect(rows.join("\n")).toContain("中文\u0001😀|table");
  expect(rows.every(row => !/[\uD800-\uDBFF]$/.test(row))).toBe(true);
  expect(rows.filter(row => row.includes("\u0001"))).toHaveLength(1);
  expect(sourceWindow("line\n".repeat(100), 480).length).toBeLessThanOrEqual(9);
});
test("relative caret movement follows wrapped rows and complete Unicode characters", () => {
  expect(moveSourceCaret("abcd\nef\nghijkl", 2, 0, 1, 30)).toBe(7);
  expect(moveSourceCaret("abcd\nef\nghijkl", 7, 0, 1, 30)).toBe(10);
  expect(moveSourceCaret("a😀中b", 1, 1, 0, 30)).toBe(3);
  expect(moveSourceCaret("a😀中b", 3, -1, 0, 30)).toBe(1);
  expect(moveSourceCaret("abcdefgh", 1, 0, 1, 4)).toBe(5);
  expect(moveSourceCaret("a\n", 0, 0, 1, 30)).toBe(2);
  expect(moveSourceCaret("a", 0, -100, -10, 30)).toBe(0);
});
test("crossing one row reassigns only one of the fixed display slots", () => {
  for (const first of [0, 11, 12, 2398]) {
    const before = Array.from({ length: ROW_SLOTS }, (_, slot) => slotRow(first, slot));
    const after = before.map((_, slot) => slotRow(first + 1, slot));
    expect(after.filter((row, slot) => row !== before[slot])).toHaveLength(1);
    expect([...after].sort((a, b) => a - b)).toEqual(Array.from({ length: ROW_SLOTS }, (_, n) => first + 1 + n));
  }
});


test("undo/redo retain bounded excerpt snapshots and discard an abandoned future", () => {
  const history = createEditHistory(3);
  const point = (text: string) => ({ text, caret: text.length, anchor: text.length, selecting: false });
  for (const text of ["a", "ab", "abc", "abcd"]) history.record(point(text));
  expect(history.sizes()).toEqual([3, 0]);
  expect(history.undo(point("abcde"))).toEqual(point("abcd"));
  expect(history.undo(point("abcd"))).toEqual(point("abc"));
  expect(history.redo(point("abc"))).toEqual(point("abcd"));
  history.record(point("abcd"));
  expect(history.redo(point("abcd!"))).toBeUndefined();
  history.clear(); expect(history.sizes()).toEqual([0, 0]);
});
