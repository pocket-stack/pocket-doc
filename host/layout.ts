import { createCanvas, GlobalFonts } from "../runtime/node_modules/@napi-rs/canvas";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const cjkPaths = [process.env.FOLIO_CJK_FONT ?? "", "/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Light.ttc", "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"];
const cjk = cjkPaths.find(path => path && existsSync(path));
if (!cjk || !GlobalFonts.registerFromPath(cjk, "FolioCJK")) throw new Error("Install a CJK font or set FOLIO_CJK_FONT");
for (const [path, name] of [["/System/Library/Fonts/Supplemental/Arial.ttf", "FolioLatin"], ["/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "FolioUnicode"]]) {
  if (existsSync(path)) GlobalFonts.registerFromPath(path, name);
}
export const LAYOUT_REVISION = createHash("sha256").update(readFileSync(cjk)).update("folio-coverage-v2-13px").digest("hex").slice(0, 16);
export const TILE_W = 384, TILE_H = 16, LINE_H = 20;
export type Row = { text: string; start: number; end: number; kind: number };
const canvas = createCanvas(TILE_W, TILE_H);
const ctx = canvas.getContext("2d");
const font = (kind: number) => kind === 1 ? "bold 14px FolioLatin, FolioCJK, FolioUnicode" : kind === 3 ? "12px monospace, FolioCJK, FolioUnicode" : "13px FolioLatin, FolioCJK, FolioUnicode";
/** Layout is computed once per revision, on the provider worker. Offsets refer
 * to original UTF-16 source so rendered rows remain editable. */
export function layout(source: string) {
  const rows: Row[] = [], outline: { row: number; title: string }[] = [];
  let start = 0, code = false;
  for (const line of source.split("\n")) {
    let text = line, kind = 0, prefix = 0;
    if (/^```/.test(line)) { code = !code; text = code ? "CODE" : ""; kind = 3; }
    else if (code) kind = 3;
    else if (/^#{1,6} /.test(line)) {
      prefix = line.indexOf(" ") + 1; text = line.slice(prefix); kind = 1;
      outline.push({ row: rows.length, title: text.slice(0, 42) });
    } else if (line.startsWith("> ")) { kind = 2; prefix = 2; text = line.slice(2); }
    else if (line.startsWith("|")) kind = 4;
    else if (/^[-*] /.test(line)) kind = 2;
    ctx.font = font(kind);
    let piece = "", pieceStart = prefix, offset = prefix;
    for (const char of text) {
      if (piece && ctx.measureText(piece + char).width > TILE_W - 12) {
        rows.push({ text: piece, start: start + pieceStart, end: start + offset, kind });
        pieceStart = offset; piece = "";
      }
      piece += char; offset += char.length;
    }
    rows.push({ text: piece, start: start + pieceStart, end: Math.min(start + line.length, start + offset), kind });
    start += line.length + 1;
  }
  return { rows, outline };
}
/** 2-bit alpha mask: 1,536 bytes per line, independent of Unicode coverage.
 * The device expands exactly 6,144 pixels and uploads one fixed-size tile. */
export function raster(row: Row): string {
  ctx.clearRect(0, 0, TILE_W, TILE_H);
  ctx.fillStyle = "white"; ctx.font = font(row.kind); ctx.textBaseline = "alphabetic";
  ctx.fillText(row.text, row.kind === 2 ? 8 : 2, 13);
  const rgba = ctx.getImageData(0, 0, TILE_W, TILE_H).data;
  const mask = Buffer.alloc(TILE_W * TILE_H / 4);
  for (let i = 0; i < TILE_W * TILE_H; i++) mask[i >> 2] |= Math.round(rgba[i * 4 + 3] / 85) << ((i & 3) * 2);
  return mask.toString("base64");
}
