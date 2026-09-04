import { createEffect, createSignal, createMemo, For, Show } from "solid-js";
import { AuxiliarySurface, Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { createGesture } from "@pocketjs/framework/gesture";
import { getOps } from "@pocketjs/framework/host";
import { createFolio, type Folio } from "./store.ts";
const SLOTS = Array.from({ length: 12 }, (_, i) => i);
const LETTERS = ["q w e r t y u i o p", "a s d f g h j k l DEL", "SHIFT z x c v b n m , .", "#+= / - SPACE ENTER DONE"];
const SYMBOLS = ["1 2 3 4 5 6 7 8 9 0", "[ ] ( ) { } # * _ DEL", "SHIFT ! ? : ; ' \" ` + =", "#+= / - SPACE ENTER DONE"];
function Button(p: { label: string; x: number; y: number; w: number; action: () => void }) {
  return <View class="absolute h-[24] rounded-[4] bg-[#323d45]" style={{ insetL: p.x, insetT: p.y, width: p.w }} onPress={p.action}>
    <Text class="absolute left-0 right-0 top-[5] text-xs text-center text-[#e2e8e8]">{p.label}</Text>
  </View>;
}
function Line(p: { s: Folio; slot: number }) {
  let image: NodeMirror | undefined;
  const row = () => Math.max(0, Math.floor(p.s.scroll.offset() / 20)) + p.slot;
  const tile = () => { p.s.version(); return p.s.tiles.get(row()); };
  createEffect(() => { const handle = tile()?.handle ?? -1; if (image) getOps().setImage(image.id, handle); });
  return <View class="absolute left-0 w-[384] h-[20] overflow-hidden" style={{ insetT: row() * 20, bgColor: tile()?.kind === 3 ? 0xffd6e0e5 : 0xffe4eef3 }}>
    <Image ref={node => { image = node; getOps().setImage(node.id, tile()?.handle ?? -1); }} class="absolute left-0 top-[2] w-[512] h-[16]" />
    <Show when={!tile()}><View class="absolute left-[3] top-[7] w-[180] h-[3] bg-[#e2dccf]" /></Show>
  </View>;
}
function TextTile(p: { s: Folio; value: () => string; x: number; y: number }) {
  let node: NodeMirror | undefined;
  const value = () => p.value().replace("\u0001", "");
  const handle = () => { p.s.version(); return /[^\x00-\x7f]/.test(value()) ? p.s.textTiles.get(value()) ?? -1 : -1; };
  createEffect(() => { const id = handle(); if (node) getOps().setImage(node.id, id); });
  return <Image ref={n => { node = n; getOps().setImage(n.id, handle()); }} class="absolute w-[512] h-[16]" style={{ insetL: p.x, insetT: p.y }} />;
}
function LibraryRow(p: { s: Folio; slot: number }) {
  const index = () => Math.max(0, Math.floor(p.s.libraryScroll.offset() / 24)) + p.slot;
  const row = () => { p.s.version(); return p.s.files.get(index()); };
  return <View class="absolute left-0 right-0 h-[24]" style={{ insetT: index() * 24, bgColor: index() === p.s.selected() ? 0xffe2e1d4 : 0xffe4eef3 }}>
    <Text class="absolute left-[10] top-[4] text-xs text-[#819091]">{String(index() + 1).padStart(4, "0")}</Text>
    <Text class="absolute left-[48] top-[4] text-sm text-[#303b41]">{row() && /[^\x00-\x7f]/.test(row()!.title) ? "" : row()?.title.slice(0, 36) ?? "Loading..."}</Text>
    <TextTile s={p.s} value={() => row()?.title.slice(0, 36) ?? ""} x={48} y={4} />
    <Text class="absolute right-[9] top-[5] text-xs text-[#788486]">{row() ? `${Math.ceil(row()!.bytes / 1024)}k` : ""}</Text>
  </View>;
}
function Keyboard(p: { s: Folio }) {
  const [pressed, setPressed] = createSignal("");
  const keys = () => (p.s.symbols() ? SYMBOLS : LETTERS).flatMap((line, row) => {
    const values = line.split(" "), width = 304 / values.length;
    return values.map((value, col) => ({ value, x: 8 + width * col, y: 46 + row * 26, w: width - 2 }));
  });
  let root: NodeMirror | undefined;
  createGesture({ surface: "auxiliary", region: { node: () => root },
    onDown(c) { if (p.s.mode() !== "edit" && p.s.mode() !== "search") return; const hit = keys().find(k => c.x >= k.x && c.x < k.x + k.w + 2 && c.y >= k.y && c.y < k.y + 26); if (hit) { setPressed(hit.value); p.s.key(hit.value); } },
    onUp() { setPressed(""); }, onCancel() { setPressed(""); },
  });
  return <View ref={root} class="absolute left-0 top-[44] w-[320] h-[106]" style={{ display: p.s.mode() === "edit" || p.s.mode() === "search" ? 0 : 1 }}>
    <For each={keys()}>{k => <View class="absolute h-[23] rounded-[3] bg-[#35424b]" style={{ insetL: k.x, insetT: k.y - 44, width: k.w, bgColor: pressed() === k.value ? 0xff9e986a : 0xff4b4235 }}>
      <Text class="absolute left-0 right-0 top-[5] text-xs text-center text-[#eef0e9]">{p.s.shift() && k.value.length === 1 ? k.value.toUpperCase() : k.value}</Text>
    </View>}</For>
  </View>;
}
function Deck(p: { s: Folio }) {
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);
  let pad: NodeMirror | undefined, map: NodeMirror | undefined;
  const typing = () => p.s.mode() === "edit" || p.s.mode() === "search";
  createGesture({ surface: "auxiliary", region: { node: () => pad }, axis: "any", panSlop: 2,
    onDown: () => { if (!typing()) p.s.activeScroll().beginDrag(); },
    onPanMove: c => { if (typing()) p.s.moveCaret(Math.round(c.fdx / 3) + Math.round(c.fdy / 12) * 48); else p.s.activeScroll().drag(-c.fdy * 1.8); },
    onPanEnd: c => { if (!typing()) p.s.activeScroll().endDrag(-c.vy * 1.8); },
    onTap: () => { if (!typing()) { if (p.s.mode() === "library") p.s.setSelected(Math.max(0, Math.floor(p.s.libraryScroll.offset() / 24))); p.s.activate(); } },
    onCancel: () => p.s.activeScroll().stop(),
  });
  createGesture({ surface: "auxiliary", region: { node: () => map }, axis: "y", panSlop: 1,
    onDown: c => p.s.jump((c.y - 42) / 150), onPanMove: c => p.s.jump((c.y - 42) / 150),
  });
  return <View debugName="FolioDeck" class="relative w-full h-full bg-[#202a32]">
    <Text class="absolute left-[10] top-[7] text-xs font-bold text-[#84bbc0]">{typing() ? "WRITE" : "NAVIGATE"}</Text>
    <Text class="absolute right-[10] top-[7] text-xs text-[#b1bdc0]">{typing() ? "keyboard + trackpad" : "L / R  jump"}</Text>
    <Text class="absolute left-[10] top-[27] text-xs text-[#c2cac7]">{typing() ? p.s.mode() === "search" ? p.s.query() || "Search all documents..." : "A enter   B delete   START save" : p.s.mode() === "library" ? "D-pad selects   A opens   SELECT searches" : "A edits   B library   Y follows link"}</Text>
    <Keyboard s={p.s} />
    <View debugName="Trackpad" ref={pad} class="absolute left-[10] rounded-[7] border border-[#53636b] bg-[#29353e]" style={{ insetT: typing() ? 156 : 46, width: typing() ? 222 : 218, height: typing() ? 48 : 148 }}>
      <View class="absolute left-[12] right-[12] top-[8] h-[1] bg-[#374650]" />
      <Text class="absolute left-0 right-0 text-center text-xs text-[#95a6aa]" style={{ insetT: typing() ? 19 : 56 }}>{typing() ? "slide to move the cursor" : "slide to scroll"}</Text>
      <Show when={!typing()}><Text class="absolute left-0 right-0 top-[78] text-center text-xs text-[#657e88]">lift to coast  /  tap to open</Text></Show>
    </View>
    <Show when={!typing()}>
      <View debugName="Minimap" ref={map} class="absolute left-[240] top-[42] w-[68] h-[150] rounded-[4] bg-[#eee8dc] overflow-hidden">
        <For each={Array.from({ length: 26 }, (_, i) => i)}>{i => <View class="absolute left-[7] h-[2] bg-[#bdc1b5]" style={{ insetT: 6 + i * 5, width: p.s.doc()?.mini[i] ?? 38 }} />}</For>
        <For each={p.s.doc()?.outline ?? []}>{h => <View class="absolute left-[3] w-[58] h-[2] bg-[#739397]" style={{ insetT: 4 + h.row / Math.max(1, p.s.doc()!.rows) * 140 }} />}</For>
        <View class="absolute left-[2] w-[64] h-[12] border border-[#4c8e99] bg-[#6eafb333]" style={{ insetT: Math.min(136, Math.max(0, p.s.activeScroll().offset() / Math.max(1, p.s.mode() === "library" ? p.s.total() * 24 : (p.s.doc()?.rows ?? 0) * 20) * 140)) }} />
      </View>
      <Text class="absolute left-[240] top-[196] text-xs text-[#82999c]">minimap</Text>
    </Show>
    <Show when={typing()}>
      <Button x={242} y={156} w={66} label="<" action={() => p.s.moveCaret(-1)} />
      <Button x={242} y={183} w={66} label=">" action={() => p.s.moveCaret(1)} />
    </Show>
    <Button x={10} y={211} w={68} label={typing() ? "READ" : "LIBRARY"} action={() => typing() ? p.s.setMode(p.s.doc() ? "read" : "library") : p.s.back()} />
    <Button x={84} y={211} w={68} label={typing() ? "SAVE" : "EDIT"} action={() => typing() ? p.s.mode() === "search" ? p.s.search() : p.s.save() : p.s.activate()} />
    <Button x={158} y={211} w={72} label={typing() ? "SPACE" : "LINK"} action={() => typing() ? p.s.key("SPACE") : p.s.followLink()} />
    <Button x={236} y={211} w={72} label={typing() && p.s.mode() === "edit" ? confirmDiscard() ? "CONFIRM" : "DISCARD" : "SEARCH"} action={() => { if (p.s.mode() === "edit") { if (confirmDiscard()) { p.s.discard(); setConfirmDiscard(false); } else setConfirmDiscard(true); } else p.s.setMode("search"); }} />
  </View>;
}
export default function FolioApp() {
  const s = createFolio();
  (globalThis as any).__folio = s;

  return <>
    <View debugName="PocketFolio" class="relative w-full h-full bg-[#f3eee4] overflow-hidden">
      <View class="absolute left-0 top-0 right-0 h-[29] bg-[#293740]">
        <View class="absolute left-[9] top-[8] w-[10] h-[13] border border-[#88bdc0] rounded-[1]" />
        <Text class="absolute left-[26] top-[7] text-sm font-bold text-[#eef0e9]">{s.mode() === "library" || s.mode() === "search" ? "Pocket Folio" : /[^\x00-\x7f]/.test(s.doc()?.title ?? "") ? `Document ${s.doc()?.id}` : s.doc()?.title.slice(0, 38)}</Text>
        <View class="absolute right-[10] top-[11] w-[6] h-[6] rounded-full" style={{ bgColor: s.online() ? 0xffa5b683 : 0xff75adcf }} />
      </View>
      <Show when={s.mode() === "library" || s.mode() === "search"}>
        <View class="absolute left-0 top-[30] right-0 h-[192] overflow-hidden">
          <View class="absolute left-0 right-0 top-0" style={{ translateY: -s.libraryScroll.offset() }}><For each={SLOTS}>{slot => <LibraryRow s={s} slot={slot} />}</For></View>
        </View>
      </Show>
      <Show when={s.mode() === "read"}>
        <View class="absolute left-[8] top-[30] w-[384] h-[196] overflow-hidden">
          <View class="absolute left-0 top-0 w-[384]" style={{ translateY: -s.scroll.offset() }}><For each={SLOTS}>{slot => <Line s={s} slot={slot} />}</For></View>
        </View>
      </Show>
      <View class="absolute left-[10] top-[35] w-[380] h-[190] overflow-hidden" style={{ display: s.mode() === "edit" ? 0 : 1 }}>
          <Text class="absolute left-0 top-0 text-xs text-[#5e7e84]">{`SOURCE  ${s.draft()?.start ?? 0}..${s.draft()?.end ?? 0}  ${s.dirty() ? "unsaved" : "unchanged"}`}</Text>
          <For each={SLOTS}>{index => <><Text class="absolute left-0 text-xs font-mono text-[#384147]" style={{ insetT: 22 + index * 18 }}>{/[^\x00-\x7f]/.test(s.sourceLines()[index] ?? "") ? "" : (s.sourceLines()[index] ?? "").replace("\u0001", "|")}</Text><TextTile s={s} value={() => s.sourceLines()[index] ?? ""} x={0} y={22 + index * 18} /><View class="absolute w-[1] h-[15] bg-[#3e7d89]" style={{ display: (s.sourceLines()[index] ?? "").includes("\u0001") && /[^\x00-\x7f]/.test(s.sourceLines()[index] ?? "") ? 0 : 1, insetT: 22 + index * 18, insetL: Array.from((s.sourceLines()[index] ?? "").split("\u0001")[0]).reduce((n, char) => n + (char.codePointAt(0)! > 255 ? 12 : 7), 0) }} /></>}</For>
        </View>
      <View class="absolute left-0 right-0 bottom-0 h-[15] bg-[#dce1d9]">
        <Text class="absolute left-[8] top-0 text-xs text-[#4f696e]">{s.status().slice(0, 65)}</Text>
      </View>
    </View>
    <AuxiliarySurface><Deck s={s} /></AuxiliarySurface>
  </>;
}
