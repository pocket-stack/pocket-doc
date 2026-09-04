import { getOps } from "@pocketjs/framework/host";
import { uploadCoverage } from "@pocketjs/framework/offload";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function uploadLine(mask: string, kind: number) {
  if (mask.length !== 2048 || !/^[A-Za-z0-9+/]+$/.test(mask)) throw new Error("Invalid line mask");
  const native = uploadCoverage(mask, 384, 16, kind === 1 ? 0xff745b30 : kind === 2 ? 0xff405b6e : 0xff3b3633);
  if (native !== undefined) return native;
  const pixels = new Uint8Array(512 * 16 * 4);
  const color = kind === 1 ? [48, 91, 116] : kind === 2 ? [110, 91, 64] : [51, 54, 59];
  let pixel = 0;
  for (let i = 0; i < mask.length; i += 4) {
    const v = (alphabet.indexOf(mask[i]) << 18) | (alphabet.indexOf(mask[i + 1]) << 12) | (alphabet.indexOf(mask[i + 2]) << 6) | alphabet.indexOf(mask[i + 3]);
    for (let byte = 2; byte >= 0; byte--) {
      const value = (v >> (byte * 8)) & 255;
      for (let part = 0; part < 4; part++, pixel++) {
        const p = (Math.floor(pixel / 384) * 512 + pixel % 384) * 4;
        pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; pixels[p + 3] = ((value >> (part * 2)) & 3) * 85;
      }
    }
  }
  return getOps().uploadTexture(pixels, 512, 16, 3); // PSM_8888, fixed upload size
}
