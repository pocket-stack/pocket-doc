import { createSignal, For, Show } from "solid-js";
import { AuxiliarySurface, Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { ResourceBoundary, ResourceImage, pending, ready, type TextureResource } from "@pocketjs/framework/resource";
import { createGesture } from "@pocketjs/framework/gesture";
import { createFolio, type Folio } from "./store.ts";
import { BANKS, type Bank } from "./commands.ts";
import { textCells } from "./editor.ts";
import { BODY_W, FILE_H, LINE_H, SOURCE_COLUMNS, VIEW_H } from "../shared/layout.ts";
const SLOTS = Array.from({ length: 12 }, (_, i) => i);
const LETTERS = ["q w e r t y u i o p", "a s d f g h j k l DEL", "SHIFT z x c v b n m , .", "#+= / - SPACE ENTER DONE"];
const SYMBOLS = ["1 2 3 4 5 6 7 8 9 0", "[ ] ( ) { } # * _ DEL", "SHIFT ! ? : ; ' \" ` + =", "#+= / - SPACE ENTER DONE"];

function Skeleton(p: { width?: number; columns?: number[] }) {
  return <View debugName={p.columns ? "TableSkeleton" : "TextSkeleton"} class="relative w-full h-full animate-pulse">
    <Show when={p.columns} fallback={<View class="absolute left-[3] top-[5] h-[6] rounded-[2] bg-[#d8dee6]" style={{ width: p.width ?? 110 }} />}>
      <For each={p.columns}>{(width, index) => <View class="absolute top-[5] h-[6] rounded-[2] bg-[#d4dde8]" style={{ insetL: p.columns!.slice(0, index()).reduce((a, b) => a + b, 0) + 4, width: Math.max(3, width - 12) }} />}</For>
    </Show>
  </View>;
}

function AsyncText(p: { s: Folio; value: () => string; width: number; size?: "small" | "normal"; mono?: boolean }) {
  const unicode = () => /[^\x00-\x7f]/.test(p.value());
  return <View class="relative h-[18] overflow-hidden" style={{ width: p.width }}>
    <Show when={unicode()} fallback={<Text class={p.mono ? "absolute left-0 top-0 text-xs font-mono text-[#22272e]" : p.size === "small" ? "absolute left-0 top-0 text-xs text-[#22272e]" : "absolute left-0 top-0 text-sm text-[#22272e]"}>{p.value()}</Text>}>
      <ResourceImage class="relative h-[16] overflow-hidden" style={{ width: p.width }} state={() => {
        p.s.version(); const handle = p.s.textTiles.get(p.value());
        return handle === undefined ? pending<TextureResource>() : ready({ handle, width: BODY_W, height: 16 });
      }} fallback={() => <Skeleton width={Math.max(12, p.width - 12)} />} />
    </Show>
  </View>;
}

function LibraryRow(p: { s: Folio; slot: number }) {
  const index = () => Math.max(0, Math.floor(p.s.libraryScroll.offset() / FILE_H)) + p.slot;
  return <View debugName="FileRow" class={index() === p.s.selected()
    ? "absolute left-0 w-[127] h-[24] overflow-hidden bg-gradient-to-b from-[#dce9f9] to-[#b9d2ef]"
    : "absolute left-0 w-[127] h-[24] overflow-hidden bg-white"} style={{ insetT: index() * FILE_H, display: p.s.total() && index() >= p.s.total() ? 1 : 0 }}>
    <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e1e4e8]" />
    <ResourceBoundary state={() => p.s.fileResource(index())} fallback={() => <View class="absolute left-[6] top-[4] w-[110] h-[16]"><Skeleton width={96 - p.slot % 3 * 12} /></View>}>
      {file => <>
        <Show when={p.s.doc()?.id === file().id}><View class="absolute left-0 top-[3] bottom-[3] w-[3] bg-[#397cca]" /></Show>
        <View class="absolute left-[7] top-[4]"><AsyncText s={p.s} value={() => file().title.slice(0, 17)} width={114} /></View>
      </>}
    </ResourceBoundary>
  </View>;
}

function DocumentRow(p: { s: Folio; slot: number }) {
  const row = () => Math.max(0, Math.floor(p.s.scroll.offset() / LINE_H)) + p.slot;
  const spec = () => { p.s.version(); return p.s.rowSpecs.get(row()); };
  return <View debugName="DocumentBand" class="absolute left-0 w-[256] h-[20] overflow-hidden" style={{ insetT: row() * LINE_H,
    bgColor: spec()?.header ? 0xfff0e7df : spec()?.kind === 3 ? 0xfff6f3f0 : 0xffffffff }}>
    <Show when={spec()?.columns}>
      <View class="absolute left-0 right-0 top-0 h-[1] bg-[#c7d0dc]" />
      <For each={spec()?.columns}>{(_, index) => <View class="absolute top-0 bottom-0 w-[1] bg-[#c7d0dc]" style={{ insetL: spec()!.columns!.slice(0, index()).reduce((a, b) => a + b, 0) }} />}</For>
      <View class="absolute right-0 top-0 bottom-0 w-[1] bg-[#c7d0dc]" />
    </Show>
    <ResourceImage class="absolute left-0 top-[2] w-[256] h-[16] overflow-hidden" state={() => {
      const state = p.s.rowResource(row());
      return state.status === "ready" ? ready({ handle: state.value.handle, width: BODY_W, height: 16 }) : state;
    }} fallback={() => <Skeleton width={180 - p.slot % 3 * 24} columns={spec()?.columns} />}
      errorFallback={() => <Text class="text-xs text-[#8b6f64]">Content unavailable</Text>} />
  </View>;
}

function SourceRow(p: { s: Folio; index: number }) {
  const row = () => p.s.editorRows()[p.index];
  const cursor = () => p.s.editorRows().findIndex(r => p.s.caret() >= r.start && p.s.caret() <= r.end);
  const left = () => row() ? textCells(row()!.text.slice(0, Math.max(0, p.s.selection()[0] - row()!.start))) * 8 : 0;
  const right = () => row() ? textCells(row()!.text.slice(0, Math.max(0, p.s.selection()[1] - row()!.start))) * 8 : 0;
  return <View class="absolute left-0 w-[256] h-[18] overflow-hidden" style={{ insetT: 22 + p.index * 18 }}>
    <View class="absolute top-0 h-[16] bg-[#bbd9ff]" style={{ insetL: left(), width: Math.max(0, right() - left()) }} />
    <AsyncText s={p.s} value={() => row()?.text ?? ""} width={248} mono />
    <View class="absolute top-0 w-[1] h-[16] bg-[#246cc3]" style={{ display: cursor() === p.index ? 0 : 1,
      insetL: row() ? textCells(row()!.text.slice(0, p.s.caret() - row()!.start)) * 8 : 0 }} />
  </View>;
}

function ContextMenu(p: { s: Folio; bank: Bank }) {
  const bank = BANKS[p.bank];
  return <View debugName={`Context-${p.bank}`} class="absolute top-[29] w-[184] h-[147] rounded-[5] border border-[#657c99] bg-[#f7f9fc] overflow-hidden"
    style={{ insetL: bank.side === "left" ? 5 : 211, display: p.s.menu() === p.bank ? 0 : 1 }}>
    <View class="absolute left-0 right-0 top-0 h-[25] bg-gradient-to-b from-[#91a9c5] to-[#55779f]">
      <Text class="absolute left-[8] top-[5] text-xs font-bold text-white">{bank.title}</Text>
    </View>
    <For each={bank.actions}>{(item, index) => <View class="absolute left-[7] right-[7] h-[24]" style={{ insetT: 29 + index() * 24 }}>
      <View class="absolute left-0 top-[2] w-[18] h-[18] rounded-full border border-[#a4b2c3] bg-white"><Text class="absolute left-0 right-0 top-[2] text-center text-xs font-bold text-[#355c8b]">{item.key}</Text></View>
      <Text class="absolute left-[25] top-[4] text-xs text-[#283d58]">{item.action === "discard" && p.s.confirmDiscard() ? "Confirm discard" : item.label}</Text>
    </View>}</For>
    <Text class="absolute left-[8] bottom-[5] text-xs text-[#6d7f95]">D-pad: focus / navigate</Text>
  </View>;
}

function Keyboard(p: { s: Folio }) {
  const [pressed, setPressed] = createSignal("");
  const keys = () => (p.s.symbols() ? SYMBOLS : LETTERS).flatMap((line, row) => {
    const values = line.split(" "), width = 304 / values.length;
    return values.map((value, col) => ({ value, x: 8 + width * col, y: 32 + row * 26, w: width - 2 }));
  });
  let root: NodeMirror | undefined;
  createGesture({ surface: "auxiliary", region: { node: () => root },
    onDown(c) {
      if (p.s.mode() !== "edit" && p.s.mode() !== "search") return;
      const hit = keys().find(k => c.x >= k.x && c.x < k.x + k.w + 2 && c.y >= k.y && c.y < k.y + 26);
      if (hit) { setPressed(hit.value); p.s.key(hit.value); }
    },
    onUp: () => setPressed(""), onCancel: () => setPressed(""),
  });
  return <View ref={root} debugName="FolioKeyboard" class="absolute left-0 top-[30] w-[320] h-[108]" style={{ display: p.s.mode() === "edit" || p.s.mode() === "search" ? 0 : 1 }}>
    <For each={keys()}>{k => <View class="absolute h-[23] rounded-[3] border border-[#929ca8] bg-gradient-to-b from-white to-[#d7dce3]"
      style={{ insetL: k.x, insetT: k.y - 30, width: k.w, opacity: pressed() === k.value ? 0.55 : 1 }}>
      <Text class="absolute left-0 right-0 top-[5] text-xs text-center text-[#253247]">{p.s.shift() && k.value.length === 1 ? k.value.toUpperCase() : k.value}</Text>
    </View>}</For>
  </View>;
}

function MiniMap(p: { s: Folio; pane: "library" | "document"; y: () => number; height: () => number }) {
  let root: NodeMirror | undefined;
  const target = () => p.pane === "library" ? p.s.libraryScroll : p.s.scroll;
  const length = () => p.pane === "library" ? p.s.total() * FILE_H : (p.s.doc()?.rows ?? 0) * LINE_H;
  createGesture({ surface: "auxiliary", region: { node: () => root }, axis: "y", panSlop: 1,
    onDown: c => p.s.jump((c.y - p.y() - 5) / Math.max(1, p.height() - 10), p.pane),
    onPanMove: c => p.s.jump((c.y - p.y() - 5) / Math.max(1, p.height() - 10), p.pane),
  });
  return <View ref={root} debugName={`${p.pane}Minimap`} class="absolute left-[4] top-[5] w-[18] rounded-[3] bg-white border border-[#b9c6d6] overflow-hidden" style={{ height: p.height() - 10 }}>
    <For each={Array.from({ length: 20 }, (_, i) => i)}>{i => <View class="absolute left-[3] h-[1] bg-[#becbdc]" style={{ insetT: 5 + i * (p.height() - 23) / 20,
      width: p.pane === "library" ? 10 : 3 + (p.s.doc()?.mini[i] ?? 18) / 6 }} />}</For>
    <View class="absolute left-[1] w-[14] h-[9] border border-[#347dca] bg-[#85b6ee55]" style={{ insetT: Math.max(0, Math.min(p.height() - 21, target().offset() / Math.max(1, length() - VIEW_H) * (p.height() - 21))) }} />
  </View>;
}

function Deck(p: { s: Folio }) {
  let listPad: NodeMirror | undefined, docPad: NodeMirror | undefined;
  const typing = () => p.s.mode() === "edit" || p.s.mode() === "search";
  const y = () => typing() ? 145 : 33;
  const height = () => typing() ? 89 : 201;
  let quick = false, dx = 0, dy = 0;
  createGesture({ surface: "auxiliary", region: { node: () => listPad }, axis: "y", panSlop: 2,
    onDown: () => { p.s.setFocus("library"); p.s.libraryScroll.beginDrag(); },
    onPanMove: c => p.s.libraryScroll.drag(-c.fdy * 1.8),
    onPanEnd: c => p.s.libraryScroll.endDrag(-c.vy * 1.8),
    onTap: c => {
      p.s.libraryScroll.endDrag(0);
      const first = Math.max(0, Math.floor(p.s.libraryScroll.offset() / FILE_H));
      const within = Math.min(7, Math.max(0, Math.floor((c.y - y()) / height() * 8)));
      p.s.setSelected(Math.min(p.s.total() - 1, first + within)); p.s.activate();
    },
    onCancel: () => p.s.libraryScroll.stop(),
  });
  createGesture({ surface: "auxiliary", region: { node: () => docPad }, axis: "any", panSlop: 2,
    onDown: c => {
      p.s.setFocus("document"); quick = c.y >= y() + height() - 31; dx = dy = 0;
      if (!quick && p.s.mode() !== "edit") p.s.scroll.beginDrag();
    },
    onPanMove: c => {
      if (quick) return;
      if (p.s.mode() === "edit") {
        dx += c.fdx; dy += c.fdy;
        const x = Math.trunc(dx / 5), row = Math.trunc(dy / 14);
        if (x || row) { p.s.moveCaret(x + row * SOURCE_COLUMNS); dx -= x * 5; dy -= row * 14; }
      } else p.s.scroll.drag(-c.fdy * 1.8);
    },
    onPanEnd: c => { if (!quick && p.s.mode() !== "edit") p.s.scroll.endDrag(-c.vy * 1.8); },
    onTap: c => {
      if (quick) { if (c.x < 228) p.s.toggleSelect(); else p.s.mode() === "edit" ? p.s.perform("read") : p.s.edit(); }
      else if (p.s.mode() !== "edit") p.s.scroll.endDrag(0);
    },
    onCancel: () => p.s.scroll.stop(),
  });
  return <View debugName="FolioDeck" class="relative w-full h-full bg-[#dbe1e9]">
    <View class="absolute left-0 right-0 top-0 h-[27] bg-gradient-to-b from-[#f6f8fb] to-[#c1cad7]">
      <Text class="absolute left-[8] top-[6] text-xs font-bold text-[#405c80]">{typing() ? p.s.mode() === "search" ? "SEARCH" : "KEYBOARD" : "LIBRARY"}</Text>
      <Text class="absolute right-[9] top-[6] text-xs text-[#405c80]">{p.s.mode() === "search" ? p.s.query() || "Type a query" : "Hold L / R for actions"}</Text>
    </View>
    <Keyboard s={p.s} />
    <View debugName="LibraryPadFrame" class="absolute left-[6] w-[108] rounded-[6] border border-[#a4b2c4] bg-gradient-to-b from-[#f5f7fa] to-[#e3e9f1]" style={{ insetT: y(), height: height() }}>
      <MiniMap s={p.s} pane="library" y={y} height={height} />
      <View ref={listPad} debugName="LibraryTouchpad" class="absolute left-[25] top-[4] w-[78]" style={{ height: height() - 8 }}>
        <Text class="absolute left-0 right-0 top-[8] text-center text-xs font-bold text-[#456790]">FILES</Text>
        <View class="absolute left-[8] right-[8] top-[28] h-[1] bg-[#c7d2e0]" />
        <Text class="absolute left-0 right-0 text-center text-xs text-[#7e91a8]" style={{ insetT: typing() ? 42 : 92 }}>scroll</Text>
      </View>
    </View>
    <View debugName="DocumentPadFrame" class="absolute left-[122] w-[192] rounded-[6] border border-[#a4b2c4] bg-gradient-to-b from-[#f5f7fa] to-[#e3e9f1]" style={{ insetT: y(), height: height() }}>
      <MiniMap s={p.s} pane="document" y={y} height={height} />
      <View ref={docPad} debugName="DocumentTouchpad" class="absolute left-[25] top-[4] w-[162]" style={{ height: height() - 8 }}>
        <Text class="absolute left-0 right-0 top-[8] text-center text-xs font-bold text-[#456790]">{p.s.mode() === "edit" ? p.s.selecting() ? "SELECT TEXT" : "MOVE CURSOR" : "DOCUMENT"}</Text>
        <View class="absolute left-[8] right-[8] top-[28] h-[1] bg-[#c7d2e0]" />
        <Show when={!typing()}><Text class="absolute left-0 right-0 top-[93] text-center text-xs text-[#7e91a8]">slide / lift to coast</Text></Show>
        <View class="absolute left-[4] bottom-[3] w-[72] h-[23] rounded-[4] border border-[#9bacc1] bg-[#f9fbfd]" style={{ bgColor: p.s.selecting() ? 0xfff0d2b5 : 0xfffdfbf9 }}>
          <Text class="absolute left-0 right-0 top-[5] text-center text-xs text-[#355d8d]">SELECT</Text>
        </View>
        <View class="absolute right-[3] bottom-[3] w-[72] h-[23] rounded-[4] border border-[#9bacc1] bg-[#f9fbfd]">
          <Text class="absolute left-0 right-0 top-[5] text-center text-xs text-[#355d8d]">{p.s.mode() === "edit" ? "READ" : "EDIT"}</Text>
        </View>
      </View>
    </View>
  </View>;
}

export default function FolioApp() {
  const s = createFolio();
  (globalThis as any).__folio = s;
  return <>
    <View debugName="PocketFolio" class="relative w-full h-full bg-white overflow-hidden">
      <View class="absolute left-0 right-0 top-0 h-[32] bg-gradient-to-b from-[#a9bcd3] via-[#7d9cbe] to-[#55789f]">
        <View class="absolute left-0 right-0 top-0 h-[1] bg-[#dbe5f1]" />
        <Image debugName="FolioBookLogo" class="absolute left-[6] top-[8] w-[16] h-[16]" src="folio-book.svg" />
        <Text class="absolute left-[27] top-[8] text-sm font-bold text-white">Pocket Folio</Text>
        <View class="absolute left-[127] top-0 bottom-0 w-[1] bg-[#53749c]" />
        <Text class="absolute left-[137] top-[8] text-sm font-bold text-white">{s.doc() ? /[^\x00-\x7f]/.test(s.doc()!.title) ? "Document" : s.doc()!.title.slice(0, 29) : "Notes"}</Text>
        <View class="absolute right-[8] top-[13] w-[5] h-[5] rounded-full" style={{ bgColor: s.online() ? 0xffd1ecc8 : 0xffbdd4ee }} />
      </View>
      <View debugName="LibraryPane" class="absolute left-0 top-[32] w-[128] h-[194] bg-white overflow-hidden">
        <View class="absolute left-0 right-0 top-0" style={{ translateY: -s.libraryScroll.offset() }}><For each={SLOTS}>{slot => <LibraryRow s={s} slot={slot} />}</For></View>
        <View class="absolute right-0 top-0 bottom-0 w-[1] bg-[#b7c3d2]" />
        <Show when={s.focus() === "library"}><View class="absolute left-0 right-0 top-0 h-[2] bg-[#397dce]" /></Show>
      </View>
      <View debugName="DocumentPane" class="absolute left-[136] top-[32] w-[256] h-[194] overflow-hidden">
        <View class="absolute left-0 top-0 w-[256]" style={{ translateY: -s.scroll.offset(), display: s.mode() === "edit" ? 1 : 0 }}>
          <For each={SLOTS}>{slot => <DocumentRow s={s} slot={slot} />}</For>
        </View>
        <View class="absolute left-0 top-[3] w-[256] h-[190] overflow-hidden" style={{ display: s.mode() === "edit" ? 0 : 1 }}>
          <Text class="absolute left-0 top-0 text-xs text-[#55769e]">{s.dirty() ? "SOURCE  -  Unsaved changes" : "SOURCE"}</Text>
          <For each={SLOTS}>{index => <SourceRow s={s} index={index} />}</For>
        </View>
      </View>
      <View class="absolute left-0 right-0 bottom-0 h-[14] bg-gradient-to-b from-[#edf1f6] to-[#d5deea]">
        <Text class="absolute left-[6] top-0 text-xs text-[#516984]">{s.status().slice(0, 62)}</Text>
      </View>
      <For each={Object.keys(BANKS) as Bank[]}>{bank => <ContextMenu s={s} bank={bank} />}</For>
    </View>
    <AuxiliarySurface><Deck s={s} /></AuxiliarySurface>
  </>;
}
