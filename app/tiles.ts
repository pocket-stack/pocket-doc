import { getOps } from "@pocketjs/framework/host";
import { uploadCoverage } from "@pocketjs/framework/offload";
import { BODY_W } from "../shared/layout.ts";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export const textTileKey = (text: string, inverse = false) => `${inverse ? "selected:" : "normal:"}${text}`;
export function uploadLine(mask: string, kind: number, inverse = false) {
  if (mask.length !== 1368 || !/^[A-Za-z0-9+/]+={0,2}$/.test(mask)) throw new Error("Invalid line mask");
  const color = inverse ? [255, 255, 255] : kind === 1 ? [38, 70, 111] : kind === 2 ? [88, 102, 120] : [34, 39, 46];
  const foreground = (0xff000000 | color[2] << 16 | color[1] << 8 | color[0]) >>> 0;
  const native = uploadCoverage(mask, BODY_W, 16, foreground);
  if (native !== undefined) return native;
  const pixels = new Uint8Array(BODY_W * 16 * 4);
  let pixel = 0;
  for (let i = 0; i < mask.length; i += 4) {
    const v = (alphabet.indexOf(mask[i]) << 18) | (alphabet.indexOf(mask[i + 1]) << 12) |
      (Math.max(0, alphabet.indexOf(mask[i + 2])) << 6) | Math.max(0, alphabet.indexOf(mask[i + 3]));
    for (let byte = 2; byte >= 0 && pixel < BODY_W * 16; byte--) {
      const value = (v >> (byte * 8)) & 255;
      for (let part = 0; part < 4; part++, pixel++) {
        const p = pixel * 4;
        pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; pixels[p + 3] = ((value >> (part * 2)) & 3) * 85;
      }
    }
  }
  return getOps().uploadTexture(pixels, BODY_W, 16, 3);
}
