import { expect, test } from "bun:test";
import { layout, raster, rasterSource, codeColors, TILE_W, TILE_H } from "../host/layout.ts";
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

test("streamed source glyphs share the device cell grid, including whitespace and wide characters", () => {
  const pixel = (mask: Buffer, x: number, y: number) => (mask[(y * TILE_W + x) >> 2] >> ((x & 3) * 2)) & 3;
  const glyph = Buffer.from(rasterSource("s", 7), "base64");
  expect(glyph.some(byte => byte !== 0)).toBe(true);
  for (const [text, shift] of [[" s", 7], ["This i s", 49], ["中s", 14], ["😀s", 14]] as const) {
    const image = Buffer.from(rasterSource(text, 7), "base64");
    for (let y = 0; y < TILE_H; y++) for (let x = 0; x < 7; x++) {
      expect(pixel(image, x + shift, y)).toBe(pixel(glyph, x, y));
    }
  }
  expect(() => rasterSource("text", 0)).toThrow("Invalid source cell width");
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


test("fenced syntax retains multiline state, fixed cells, offsets and bounded color payloads", () => {
  const code = "const value = 42; // comment\n/* begin\nend */ const text = \"hello\";\n\tconsole.log(text);\n";
  const source = "~~~ts\n" + code + "~~~\n";
  const rows = layout(source).rows.filter(r => r.code && r.text && !["TS"].includes(r.text));
  expect(rows.length).toBeGreaterThan(3);
  for (const row of rows) {
    expect(codeColors(row)!.columns.length).toBe(256);
    expect(codeColors(row)!.palette.length).toBeLessThanOrEqual(96);
    expect(JSON.stringify({ mask: raster(row), colors: codeColors(row) }).length).toBeLessThan(2500);
    expect(row.start).toBeGreaterThanOrEqual(6);
    expect(row.end).toBeLessThanOrEqual(source.length);
  }
  const first = rows[0];
  expect(new Set(codeColors(first)!.columns).size).toBeGreaterThan(2);
  expect(rows.some(r => r.text.startsWith("    console"))).toBe(true);
  const unknown = layout("```not-a-language\na | b\n```\n").rows.find(r => r.code && r.text === "a | b")!;
  expect(unknown.text).toBe("a | b");
  expect(unknown.table).toBeUndefined();
  expect(layout("```python\nprint(42)").rows.some(r => r.text === "print(42)" && r.code)).toBe(true);
});


test("long code stays one logical line and horizontal tiles keep syntax colors", () => {
  const line = "const longName = " + "value + ".repeat(20) + "42;";
  const rows = layout("```ts\n" + line + "\n```").rows;
  expect(rows).toHaveLength(3); expect(rows[1].text).toBe(line);
  expect(rows[1].code!.width).toBeGreaterThan(TILE_W);
  expect(raster(rows[1], 0)).not.toBe(raster(rows[1], 70));
  expect(codeColors(rows[1], 70)!.columns.length).toBe(TILE_W);
});

test("wrapped table bands share a logical row with only outer horizontal borders", () => {
  const source = "| Long heading | B |\n| --- | --- |\n| Mixed scripts with extra words repeated several times to exceed the measured cell width | details |";
  const bands = layout(source).rows.filter(r => r.table && !r.table.header);
  expect(bands.length).toBeGreaterThan(1);
  expect(bands.filter(r => r.table!.first)).toHaveLength(1);
  expect(bands.filter(r => r.table!.last)).toHaveLength(1);
  expect(bands[0].table!.first).toBe(true); expect(bands.at(-1)!.table!.last).toBe(true);
});
