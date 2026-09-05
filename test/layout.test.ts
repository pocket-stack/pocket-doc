import { expect, test } from "bun:test";
import { layout, raster, TILE_W, TILE_H } from "../host/layout.ts";
import { sourceRows, textCells } from "../app/editor.ts";

test("tables wrap into fixed-height bands with shared geometry and original source offsets", () => {
  const line = "| left \\| pipe | 中文😀" + "wide ".repeat(30) + "|";
  const source = "# Notes\n\n| Name | Description |\n| --- | :---: |\n" + line + "\n\nAfter table";
  const rows = layout(source).rows;
  const header = rows.find(row => row.table?.header)!;
  expect(header.table?.widths.reduce((a,b) => a+b, 0)).toBe(TILE_W);
  const bands = rows.filter(row => row.table && !row.table.header);
  expect(bands.length).toBeGreaterThan(1);
  expect(bands.map(row => row.table!.cells[0]).join("")).toBe("left | pipe");
  expect(bands.map(row => row.table!.cells[1]).join("")).toBe("中文😀" + "wide ".repeat(30).trimEnd());
  for (const row of bands) {
    expect(source.slice(row.start, row.end)).toBe(line);
    expect(row.table?.widths).toEqual(header.table?.widths);
    expect(Buffer.from(raster(row), "base64").length).toBe(TILE_W * TILE_H / 4);
  }
  expect(rows.at(-1)?.text).toBe("After table");
  expect(rows.some(row => row.text.includes(":---:"))).toBe(false);
});

test("fenced code and unmatched pipe lines remain text", () => {
  expect(layout("```\n| A | B |\n| --- | --- |\n```\n").rows.some(row => row.table)).toBe(false);
  expect(layout("A | B\njust text\n").rows.some(row => row.table)).toBe(false);
});

test("source bands preserve UTF-16 selection positions and fit the narrow editor", () => {
  const source = "a".repeat(28) + "中文😀" + "bc\n" + "z".repeat(50);
  for (const row of sourceRows(source, 32, 30)) {
    expect(source.slice(row.start, row.end)).toBe(row.text);
    expect(textCells(row.text)).toBeLessThanOrEqual(30);
    expect(row.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
  }
});
