import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { AuxiliarySurface, Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";
import { ResourceBoundary, ResourceImage, pending, ready, type TextureResource } from "@pocketjs/framework/resource";
import { createGesture, pushTouchBlock } from "@pocketjs/framework/gesture";
import { ClassicButton, ClassicFace, ClassicPanel, ClassicSheet, classicPalette } from "@pocketjs/framework/classic";
import { createDoc, type Doc } from "./store.ts";
import { BANKS, type Bank } from "./commands.ts";
import { textTileKey } from "./tiles.ts";
import { BODY_W, FILE_H, LINE_H } from "../shared/layout.ts";
import { ROW_SLOTS, slotRow } from "./window.ts";
const SLOTS = Array.from({ length: ROW_SLOTS }, (_, i) => i);
const LETTERS = ["q w e r t y u i o p", "a s d f g h j k l DEL", "SHIFT z x c v b n m , .", "#+= / - SPACE ENTER"];
const SYMBOLS = ["1 2 3 4 5 6 7 8 9 0", "[ ] ( ) { } # * _ DEL", "SHIFT ! ? : ; ' \" ` + =", "#+= / - SPACE ENTER"];

function Skeleton(p: { width?: number; columns?: number[] }) {
  return <View debugName={p.columns ? "TableSkeleton" : "TextSkeleton"} class="relative w-full h-full animate-pulse">
    <Show when={p.columns} fallback={<View class="absolute left-[3] top-[5] h-[6] rounded-[2] bg-[#d8dee6]" style={{ width: p.width ?? 110 }} />}>
      <For each={p.columns}>{(width, index) => <View class="absolute top-[5] h-[6] rounded-[2] bg-[#d4dde8]" style={{ insetL: p.columns!.slice(0, index()).reduce((a, b) => a + b, 0) + 4, width: Math.max(3, width - 12) }} />}</For>
    </Show>
  </View>;
}

function AsyncText(p: { s: Doc; value: () => string; width: number; size?: "small" | "normal"; mono?: boolean; inverse?: boolean }) {
  const unicode = () => /[^\x00-\x7f]/.test(p.value());
  return <View class="relative h-[18] overflow-hidden" style={{ width: p.width }}>
    <Show when={unicode()} fallback={<Text class={p.mono ? "absolute left-0 top-0 text-xs font-mono" : p.size === "small" ? "absolute left-0 top-0 text-xs" : "absolute left-0 top-0 text-sm"} style={{ textColor: p.inverse ? 0xffffffff : 0xff2e2722 }}>{p.value()}</Text>}>
      <ResourceImage class="relative h-[16] overflow-hidden" style={{ width: p.width }} state={() => {
        p.s.textVersion(); const handle = p.s.textTiles.get(textTileKey(p.value(), p.inverse));
        return handle === undefined ? pending<TextureResource>() : ready({ handle, width: BODY_W, height: 16 });
      }} fallback={() => <Skeleton width={Math.max(12, p.width - 12)} />} />
    </Show>
  </View>;
}

function LibraryRow(p: { s: Doc; slot: number }) {
  const index = createMemo(() => slotRow(p.s.firstFile(), p.slot));
  const selected = () => index() === p.s.selected();
  return <View debugName="FileRow" class="absolute left-0 w-[127] h-[24] overflow-hidden" style={{ translateY: index() * FILE_H,
    bgColor: 0xffffffff, gradDir: 1, gradFrom: selected() ? classicPalette("primary").gradFrom : "#ffffff",
    gradTo: selected() ? classicPalette("primary").gradTo : "#ffffff", display: p.s.total() && index() >= p.s.total() ? 1 : 0 }}>
    <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#e1e4e8]" />
    <ResourceBoundary state={() => p.s.fileResource(index())} fallback={() => <View class="absolute left-[6] top-[4] w-[110] h-[16]"><Skeleton width={96 - p.slot % 3 * 12} /></View>}>
      {file => <>
        <Show when={p.s.doc()?.id === file().id}><View class="absolute left-0 top-[3] bottom-[3] w-[3] bg-[#397cca]" /></Show>
        <View class="absolute left-[7] top-[5]"><AsyncText s={p.s} value={() => file().title.slice(0, 17)} width={114} size="small" inverse={selected()} /></View>
      </>}
    </ResourceBoundary>
  </View>;
}

function DocumentRow(p: { s: Doc; slot: number }) {
  const row = createMemo(() => slotRow(p.s.firstRow(), p.slot));
  const spec = createMemo(() => p.s.rowSpec(row()));
  const resource = createMemo(() => p.s.rowResource(row()));
  return <View debugName="DocumentBand" class="absolute left-0 w-[256] h-[20] overflow-hidden" style={{ translateY: row() * LINE_H,
    bgColor: spec()?.header ? 0xfff0e7df : spec()?.kind === 3 ? 0xfff6f3f0 : 0xffffffff }}>
    <Show when={spec()?.columns}>
      <View class="absolute left-0 right-0 top-0 h-[1] bg-[#c7d0dc]" style={{ display: spec()?.first ? 0 : 1 }} />
      <View class="absolute left-0 right-0 bottom-0 h-[1] bg-[#c7d0dc]" style={{ display: spec()?.last ? 0 : 1 }} />
      <For each={spec()?.columns}>{(_, index) => <View class="absolute top-0 bottom-0 w-[1] bg-[#c7d0dc]" style={{ insetL: spec()!.columns!.slice(0, index()).reduce((a, b) => a + b, 0) }} />}</For>
      <View class="absolute right-0 top-0 bottom-0 w-[1] bg-[#c7d0dc]" />
    </Show>
    <ResourceImage class="absolute left-0 top-[2] w-[256] h-[16] overflow-hidden" style={{ translateX: spec()?.code ? (resource().status === "ready" ? (resource() as { status: "ready"; value: { x: number } }).value.x : 0) - p.s.codeOffset(spec()!.code!.block) : 0 }} state={() => {
      const state = resource();
      return state.status === "ready" ? ready({ handle: state.value.handle, width: BODY_W, height: 16 }) : state;
    }} fallback={() => <Skeleton width={180 - p.slot % 3 * 24} columns={spec()?.columns} />}
      errorFallback={() => <Text class="text-xs text-[#8b6f64]">Content unavailable</Text>} />
  </View>;
}

function SourceRow(p: { s: Doc; index: number }) {
  const index = createMemo(() => slotRow(p.s.editorFirst(), p.index));
  const row = createMemo(() => p.s.source()[index() - p.s.editorBase()]);
  const left = () => row() ? p.s.sourceWidth(row()!.text.slice(0, Math.max(0, p.s.selection()[0] - row()!.start))) : 0;
  const right = () => row() ? p.s.sourceWidth(row()!.text.slice(0, Math.max(0, p.s.selection()[1] - row()!.start))) : 0;
  return <View class="absolute left-0 w-[256] h-[18] overflow-hidden" style={{ translateY: index() * 18, display: index() < p.s.editorTotal() ? 0 : 1 }}>
    <View class="absolute top-0 h-[16] bg-[#bbd9ff]" style={{ insetL: left(), width: Math.max(0, right() - left()) }} />
    <Show when={row()} fallback={<Skeleton width={180} />}><AsyncText s={p.s} value={() => row()?.text ?? ""} width={248} mono /></Show>
  </View>;
}

function ContextMenu(p: { s: Doc; bank: Bank }) {
  const bank = BANKS[p.bank], width = bank.columns === 1 ? 240 : 348;
  const cell = (width - 20) / bank.columns;
  return <View debugName={`Context-${p.bank}`} class="absolute left-0 top-0 w-full h-full"
    style={{ display: p.s.menu() === p.bank ? 0 : 1, bgColor: "#10203855" }}>
    <ClassicPanel active style={{ posType: 1, insetL: (400 - width) / 2, insetT: 24, width, height: 192 }}>
      <Text class="absolute left-0 right-0 top-[7] text-center text-xs font-bold text-white">{bank.title}</Text>
      <For each={bank.actions}>{(item, index) => <ClassicFace selected={p.s.commandIndex() === index()} disabled={!p.s.canAction(item.action)}
        style={{ posType: 1, insetL: 10 + index() % bank.columns * cell, insetT: 34 + Math.floor(index() / bank.columns) * (bank.columns === 1 ? 23 : 33), width: cell - 3, height: bank.columns === 1 ? 20 : 29 }}>
        <Text class="absolute left-0 right-0 text-center text-xs" style={{ insetT: bank.columns === 1 ? 4 : 7, textColor: classicPalette(p.s.commandIndex() === index() ? "primary" : "neutral").textColor }}>{item.label}</Text>
      </ClassicFace>}</For>
      <Text class="absolute left-0 right-0 bottom-[6] text-center text-xs text-[#516984]">D-pad: choose   A: run   B: cancel</Text>
    </ClassicPanel>
  </View>;
}

function Keyboard(p: { s: Doc }) {
  const [pressed, setPressed] = createSignal("");
  const keys = createMemo(() => (p.s.symbols() ? SYMBOLS : LETTERS).flatMap((line, row) => {
    const values = line.split(" "), width = 304 / values.length;
    let x = 8;
    return values.map((value, col) => { const w = row === 3 ? [42, 30, 30, 140, 62][col] : width;
      const key = { value, x, y: 30 + row * 22, w: w - 2 }; x += w; return key; });
  }));
  let root: NodeMirror | undefined, downKey = "", dx = 0, dy = 0;
  const release = () => { setPressed(""); p.s.setCaretDragging(false); };
  createGesture({ surface: "auxiliary", allowWhenBlocked: true, region: { node: () => root }, longPressSeconds: 0.35,
    onDown(c) {
      downKey = ""; dx = dy = 0;
      if (p.s.sheetModal() || p.s.menu() || p.s.saving() || p.s.historyBusy() || p.s.creating() || p.s.mode() !== "edit" && p.s.mode() !== "search" && p.s.mode() !== "create") return;
      const hit = keys().find(k => c.x >= k.x && c.x < k.x + k.w + 2 && c.y >= k.y && c.y < k.y + 22);
      if (hit) {
        downKey = hit.value; setPressed(downKey);
        p.s.setFocus(p.s.mode() === "search" ? "library" : "document");
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
  return <View ref={root} debugName="DocKeyboard" class="absolute left-0 top-[28] w-[320] h-[90]" style={{ display: p.s.mode() === "edit" || p.s.mode() === "search" || p.s.mode() === "create" ? 0 : 1 }}>
    <For each={keys()}>{k => <ClassicFace tone="key" pressed={pressed() === k.value} selected={k.value === "SHIFT" && p.s.shift() !== "off"} disabled={p.s.saving()}
      style={{ posType: 1, height: 20, insetL: k.x, insetT: k.y - 28, width: k.w }}>
      <Show when={k.value === "SHIFT"} fallback={<Text class="absolute left-0 right-0 top-[3] text-xs text-center" style={{ textColor: classicPalette("key", pressed() === k.value).textColor }}>{p.s.shift() !== "off" && k.value.length === 1 ? k.value.toUpperCase() : k.value}</Text>}>
        <Image debugName="ShiftIcon" class="absolute left-[6] top-[2] w-[16] h-[16]" src={p.s.shift() === "locked" ? "shift-lock.svg" : "shift.svg"} />
      </Show>
    </ClassicFace>}</For>
  </View>;
}

function Deck(p: { s: Doc }) {
  let listPad: NodeMirror | undefined, docPad: NodeMirror | undefined;
  const typing = () => p.s.mode() !== "read";
  const y = () => typing() ? 118 : 33;
  const height = () => typing() ? 118 : 201;
  const target = () => p.s.mode() === "edit" ? p.s.editorScroll : p.s.scroll;
  const blocked = () => p.s.sheetModal() || !!p.s.menu();
  createEffect(() => { if (p.s.menu() || p.s.mode() === "create") onCleanup(pushTouchBlock()); });
  createGesture({ surface: "auxiliary", region: { node: () => listPad }, axis: "y", panSlop: 2,
    onDown: () => { if (!blocked()) { p.s.setFocus("library"); p.s.libraryScroll.beginDrag(); } },
    onPanMove: c => p.s.libraryScroll.drag(-c.fdy * 1.8),
    onPanEnd: c => p.s.libraryScroll.endDrag(-c.vy * 1.8),
    onTap: () => p.s.libraryScroll.endDrag(0),
    onCancel: () => p.s.libraryScroll.stop(),
  });
  createGesture({ surface: "auxiliary", region: { node: () => docPad }, axis: "y", panSlop: 2,
    onDown: () => { if (!blocked()) { p.s.setFocus("document"); target().beginDrag(); } },
    onPanMove: c => target().drag(-c.fdy * 1.8),
    onPanEnd: c => target().endDrag(-c.vy * 1.8),
    onTap: () => target().endDrag(0),
    onCancel: () => target().stop(),
  });
  const buttonStyle = (x: number, top: number, width: number, shown = true) => ({ posType: 1, insetL: x, insetT: top, width, height: 23, display: shown ? 0 : 1 });
  // Fixed button subtrees mount before the deck wrapper (QuickJS stack bound).
  const close = <ClassicButton debugName="ReadButton" surface="auxiliary" allowWhenBlocked label={p.s.mode() === "search" || p.s.mode() === "create" ? "Cancel" : "Read"}
    style={buttonStyle(5, 3, 59, typing())} disabled={blocked() || p.s.saving() || p.s.creating()}
    onPress={() => p.s.mode() === "create" ? p.s.cancelCreate() : p.s.mode() === "search" ? p.s.setMode("read") : p.s.perform("read")} />;
  const discard = <ClassicButton debugName="DiscardButton" surface="auxiliary" label="Discard" tone="danger"
    style={buttonStyle(70, 3, 73, p.s.mode() === "edit")} disabled={blocked() || p.s.saving() || !p.s.dirty()}
    onPress={() => p.s.perform("discard")} />;
  const save = <ClassicButton debugName="SaveButton" surface="auxiliary" allowWhenBlocked label={p.s.mode() === "create" ? "Create" : p.s.mode() === "search" ? "Find" : p.s.saving() ? "Saving" : "Save"} tone="primary"
    style={buttonStyle(249, 3, 66, typing())} disabled={blocked() || p.s.saving() || p.s.creating() || p.s.mode() === "create" && !p.s.newName().trim()}
    onPress={() => p.s.mode() === "create" ? p.s.createDocument() : p.s.mode() === "search" ? p.s.search() : p.s.save()} />;
  const select = <ClassicButton debugName="SelectButton" surface="auxiliary" label="Select" selected={p.s.mode() === "edit" && p.s.selecting()} edge="left"
    style={{ ...buttonStyle(typing() ? 181 : 130, typing() ? y() + 2 : y() + height() - 31, typing() ? 64 : 89, p.s.mode() === "read" || p.s.mode() === "edit"), height: typing() ? 18 : 23 }} disabled={blocked() || p.s.saving() || p.s.mode() !== "edit"}
    onPress={() => { p.s.setFocus("document"); p.s.toggleSelect(); }} />;
  const copy = <ClassicButton debugName="CopyEditButton" surface="auxiliary" label={p.s.mode() === "edit" ? "Copy" : p.s.draft() ? "Resume" : "Edit"} edge="right"
    style={{ ...buttonStyle(typing() ? 244 : 218, typing() ? y() + 2 : y() + height() - 31, typing() ? 66 : 88, p.s.mode() === "read" || p.s.mode() === "edit"), height: typing() ? 18 : 23 }} disabled={blocked() || p.s.saving() || p.s.discardToken() !== undefined || p.s.mode() === "create" || !p.s.doc() || p.s.mode() === "edit" && p.s.selection()[0] === p.s.selection()[1]}
    onPress={() => { p.s.setFocus("document"); p.s.mode() === "edit" ? p.s.perform("copy") : p.s.edit(); }} />;
  const sheet = <ClassicSheet debugName="DiscardSheet" surface="auxiliary" open={p.s.confirmDiscard()}
    title="Discard unsaved changes?" message="The document on Mac stays unchanged."
    actions={[{ label: "Discard Changes", tone: "danger", onPress: p.s.discard }]}
    cancelLabel="Keep Editing" onCancel={p.s.cancelDiscard} onModalChange={p.s.setSheetModal} />;
  const keyboard = <Keyboard s={p.s} />;
  return <View debugName="DocDeck" class="relative w-full h-full bg-[#dbe1e9]">
    <View debugName="EditorNavigation" class="absolute left-0 right-0 top-0 h-[28] bg-gradient-to-b from-[#f6f8fb] to-[#c1cad7]">
      <Show when={typing()} fallback={<Text class="absolute left-[9] top-[7] text-xs font-bold text-[#405c80]">{p.s.focus() === "library" ? "Files focused" : "Document focused"}</Text>}>
        <Text class="absolute left-[148] right-[77] top-[7] text-center text-xs font-bold text-[#405c80]">{p.s.mode() === "create" ? "New file" : p.s.mode() === "edit" ? p.s.dirty() ? "Editing *" : "Editing" : "Search"}</Text>
      </Show>
      <Show when={!typing()}><Text class="absolute right-[9] top-[7] text-xs text-[#405c80]">L / R: actions</Text></Show>
    </View>
    {close}{discard}{save}{keyboard}
    <ClassicPanel headerHeight={typing() ? 22 : 27} debugName="LibraryPadFrame" active={p.s.focus() === "library"} style={{ posType: 1, insetL: 6, width: 108, insetT: y(), height: height() }}>
      <View ref={listPad} debugName="LibraryTouchpad" class="absolute left-0 top-0 w-full h-full">
        <Text class="absolute text-xs font-bold" style={{ insetL: 0, insetR: 0, insetT: typing() ? 4 : 8, textAlign: 1, textColor: classicPalette(p.s.focus() === "library" ? "primary" : "neutral").textColor }}>Files</Text>
        <Text class="absolute left-0 right-0 text-center text-xs text-[#6c829e]" style={{ insetT: typing() ? 63 : 89 }}>slide to scroll</Text>
        <Show when={!typing()}><Text class="absolute left-0 right-0 bottom-[11] text-center text-xs text-[#6c829e]">A opens</Text></Show>
      </View>
    </ClassicPanel>
    <ClassicPanel headerHeight={typing() ? 22 : 27} debugName="DocumentPadFrame" active={p.s.focus() === "document"} style={{ posType: 1, insetL: 122, width: 192, insetT: y(), height: height() }}>
      <Text class="absolute text-xs font-bold" style={{ insetL: p.s.mode() === "edit" ? 7 : 0, insetR: p.s.mode() === "edit" ? 138 : 0, insetT: typing() ? 4 : 8, textAlign: p.s.mode() === "edit" ? 0 : 1,
        textColor: classicPalette(p.s.focus() === "document" ? "primary" : "neutral").textColor }}>{p.s.mode() === "create" ? "Filename" : p.s.mode() === "edit" ? "Source" : "Document"}</Text>
      <View ref={docPad} debugName="DocumentTouchpad" class="absolute left-0 w-full" style={{ insetT: typing() ? 22 : 27, height: height() - (typing() ? 22 : 60) }}>
        <Text class="absolute left-0 right-0 text-center text-xs text-[#6c829e]" style={{ insetT: typing() ? 35 : 62 }}>{p.s.mode() === "edit" ? p.s.seeking() ? "Loading source..." : "Hold space / C-stick" : p.s.mode() === "create" ? "Enter: create document" : p.s.mode() === "search" ? p.s.query() || "Type a query" : "slide / lift to coast"}</Text>
      </View>
    </ClassicPanel>
    {select}{copy}
    {sheet}
  </View>;
}

export default function DocApp() {
  const s = createDoc();
  (globalThis as any).__doc = s;
  // These slot sets are fixed. Construct sibling subtrees before their pane
  // wrappers, so each mount returns before the next parent begins spreading
  // children. All reactive rows remain owned by the application root.
  const files = SLOTS.map(slot => <LibraryRow s={s} slot={slot} />);
  const bands = SLOTS.map(slot => <DocumentRow s={s} slot={slot} />);
  const source = SLOTS.map(index => <SourceRow s={s} index={index} />);
  const menus = (Object.keys(BANKS) as Bank[]).map(bank => <ContextMenu s={s} bank={bank} />);
  const dialog = <View debugName="NewDocumentDialog" class="absolute left-0 top-0 w-full h-full" style={{ display: s.mode() === "create" ? 0 : 1, bgColor: "#10203877" }}>
    <ClassicPanel active style={{ posType: 1, insetL: 44, insetT: 56, width: 312, height: 126 }}>
      <Text class="absolute left-0 right-0 top-[7] text-center text-xs font-bold text-white">New document</Text>
      <Text class="absolute left-[12] top-[37] text-xs text-[#405c80]">Filename (.md is added automatically)</Text>
      <View class="absolute left-[12] right-[12] top-[58] h-[28] rounded-[3] border border-[#6c8fb7] bg-white">
        <Text class="absolute left-[6] top-[7] text-xs text-[#243955]">{s.newName().slice(-36) + (s.caretVisible() ? "|" : "")}</Text>
      </View>
      <Text class="absolute left-[12] top-[98] text-xs text-[#405c80]">{s.creating() ? "Creating on Mac..." : "A: create   B: cancel"}</Text>
    </ClassicPanel>
  </View>;
  const deck = <Deck s={s} />;
  return <>
    <View debugName="PocketDoc" class="relative w-full h-full bg-white overflow-hidden">
      <View class="absolute left-0 right-0 top-0 h-[32] bg-gradient-to-b from-[#a9bcd3] via-[#7d9cbe] to-[#55789f]">
        <View class="absolute left-0 right-0 top-0 h-[1] bg-[#dbe5f1]" />
        <Image debugName="DocBookLogo" class="absolute left-[6] top-[8] w-[16] h-[16]" src="doc-book.svg" />
        <Text class="absolute left-[27] top-[8] text-sm font-bold text-white">Pocket Doc</Text>
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
                translateX: s.caretX() }} />
            </View>
          </View>
        </View>
      </View>
      <View class="absolute left-0 right-0 bottom-0 h-[14] bg-gradient-to-b from-[#edf1f6] to-[#d5deea]">
        <Text class="absolute left-[6] top-0 text-xs text-[#516984]">{s.status().slice(0, 62)}</Text>
      </View>
      {menus}{dialog}
    </View>
    <AuxiliarySurface>{deck}</AuxiliarySurface>
  </>;
}
