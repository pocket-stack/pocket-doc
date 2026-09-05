import { createCanvas, GlobalFonts } from "../runtime/node_modules/@napi-rs/canvas";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { highlight, columnColors } from "./highlight.ts";
import { BODY_W } from "../shared/layout.ts";
const cjkPaths = [process.env.DOC_CJK_FONT ?? "", "/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Light.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"];
const cjk = cjkPaths.find(path => path && existsSync(path));
if (!cjk || !GlobalFonts.registerFromPath(cjk, "DocCJK")) throw new Error("Install a CJK font or set DOC_CJK_FONT");
for (const [path, name] of [["/System/Library/Fonts/Supplemental/Arial.ttf", "DocLatin"], ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "DocUnicode"]]) {
  if (existsSync(path)) GlobalFonts.registerFromPath(path, name);
}
const mono = [process.env.DOC_MONO_FONT ?? "", "/System/Library/Fonts/Menlo.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"].find(path => path && existsSync(path));
if (!mono || !GlobalFonts.registerFromPath(mono, "DocMono")) throw new Error("Install a monospace font or set DOC_MONO_FONT");
export const LAYOUT_REVISION = createHash("sha256").update(readFileSync(cjk)).update(readFileSync(mono)).update(`doc-code-v4-${BODY_W}`).digest("hex").slice(0, 16);
export const TILE_W = BODY_W, TILE_H = 16, LINE_H = 20;
type TableBand = { widths: number[]; cells: string[]; header: boolean };
export type Row = { text: string; start: number; end: number; kind: number; colors?: { columns: string; palette: string }; table?: TableBand };
const canvas = createCanvas(TILE_W, TILE_H);
const ctx = canvas.getContext("2d");
const font = (kind: number) => kind === 1 ? "bold 14px DocLatin, DocCJK, DocUnicode" : kind === 3 ? "12px DocMono, DocCJK, DocUnicode" : "13px DocLatin, DocCJK, DocUnicode";

function cells(line: string): string[] {
  const parts: string[] = [];
  let part = "", escaped = false, code = false;
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  for (const char of body) {
    if (escaped) { part += char; escaped = false; }
    else if (char === "\\") escaped = true;
    else if (char === "`") { code = !code; part += char; }
    else if (char === "|" && !code) { parts.push(part.trim()); part = ""; }
    else part += char;
  }
  if (escaped) part += "\\";
  parts.push(part.trim());
  return parts;
}

function wrap(text: string, width: number): string[] {
  const result: string[] = [];
  let part = "";
  for (const char of text) {
    if (part && ctx.measureText(part + char).width > width) { result.push(part); part = ""; }
    part += char;
  }
  result.push(part);
  return result;
}

/** Provider-only layout. Visual bands retain offsets into the original source. */
export function layout(source: string) {
  const rows: Row[] = [], outline: { row: number; title: string }[] = [];
  const lines = source.split("\n"), offsets: number[] = [];
  let cursor = 0;
  for (const line of lines) { offsets.push(cursor); cursor += line.length + 1; }
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index], start = offsets[index];
    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const language = fence[2].trim().split(/\s+/)[0].toLowerCase();
      let end = index + 1;
      const closing = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
      while (end < lines.length && !closing.test(lines[end])) end++;
      rows.push({ text: language ? language.toUpperCase() : "CODE", start, end: start + line.length, kind: 3 });
      const tokens = highlight(lines.slice(index + 1, end).join("\n"), language);
      for (let n = index + 1; n < end; n++) {
        let offset = offsets[n], first = offset, count = 0, visualColumn = 0;
        let chars: { char: string; color: string }[] = [];
        const emit = () => { rows.push({ text: chars.map(c => c.char).join(""), start: first, end: offset, kind: 3,
          colors: columnColors(chars, TILE_W) }); chars = []; count = 0; first = offset; };
        for (const token of tokens[n - index - 1] ?? []) for (const char of token.content) {
          const expanded = char === "\t" ? " ".repeat(4 - visualColumn % 4) : char;
          for (const glyph of expanded) {
            const cells = glyph.codePointAt(0)! > 255 ? 2 : 1;
            if (count + cells > 36) emit();
            chars.push({ char: glyph, color: token.color ?? "#24292e" }); count += cells; visualColumn += cells;
          }
          offset += char.length;
        }
        emit();
      }
      if (end < lines.length) rows.push({ text: "", start: offsets[end], end: offsets[end] + lines[end].length, kind: 3 });
      index = end; continue;
    }
    const header = cells(line), divider = cells(lines[index + 1] ?? "");
    if (line.includes("|") && header.length >= 2 && header.length <= 16 &&
        divider.length === header.length && divider.every(value => /^:?-{3,}:?$/.test(value))) {
      ctx.font = font(0);
      const weights = header.map(value => Math.max(32, Math.min(96, ctx.measureText(value).width + 12)));
      const sum = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map(weight => Math.floor(TILE_W * weight / sum));
      widths[widths.length - 1] += TILE_W - widths.reduce((a, b) => a + b, 0);
      const emit = (values: string[], sourceRow: number, heading: boolean) => {
        ctx.font = heading ? "bold 13px DocLatin, DocCJK, DocUnicode" : font(0);
        const wrapped = widths.map((width, col) => wrap(values[col] ?? "", Math.max(6, width - 8)));
        for (let band = 0; band < Math.max(...wrapped.map(parts => parts.length)); band++) {
          const content = wrapped.map(parts => parts[band] ?? "");
          rows.push({ text: content.join(" | "), start: offsets[sourceRow], end: offsets[sourceRow] + lines[sourceRow].length,
            kind: 4, table: { widths, cells: content, header: heading } });
        }
      };
      emit(header, index, true); index += 1;
      while (index + 1 < lines.length && lines[index + 1].includes("|") && lines[index + 1].trim()) {
        const values = cells(lines[index + 1]);
        if (values.length !== header.length) break;
        index++; emit(values, index, false);
      }
      continue;
    }
    let text = line, kind = 0, prefix = 0;
    if (/^#{1,6} /.test(line)) {
      prefix = line.indexOf(" ") + 1; text = line.slice(prefix); kind = 1;
      outline.push({ row: rows.length, title: text.slice(0, 42) });
    } else if (line.startsWith("> ")) { kind = 2; prefix = 2; text = line.slice(2); }
    else if (/^[-*] /.test(line)) kind = 2;
    ctx.font = font(kind);
    let offset = prefix;
    for (const part of wrap(text, TILE_W - 12)) {
      rows.push({ text: part, start: start + offset, end: Math.min(start + line.length, start + offset + part.length), kind });
      offset += part.length;
    }
  }
  return { rows, outline };
}

/** One bounded coverage tile; table geometry travels separately as metadata. */
export function raster(row: Row): string {
  ctx.clearRect(0, 0, TILE_W, TILE_H);
  ctx.fillStyle = "white"; ctx.font = font(row.kind); ctx.textBaseline = "alphabetic";
  if (row.table) {
    ctx.font = row.table.header ? "bold 13px DocLatin, DocCJK, DocUnicode" : font(0);
    let x = 0;
    row.table.cells.forEach((text, column) => {
      ctx.save(); ctx.beginPath(); ctx.rect(x + 2, 0, row.table!.widths[column] - 4, TILE_H); ctx.clip();
      ctx.fillText(text, x + 4, 13); ctx.restore(); x += row.table!.widths[column];
    });
  } else if (row.kind === 3) paintMono(row.text, 7, 2);
  else ctx.fillText(row.text, row.kind === 2 ? 8 : 2, 13);
  const rgba = ctx.getImageData(0, 0, TILE_W, TILE_H).data;
  const mask = Buffer.alloc(TILE_W * TILE_H / 4);
  for (let i = 0; i < TILE_W * TILE_H; i++) mask[i >> 2] |= Math.round(rgba[i * 4 + 3] / 85) << ((i & 3) * 2);
  return mask.toString("base64");
}

/** Source tiles use the device font's measured cell advance and zero origin.
 * Each character is clipped to its declared cell so fallback fonts cannot
 * shift later glyphs or the device's caret/selection boundaries. */
export function rasterSource(text: string, cellWidth: number): string {
  if (!Number.isInteger(cellWidth) || cellWidth < 4 || cellWidth > 16) throw new Error("Invalid source cell width");
  ctx.clearRect(0, 0, TILE_W, TILE_H);
  ctx.fillStyle = "white"; ctx.font = font(3); ctx.textBaseline = "alphabetic";
  paintMono(text, cellWidth, 0);
  const rgba = ctx.getImageData(0, 0, TILE_W, TILE_H).data;
  const mask = Buffer.alloc(TILE_W * TILE_H / 4);
  for (let i = 0; i < TILE_W * TILE_H; i++) mask[i >> 2] |= Math.round(rgba[i * 4 + 3] / 85) << ((i & 3) * 2);
  return mask.toString("base64");
}
function paintMono(text: string, cellWidth: number, origin: number) {
  let x = origin;
  for (const char of text) {
    const width = cellWidth * (char.codePointAt(0)! > 255 ? 2 : 1);
    ctx.save(); ctx.beginPath(); ctx.rect(x, 0, width, TILE_H); ctx.clip();
    ctx.fillText(char, x, 13); ctx.restore(); x += width;
    if (x >= TILE_W) break;
  }
}
