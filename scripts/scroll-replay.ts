import { mkdirSync } from "node:fs";
import { createWasmUi } from "../runtime/hosts/web/wasm-ops.js";
import { NODE_TYPE, PROP, ENUMS, BTN } from "../runtime/contracts/spec/spec.ts";
import { Library } from "../host/library.ts";
import { dispatchOffload } from "../runtime/tools/offload-provider.ts";
import type { Folio } from "../app/store.ts";
const library = new Library("data/library"); library.index();
const wasm = await createWasmUi(await Bun.file("runtime/hosts/web/pocketjs.wasm").arrayBuffer(), { width: 400, height: 480 });
const ops = wasm.ops;
let calls: Record<string, number> = {};
for (const name of ["setProp", "setStyle", "setText", "setImage", "createNode", "destroyNode", "insertBefore", "removeChild"]) {
 const original = (ops as any)[name];
 (ops as any)[name] = (...args: any[]) => { calls[name] = (calls[name] ?? 0) + 1; return original(...args); };
}
(ops as typeof ops & { __viewport: { w: number; h: number } }).__viewport = { w: 400, h: 240 };
const auxiliary = ops.createNode(NODE_TYPE.view);
ops.setProp(auxiliary, PROP.posType, ENUMS.PosType.Absolute);
ops.setProp(auxiliary, PROP.insetL, 40); ops.setProp(auxiliary, PROP.insetT, 240);
ops.setProp(auxiliary, PROP.width, 320); ops.setProp(auxiliary, PROP.height, 240);
ops.insertBefore(1, auxiliary, 0);
ops.__auxiliarySurface = { root: auxiliary, w: 320, h: 240 };
const requests: string[] = [], replies: { at: number; raw: string; tile: boolean }[] = [];
let tick = 0, connected = -1, withholdTiles = false, maxPending = 0, maxTiles = 0, maxSlots = 0;
Object.assign(globalThis, {
  ui: ops, __pak: await Bun.file("runtime/dist/3ds/guest/pocketfolio-main.pak").arrayBuffer(), __simHz: 60,
  offload: {
    session: () => connected, submit: (raw: string) => { requests.push(raw); return true; },
    take: () => { const i = replies.findIndex(reply => reply.at <= tick && !(withholdTiles && reply.tile)); return i < 0 ? undefined : replies.splice(i, 1)[0].raw; },
  },
});
(0, eval)(await Bun.file("runtime/dist/3ds/guest/pocketfolio-main.js").text());
const s = (globalThis as any).__folio as Folio;
let hit: number | undefined;
async function frames(n: number, buttons = 0, touch?: [number, number], analog = 0x8080) {
  if (touch && hit === undefined) { wasm.render(); hit = ops.hitTestBounds!(touch[0] + 40, touch[1] + 240); }
  if (!touch) hit = undefined;
  for (let i = 0; i < n; i++) {
    tick++;
    (globalThis as any).frame(buttons, analog, touch ? [touch[0] | touch[1] << 9] : [], touch ? [hit] : [], touch ? [1] : []);
    wasm.tick();
    const d = s.diagnostics(); maxPending = Math.max(maxPending, d.pending); maxTiles = Math.max(maxTiles, d.cachedTiles); maxSlots = Math.max(maxSlots, d.resourceSlots);
    // Host work is explicit and separate. This replay verifies behavior, not hardware performance.
    for (const raw of requests.splice(0)) {
      const req = JSON.parse(raw);
      if (req.method === "document.save") throw new Error("Replay must not write the user's test library");
      replies.push({ at: tick + 4, tile: req.method === "document.tile", raw: JSON.stringify(await dispatchOffload(library.methods(), req)) });
    }
  }
}
mkdirSync("dist/qa", { recursive: true });

connected = 1; await frames(240); s.setFocus("document");
const segments = [];
for (const [name, analog] of [["down", 0x80ff], ["up", 0x8000]] as const) {
 const samples = [];
 for (let i = 0; i < 180; i++) {
   calls = {}; const before = s.scroll.offset();
   await frames(1, 0, undefined, analog); wasm.render();
   samples.push({ delta: s.scroll.offset() - before, calls: {...calls} });
 }
 segments.push({name, samples, total: samples.reduce((sum,s) => sum + Object.values(s.calls).reduce((a,b)=>a+b,0),0)});
}
if (process.argv[2] !== "before") {
  if (segments.some(s => s.total > 1800)) throw new Error("Continuous scroll exceeded its native update budget");
  const steady = segments[0].samples.slice(30).map(s => s.delta);
  if (Math.max(...steady) - Math.min(...steady) > 0.01) throw new Error("Constant stick input changed steady-state speed");
  if (maxPending > 4 || maxTiles > 72 || maxSlots > 72) throw new Error("Scroll exceeded resource bounds");
}
await Bun.write(`dist/qa/scroll-${process.argv[2] ?? "latest"}.json`, JSON.stringify({segments, maxPending, maxTiles, maxSlots},null,2));
console.log(segments.map(s=>({name:s.name,total:s.total, peak:Math.max(...s.samples.map(s=>Object.values(s.calls).reduce((a,b)=>a+b,0)))})));
library.close();
