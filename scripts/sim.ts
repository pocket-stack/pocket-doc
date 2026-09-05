import { mkdirSync, readFileSync } from "node:fs";
import { createWasmUi } from "../runtime/hosts/web/wasm-ops.js";
import { NODE_TYPE, PROP, ENUMS, BTN } from "../runtime/contracts/spec/spec.ts";
import { encodePNG } from "../runtime/tests/png.ts";
import { Library } from "../host/library.ts";
import { layout } from "../host/layout.ts";
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
const requests: string[] = [], replies: { at: number; raw: string; tile: boolean }[] = [];
let tick = 0, connected = -1, withholdTiles = false, maxPending = 0, maxTiles = 0, maxSlots = 0;
const checks: string[] = [];
function check(condition: unknown, message: string) { if (!condition) throw new Error(message); checks.push(message); }
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
async function tap(x: number, y: number) { await frames(1, 0, [x,y]); await frames(1); }
async function press(button: number) { await frames(1, button); await frames(1); }
mkdirSync("dist/qa", { recursive: true });
async function shot(name: string) {
  const rgba = wasm.render().slice(); await Bun.write(`dist/qa/${name}.png`, encodePNG(rgba, 400, 480)); return rgba;
}

await frames(2); const loadingA = await shot("loading-a");
await frames(22); const loadingB = await shot("loading-b");
check(Buffer.compare(loadingA, loadingB) !== 0, "Skeleton animation advances while the host is offline");
connected = 1; await frames(220); await shot("read");
check(s.total() === 1000 && s.doc()?.id === 1 && s.tiles.size > 20, "Both panes load from the full 1000-file library");
const original = s.scroll.offset();
await frames(1, BTN.LTRIGGER); await shot("menu-library");
check(s.menu() === "library" && s.scroll.offset() === original, "Holding L opens its menu without jumping");
await frames(1); await frames(1, BTN.RTRIGGER); await shot("menu-document");
check(s.menu() === "document" && s.scroll.offset() === original, "Holding R opens its menu without jumping");
await frames(1);

s.jump(0.4, "library"); await frames(40);
const listJump = s.libraryScroll.offset();
await press(BTN.DOWN);
check(s.selected() === Math.floor(listJump / 24) && Math.abs(s.libraryScroll.offset() - listJump) < 24,
  "D-pad after leaving selection offscreen selects the first visible file without returning to the old selection");
check(s.scroll.offset() === original, "Library navigation leaves document offset unchanged");
await tap(40, 55); check(s.focus() === "library", "Tapping the left pad focuses files without opening a document");
s.libraryScroll.stop(); s.jump(0, "library"); await frames(40);
await frames(1, 0, [75, 180]); await frames(1, 0, [75, 160]); await frames(1, 0, [75, 140]); await frames(1);
check(s.libraryScroll.offset() > 20 && s.scroll.offset() === original, "Left touchpad scrolls only the file list");
s.libraryScroll.stop(); s.jump(0, "library"); await frames(40);
await frames(1, 0, [230, 165]); await frames(1, 0, [230, 145]); await frames(1, 0, [230, 125]); await frames(1);
const before = s.scroll.offset(); connected = -1; await frames(25); const after = s.scroll.offset();
check(after > before + 100 && s.libraryScroll.offset() === 0, "Right touchpad inertia continues through disconnection without moving the list");
await shot("offline-scroll");
connected = 2; await frames(120); s.scroll.stop();

const tableRow = layout(readFileSync("data/library/note-0001.md", "utf8")).rows.findIndex((row, i) => i > 120 && row.table?.header);
check(tableRow > 120, "Fixture contains a table outside the initial prefetch window");
withholdTiles = true;
s.jump(tableRow * 20 / ((s.doc()!.rows * 20) - 194), "document"); await frames(20);
check(!!s.rowSpecs.get(tableRow)?.columns && s.rowResource(tableRow).status === "pending", "Table geometry arrives independently of its pending image");
await shot("table-loading"); const tableOffset = s.scroll.offset();
withholdTiles = false; await frames(110); await shot("table");
check(s.rowResource(tableRow).status === "ready" && s.scroll.offset() === tableOffset, "Table image replaces fallback without moving its viewport");

s.jump(0, "document"); await frames(100);
await press(BTN.RTRIGGER | BTN.CIRCLE); await frames(35);
check(s.mode() === "edit" && s.caret() === 0, "R+A opens editor once and does not also insert a newline");
await tap(55, 44); // w, via actual auxiliary touch hit facts
check(s.dirty() && s.draft()?.text.startsWith("w"), "Touch keyboard updates the draft immediately");
const beforeSpace = s.draft()!.text;
await tap(181, 121);
check(s.draft()!.text === beforeSpace.slice(0, 1) + " " + beforeSpace.slice(1), "A short space tap inserts exactly one local space");
const beforeDrag = s.draft()!.text, caretBeforeDrag = s.caret();
await frames(23, 0, [181, 121]);
check(s.caretDragging() && s.caretVisible(), "Holding space enters caret dragging and keeps the caret visible");
await frames(1, 0, [205, 121]); await frames(1, 0, [205, 137]); await frames(1);
check(s.draft()!.text === beforeDrag && s.caret() > caretBeforeDrag && !s.caretDragging(), "Space drag moves across columns and lines without inserting text");
await tap(183, 219);
await frames(23, 0, [181, 121]); await frames(1, 0, [205, 121]); await frames(1);
check(s.selecting() && s.selection()[1] > s.selection()[0], "Select and held-space drag create a source selection");
await frames(1, BTN.ZL); await shot("selection"); await frames(1); await shot("selection-open");
const selection = s.draft()!.text.slice(...s.selection());
await press(BTN.ZL | BTN.CROSS); // copy; no backspace leak
const copiedSource = s.draft()!.text;
check(copiedSource.includes(selection), "ZL+B copies without invoking the plain B delete action");
s.toggleSelect(); s.moveCaret(s.draft()!.text.length);
await press(BTN.ZL | BTN.TRIANGLE);
check(s.draft()!.text.endsWith(selection), "ZL+X pastes the selected text locally");
s.moveCaret(-s.caret());
await frames(1); check(s.caretVisible(), "Caret is visible immediately after movement");
await shot("caret-visible"); await frames(30); check(!s.caretVisible(), "Caret hides after its half-second visible phase");
await shot("caret-hidden");
s.moveCaret(1); check(s.caretVisible(), "Moving the caret restarts its visible phase immediately");
await tap(45, 174); check(s.focus() === "library" && !s.caretVisible(), "Bottom pane focus hides the inactive source caret");
await tap(245, 174); check(s.focus() === "document" && s.caretVisible(), "Touching the source pad restores document focus and caret");
const editorCaret = s.caret();
await frames(1, 0, [230, 193]); await frames(1, 0, [230, 177]); await frames(1);
check(s.editorScroll.offset() > 0 && s.caret() === editorCaret, "Editor pad scrolls the excerpt without moving its caret");
s.editorScroll.stop(); s.moveCaret(-s.caret()); await frames(1); await shot("edit");
const beforeRead = s.draft()!.text;
await tap(40, 13);
check(s.mode() === "read" && s.draft()!.text === beforeRead && s.dirty(), "Visible Read button exits editing and retains the local draft");
await shot("retained-draft"); await tap(268, 219);
check(s.mode() === "edit" && s.draft()!.text === beforeRead, "Resume touch button returns to the retained draft");
const retained = s.draft()!.text; connected = -2; await frames(20);
check(s.dirty() && s.draft()?.text === retained, "Disconnect preserves the unsaved draft");
await press(BTN.LTRIGGER | BTN.SELECT);
await frames(1, BTN.LTRIGGER | BTN.SELECT);
check(s.menu() === "selection", "L+SELECT reaches the selection bank on older 3DS hardware");
await frames(1);
check(maxPending <= 4 && maxTiles <= 72 && maxSlots <= 72, "Pending requests and document resource caches stay bounded throughout navigation");
const evidence = { frames: tick, simulatedLatencyFrames: 4, checks, inertiaBefore: before, inertiaAfter: after, maxPending, maxTiles, maxSlots,
  ...s.diagnostics(), note: "Compiled guest + Wasm replay on Mac. No hardware performance claim. No saves performed in real test library." };
await Bun.write("dist/qa/sim.json", JSON.stringify(evidence, null, 2)); console.log(evidence); library.close();
