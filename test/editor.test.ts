import { expect, test } from "bun:test";
import { sourceWindow } from "../app/editor.ts";
test("source window preserves Unicode pairs, Markdown pipes and a separate caret", () => {
  const source = "中文😀|table\n" + "a".repeat(100);
  const rows = sourceWindow(source, 2);
  expect(rows.join("\n")).toContain("中文\u0001😀|table");
  expect(rows.every(row => !/[\uD800-\uDBFF]$/.test(row))).toBe(true);
  expect(rows.filter(row => row.includes("\u0001"))).toHaveLength(1);
  expect(sourceWindow("line\n".repeat(100), 480).length).toBeLessThanOrEqual(9);
});
