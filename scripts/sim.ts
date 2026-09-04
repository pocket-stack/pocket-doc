import { mkdirSync } from "node:fs";
import { createWasmUi } from "../runtime/hosts/web/wasm-ops.js";
import { NODE_TYPE, PROP, ENUMS, BTN } from "../runtime/contracts/spec/spec.ts";
import { encodePNG } from "../runtime/tests/png.ts";
import { Library } from "../host/library.ts";
import { dispatchOffload } from "../runtime/tools/offload-provider.ts";
import type { Folio } from "../app/store.ts";
const library = new Library("data/library"); library.index();
const wasm = await createWasmUi(await Bun.file("runtime/hosts/web/pocketjs.wasm").arrayBuffer(), { width: 400, height: 480 });
const ops = wasm.ops;
(ops as typeof ops & { __viewport: { w: number; h: number } }).__viewport = { w: 400, h: 240 };
const auxiliary = ops.createNode(NODE_TYPE.view);
ops.setProp(auxiliary, PROP.posType, ENUMS.PosType.Absolute);
ops.setProp(auxiliary, PROP.insetL, 40); ops.setProp(auxiliary, PROP.insetT, 240);
ops.setProp(auxiliary, PROP.width, 320); ops.setProp(auxiliary, PROP.height, 240);
ops.insertBefore(1, auxiliary, 0);
ops.__auxiliarySurface = { root: auxiliary, w: 320, h: 240 };
const requests: string[] = [], replies: { at: number; raw: string }[] = [];
let tick = 0, connected = 1;
Object.assign(globalThis, {
  ui: ops, __pak: await Bun.file("runtime/dist/3ds/guest/pocketfolio-main.pak").arrayBuffer(), __simHz: 60,
  offload: { session: () => connected, submit: (raw: string) => { requests.push(raw); return true; }, take: () => replies[0]?.at <= tick ? replies.shift()!.raw : undefined },
});
(0, eval)(await Bun.file("runtime/dist/3ds/guest/pocketfolio-main.js").text());
const s = (globalThis as any).__folio as Folio;
const times: number[] = [];
async function frames(n: number, buttons = 0) {
  for (let i = 0; i < n; i++) {
    tick++;
    const begin = performance.now(); (globalThis as any).frame(buttons, 0x8080, [], [], []); wasm.tick();
    times.push(performance.now() - begin);
    // Provider work deliberately occurs outside the timed UI transaction.
    for (const raw of requests.splice(0)) replies.push({ at: tick + 4, raw: JSON.stringify(await dispatchOffload(library.methods(), JSON.parse(raw))) });
  }
}
mkdirSync("dist/qa", { recursive: true });
function shot(name: string) { const rgba = wasm.render(); Bun.write(`dist/qa/${name}.png`, encodePNG(rgba, 400, 480)); }
await frames(35); shot("library");
if (s.total() !== 1000) throw new Error(`Library not loaded: ${s.status()}`);
await frames(1, BTN.CIRCLE); await frames(160); shot("read");
if (s.mode() !== "read" || s.tiles.size < 20) throw new Error(`Reader failed: ${s.status()}`);
s.scroll.beginDrag(); s.scroll.drag(100); s.scroll.endDrag(1400);
const before = s.scroll.offset(); connected = -1;
await frames(25); const after = s.scroll.offset(); shot("offline-scroll");
if (after <= before + 100) throw new Error("Inertia stopped when provider disconnected");
connected = 2; await frames(120);
s.scroll.scrollTo(0, { immediate: true }); await frames(80);
s.edit(); await frames(35); s.key("Z"); await frames(2); shot("edit");
if (!s.dirty() || !s.draft()?.text.startsWith("Z")) throw new Error("Edit did not retain local input");
connected = -2; await frames(20);
if (!s.dirty() || !s.draft()?.text.startsWith("Z")) throw new Error("Disconnect lost draft");
times.sort((a,b) => a-b);
const evidence = { frames: tick, simulatedLatencyFrames: 4, inertiaBefore: before, inertiaAfter: after, ...s.diagnostics(), uiMs: { p50: times[Math.floor(times.length*.5)], p95: times[Math.floor(times.length*.95)], max: times.at(-1) }, note: "Wasm simulation on Mac; hardware timing measured separately. No saves performed in real test library." };
await Bun.write("dist/qa/sim.json", JSON.stringify(evidence, null, 2)); console.log(evidence); library.close();
