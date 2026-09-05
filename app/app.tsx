import { createMemo, createSignal, For, Show } from "solid-js";
import { AuxiliarySurface, Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { ResourceBoundary, ResourceImage, pending, ready, type TextureResource } from "@pocketjs/framework/resource";
import { createGesture } from "@pocketjs/framework/gesture";
import { createFolio, type Folio } from "./store.ts";
import { BANKS, type Bank } from "./commands.ts";
import { textCells } from "./editor.ts";
import { BODY_W, FILE_H, LINE_H } from "../shared/layout.ts";
import { ROW_SLOTS, slotRow } from "./window.ts";
const SLOTS = Array.from({ length: ROW_SLOTS }, (_, i) => i);
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
        p.s.textVersion(); const handle = p.s.textTiles.get(p.value());
        return handle === undefined ? pending<TextureResource>() : ready({ handle, width: BODY_W, height: 16 });
      }} fallback={() => <Skeleton width={Math.max(12, p.width - 12)} />} />
    </Show>
  </View>;
}

function LibraryRow(p: { s: Folio; slot: number }) {
  const index = createMemo(() => slotRow(p.s.firstFile(), p.slot));
  return <View debugName="FileRow" class={index() === p.s.selected()
    ? "absolute left-0 w-[127] h-[24] overflow-hidden bg-gradient-to-b from-[#dce9f9] to-[#b9d2ef]"
    : "absolute left-0 w-[127] h-[24] overflow-hidden bg-white"} style={{ translateY: index() * FILE_H, display: p.s.total() && index() >= p.s.total() ? 1 : 0 }}>
    <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e1e4e8]" />
    <ResourceBoundary state={() => p.s.fileResource(index())} fallback={() => <View class="absolute left-[6] top-[4] w-[110] h-[16]"><Skeleton width={96 - p.slot % 3 * 12} /></View>}>
      {file => <>
        <Show when={p.s.doc()?.id === file().id}><View class="absolute left-0 top-[3] bottom-[3] w-[3] bg-[#397cca]" /></Show>
        <View class="absolute left-[7] top-[5]"><AsyncText s={p.s} value={() => file().title.slice(0, 17)} width={114} size="small" /></View>
      </>}
    </ResourceBoundary>
  </View>;
}

function DocumentRow(p: { s: Folio; slot: number }) {
  const row = createMemo(() => slotRow(p.s.firstRow(), p.slot));
  const spec = createMemo(() => p.s.rowSpec(row()));
  const resource = createMemo(() => p.s.rowResource(row()));
  return <View debugName="DocumentBand" class="absolute left-0 w-[256] h-[20] overflow-hidden" style={{ translateY: row() * LINE_H,
    bgColor: spec()?.header ? 0xfff0e7df : spec()?.kind === 3 ? 0xfff6f3f0 : 0xffffffff }}>
    <Show when={spec()?.columns}>
      <View class="absolute left-0 right-0 top-0 h-[1] bg-[#c7d0dc]" />
      <For each={spec()?.columns}>{(_, index) => <View class="absolute top-0 bottom-0 w-[1] bg-[#c7d0dc]" style={{ insetL: spec()!.columns!.slice(0, index()).reduce((a, b) => a + b, 0) }} />}</For>
      <View class="absolute right-0 top-0 bottom-0 w-[1] bg-[#c7d0dc]" />
    </Show>
    <ResourceImage class="absolute left-0 top-[2] w-[256] h-[16] overflow-hidden" state={() => {
      const state = resource();
      return state.status === "ready" ? ready({ handle: state.value.handle, width: BODY_W, height: 16 }) : state;
    }} fallback={() => <Skeleton width={180 - p.slot % 3 * 24} columns={spec()?.columns} />}
      errorFallback={() => <Text class="text-xs text-[#8b6f64]">Content unavailable</Text>} />
  </View>;
}

function SourceRow(p: { s: Folio; index: number }) {
  const index = createMemo(() => slotRow(p.s.editorFirst(), p.index));
  const row = createMemo(() => p.s.source()[index()]);
  const left = () => row() ? textCells(row()!.text.slice(0, Math.max(0, p.s.selection()[0] - row()!.start))) * 8 : 0;
  const right = () => row() ? textCells(row()!.text.slice(0, Math.max(0, p.s.selection()[1] - row()!.start))) * 8 : 0;
  return <View class="absolute left-0 w-[256] h-[18] overflow-hidden" style={{ translateY: index() * 18 }}>
    <View class="absolute top-0 h-[16] bg-[#bbd9ff]" style={{ insetL: left(), width: Math.max(0, right() - left()) }} />
    <AsyncText s={p.s} value={() => row()?.text ?? ""} width={248} mono />
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
  const keys = createMemo(() => (p.s.symbols() ? SYMBOLS : LETTERS).flatMap((line, row) => {
    const values = line.split(" "), width = 304 / values.length;
    return values.map((value, col) => ({ value, x: 8 + width * col, y: 32 + row * 26, w: width - 2 }));
  }));
  let root: NodeMirror | undefined, downKey = "", dx = 0, dy = 0;
  const release = () => { setPressed(""); p.s.setCaretDragging(false); };
  createGesture({ surface: "auxiliary", region: { node: () => root }, longPressSeconds: 0.35,
    onDown(c) {
      downKey = ""; dx = dy = 0;
      if (p.s.mode() !== "edit" && p.s.mode() !== "search") return;
      const hit = keys().find(k => c.x >= k.x && c.x < k.x + k.w + 2 && c.y >= k.y && c.y < k.y + 26);
      if (hit) {
        downKey = hit.value; setPressed(downKey);
        p.s.setFocus(p.s.mode() === "edit" ? "document" : "library");
        if (downKey !== "SPACE") p.s.key(downKey);
      }
    },
    onLongPress() {
      if (downKey === "SPACE" && p.s.mode() === "edit") p.s.setCaretDragging(true);
      else if (downKey === "SPACE") p.s.key("SPACE");
    },
    onMove(c) {
      if (!p.s.caretDragging()) return;
      dx += c.fdx; dy += c.fdy;
      const x = Math.trunc(dx / 6), y = Math.trunc(dy / 14);
      if (x || y) { p.s.dragCaret(x, y); dx -= x * 6; dy -= y * 14; }
    },
    onTap() { if (downKey === "SPACE") p.s.key("SPACE"); },
    onUp: release, onCancel() { downKey = ""; release(); },
  });
  return <View ref={root} debugName="FolioKeyboard" class="absolute left-0 top-[30] w-[320] h-[108]" style={{ display: p.s.mode() === "edit" || p.s.mode() === "search" ? 0 : 1 }}>
    <For each={keys()}>{k => <View class="absolute h-[23] rounded-[3] border border-[#929ca8] bg-gradient-to-b from-white to-[#d7dce3]"
      style={{ insetL: k.x, insetT: k.y - 30, width: k.w, opacity: pressed() === k.value || p.s.caretDragging() ? 0.55 : 1,
        bgColor: k.value === "SHIFT" && p.s.shift() ? 0xffedceb4 : 0 }}>
      <Show when={k.value === "SHIFT"} fallback={<Text class="absolute left-0 right-0 top-[5] text-xs text-center text-[#253247]">{k.value === "DONE" ? "SAVE" : p.s.shift() && k.value.length === 1 ? k.value.toUpperCase() : k.value}</Text>}>
        <Image debugName="ShiftIcon" class="absolute left-[6] top-[3] w-[16] h-[16]" src="shift.svg" />
      </Show>
    </View>}</For>
  </View>;
}

function Deck(p: { s: Folio }) {
  let listPad: NodeMirror | undefined, docPad: NodeMirror | undefined, header: NodeMirror | undefined;
  const typing = () => p.s.mode() === "edit" || p.s.mode() === "search";
  const y = () => typing() ? 145 : 33;
  const height = () => typing() ? 89 : 201;
  const target = () => p.s.mode() === "edit" ? p.s.editorScroll : p.s.scroll;
  let quick = false;
  createGesture({ surface: "auxiliary", region: { node: () => header },
    onTap(c) {
      if (p.s.mode() === "edit") { if (c.x < 83) p.s.perform("read"); else if (c.x > 244) p.s.save(); }
      else if (p.s.mode() === "search") { if (c.x < 83) p.s.setMode("read"); else if (c.x > 244) p.s.search(); }
    },
  });
  createGesture({ surface: "auxiliary", region: { node: () => listPad }, axis: "y", panSlop: 2,
    onDown: () => { p.s.setFocus("library"); p.s.libraryScroll.beginDrag(); },
    onPanMove: c => p.s.libraryScroll.drag(-c.fdy * 1.8),
    onPanEnd: c => p.s.libraryScroll.endDrag(-c.vy * 1.8),
    onTap: () => p.s.libraryScroll.endDrag(0),
    onCancel: () => p.s.libraryScroll.stop(),
  });
  createGesture({ surface: "auxiliary", region: { node: () => docPad }, axis: "y", panSlop: 2,
    onDown: c => {
      p.s.setFocus("document"); quick = c.y >= y() + height() - 31;
      if (!quick) target().beginDrag();
    },
    onPanMove: c => { if (!quick) target().drag(-c.fdy * 1.8); },
    onPanEnd: c => { if (!quick) target().endDrag(-c.vy * 1.8); },
    onTap: c => {
      if (quick) { if (c.x < 219) p.s.toggleSelect(); else p.s.mode() === "edit" ? p.s.perform("copy") : p.s.edit(); }
      else target().endDrag(0);
    },
    onCancel: () => target().stop(),
  });
  return <View debugName="FolioDeck" class="relative w-full h-full bg-[#dbe1e9]">
    <View ref={header} debugName="EditorNavigation" class="absolute left-0 right-0 top-0 h-[28] bg-gradient-to-b from-[#f6f8fb] to-[#c1cad7]">
      <Show when={typing()} fallback={<Text class="absolute left-[9] top-[7] text-xs font-bold text-[#405c80]">{p.s.focus() === "library" ? "Files focused" : "Document focused"}</Text>}>
        <View class="absolute left-[5] top-[3] w-[75] h-[22] rounded-[4] border border-[#879db8] bg-gradient-to-b from-[#fcfdff] to-[#dce4ef]">
          <Text class="absolute left-0 right-0 top-[4] text-center text-xs font-bold text-[#365d8c]">{p.s.mode() === "edit" ? "< READ" : "CANCEL"}</Text>
        </View>
        <Text class="absolute left-[85] right-[78] top-[7] text-center text-xs font-bold text-[#405c80]">{p.s.mode() === "edit" ? p.s.dirty() ? "EDITING *" : "EDITING" : "SEARCH"}</Text>
        <View class="absolute right-[5] top-[3] w-[66] h-[22] rounded-[4] border border-[#476d9e] bg-gradient-to-b from-[#8aa9ce] to-[#4e7fb7]">
          <Text class="absolute left-0 right-0 top-[4] text-center text-xs font-bold text-white">{p.s.mode() === "search" ? "FIND" : p.s.saving() ? "SAVING" : "SAVE"}</Text>
        </View>
      </Show>
      <Show when={!typing()}><Text class="absolute right-[9] top-[7] text-xs text-[#405c80]">L / R: actions</Text></Show>
    </View>
    <Keyboard s={p.s} />
    <View ref={listPad} debugName="LibraryTouchpad" class="absolute left-[6] w-[108] rounded-[6] border overflow-hidden bg-gradient-to-b from-[#f5f7fa] to-[#e3e9f1]"
      style={{ insetT: y(), height: height(), borderColor: p.s.focus() === "library" ? 0xffa4703c : 0xffc4b2a4 }}>
      <View class="absolute left-0 right-0 top-0 h-[27]" style={{ bgColor: p.s.focus() === "library" ? 0xffac7c48 : 0xffe9dfd2 }}>
        <Text class="absolute left-0 right-0 top-[7] text-center text-xs font-bold" style={{ textColor: p.s.focus() === "library" ? 0xffffffff : 0xff906745 }}>FILES</Text>
      </View>
      <Text class="absolute left-0 right-0 text-center text-xs text-[#6c829e]" style={{ insetT: typing() ? 38 : 89 }}>slide to scroll</Text>
      <Text class="absolute left-0 right-0 bottom-[11] text-center text-xs text-[#6c829e]">A opens</Text>
    </View>
    <View ref={docPad} debugName="DocumentTouchpad" class="absolute left-[122] w-[192] rounded-[6] border overflow-hidden bg-gradient-to-b from-[#f5f7fa] to-[#e3e9f1]"
      style={{ insetT: y(), height: height(), borderColor: p.s.focus() === "document" ? 0xffa4703c : 0xffc4b2a4 }}>
      <View class="absolute left-0 right-0 top-0 h-[27]" style={{ bgColor: p.s.focus() === "document" ? 0xffac7c48 : 0xffe9dfd2 }}>
        <Text class="absolute left-0 right-0 top-[7] text-center text-xs font-bold" style={{ textColor: p.s.focus() === "document" ? 0xffffffff : 0xff906745 }}>{p.s.mode() === "edit" ? "SOURCE" : "DOCUMENT"}</Text>
      </View>
      <Text class="absolute left-0 right-0 text-center text-xs text-[#6c829e]" style={{ insetT: typing() ? 35 : 89 }}>{p.s.mode() === "edit" ? p.s.caretDragging() ? "Release to type" : "Hold space + drag" : p.s.mode() === "search" ? p.s.query() || "Type a query" : "slide / lift to coast"}</Text>
      <View class="absolute left-[8] bottom-[7] w-[82] h-[23] rounded-[4] border border-[#9bacc1]" style={{ bgColor: p.s.selecting() ? 0xfff0d2b5 : 0xfffdfbf9 }}>
        <Text class="absolute left-0 right-0 top-[5] text-center text-xs text-[#355d8d]">{p.s.selecting() ? "SELECTING" : "SELECT"}</Text>
      </View>
      <View class="absolute right-[8] bottom-[7] w-[82] h-[23] rounded-[4] border border-[#9bacc1] bg-[#f9fbfd]">
        <Text class="absolute left-0 right-0 top-[5] text-center text-xs text-[#355d8d]">{p.s.mode() === "edit" ? "COPY" : p.s.draft() ? "RESUME" : "EDIT"}</Text>
      </View>
    </View>
  </View>;
}

export default function FolioApp() {
  const s = createFolio();
  (globalThis as any).__folio = s;
  // These slot sets are fixed. Construct sibling subtrees before their pane
  // wrappers, so each mount returns before the next parent begins spreading
  // children. All reactive rows remain owned by the application root.
  const files = SLOTS.map(slot => <LibraryRow s={s} slot={slot} />);
  const bands = SLOTS.map(slot => <DocumentRow s={s} slot={slot} />);
  const source = SLOTS.map(index => <SourceRow s={s} index={index} />);
  const menus = (Object.keys(BANKS) as Bank[]).map(bank => <ContextMenu s={s} bank={bank} />);
  const deck = <Deck s={s} />;
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
        <View class="absolute left-0 right-0 top-0" style={{ translateY: -s.libraryScroll.offset() }}>{files}</View>
        <View class="absolute right-0 top-0 bottom-0 w-[1] bg-[#b7c3d2]" />
      </View>
      <View debugName="DocumentPane" class="absolute left-[136] top-[32] w-[256] h-[194] overflow-hidden">
        <View class="absolute left-0 top-0 w-[256]" style={{ translateY: -s.scroll.offset(), display: s.mode() === "edit" ? 1 : 0 }}>
          {bands}
        </View>
        <View class="absolute left-0 top-[3] w-[256] h-[190] bg-white overflow-hidden" style={{ display: s.mode() === "edit" ? 0 : 1 }}>
          <Text class="absolute left-0 top-0 text-xs text-[#55769e]">{s.dirty() ? "SOURCE  -  Unsaved changes" : "SOURCE"}</Text>
          <View class="absolute left-0 top-[22] w-[256] h-[162] overflow-hidden">
            <View class="absolute left-0 top-0 w-[256]" style={{ translateY: -s.editorScroll.offset() }}>
              {source}
              <View debugName="SourceCaret" class="absolute left-0 top-0 w-[1] h-[16] bg-[#246cc3]" style={{ opacity: s.caretVisible() ? 1 : 0,
                translateY: s.caretRow() * 18,
                translateX: textCells((s.source()[s.caretRow()]?.text ?? "").slice(0, s.caret() - (s.source()[s.caretRow()]?.start ?? 0))) * 8 }} />
            </View>
          </View>
        </View>
      </View>
      <View class="absolute left-0 right-0 bottom-0 h-[14] bg-gradient-to-b from-[#edf1f6] to-[#d5deea]">
        <Text class="absolute left-[6] top-0 text-xs text-[#516984]">{s.status().slice(0, 62)}</Text>
      </View>
      {menus}
    </View>
    <AuxiliarySurface>{deck}</AuxiliarySurface>
  </>;
}
