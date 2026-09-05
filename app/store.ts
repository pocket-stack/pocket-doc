import { batch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { createCaretBlink } from "@pocketjs/framework/animation";
import { offload } from "@pocketjs/framework/offload";
import { createResourceSlot, pending, ready, type ResourceState } from "@pocketjs/framework/resource-state";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { BTN } from "@pocketjs/framework/input";
import { createScroller, bindDpadScroll } from "@pocketjs/framework/kinetics";
import { getOps } from "@pocketjs/framework/host";
import { textTileKey, uploadLine } from "./tiles.ts";
import { moveSourceCaret, sourceAdvance, sourceLayout, sourceWindow } from "./editor.ts";
import { createRowChanges } from "./window.ts";
import { chordAction, heldBank, moveListSelection, type Action, type Bank } from "./commands.ts";
import { FILE_H, LINE_H, SOURCE_COLUMNS, SOURCE_FONT_SLOT, VIEW_H } from "../shared/layout.ts";
export type FileRow = { id: number; title: string; bytes: number };
type Document = { id: number; title: string; revision: string; layout: string; rows: number; chars: number; mini: number[]; outline: { row: number; title: string }[]; links: string[] };
type Draft = { start: number; end: number; text: string; revision: string };
export type RowSpec = { row: number; kind: number; columns?: number[]; header?: boolean };
export type Tile = { handle: number; kind: number; start: number };

export function createFolio() {
  const io = offload();
  const [mode, setMode] = createSignal<"read" | "edit" | "search">("read");
  const [focus, setFocus] = createSignal<"library" | "document">("library");
  const [menu, setMenu] = createSignal<Bank>();
  const [status, setStatus] = createSignal("Waiting for Mac...");
  const [online, setOnline] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [doc, setDoc] = createSignal<Document>();
  const [draft, setDraft] = createSignal<Draft>();
  const [caret, setCaret] = createSignal(0);
  const [query, setQuery] = createSignal("");
  const [shift, setShift] = createSignal(false);
  const [symbols, setSymbols] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const [selecting, setSelecting] = createSignal(false);
  const [anchor, setAnchor] = createSignal(0);
  const [confirmDiscard, setConfirmDiscard] = createSignal(false);
  const [caretVisible, setCaretVisible] = createSignal(false);
  const [caretDragging, setCaretDragging] = createSignal(false);
  const [textVersion, setTextVersion] = createSignal(0);
  const fileChanges = createRowChanges(), rowChanges = createRowChanges();
  const tiles = new Map<number, Tile>();
  const tileResources = new Map<number, ReturnType<typeof createResourceSlot<Tile>>>();
  const rowSpecs = new Map<number, RowSpec>();
  const files = new Map<number, FileRow>();
  const textTiles = new Map<string, number>();
  const sourceCellWidth = getOps().measureText("M", SOURCE_FONT_SLOT);
  const sourceWidth = (text: string) => sourceAdvance(text, sourceCellWidth);
  const source = createMemo(() => sourceLayout(draft()?.text ?? "", SOURCE_COLUMNS));
  const editorScroll = createScroller({ max: () => Math.max(0, source().length * 18 - 162), extent: () => 162 });
  const editorFirst = createMemo(() => Math.max(0, Math.floor(editorScroll.offset() / 18)));
  const editorRows = createMemo(() => source().slice(editorFirst(), editorFirst() + 10));
  const caretRow = createMemo(() => Math.max(0, source().findIndex(r => caret() >= r.start && caret() <= r.end)));
  const blink = createCaretBlink({ onChange: setCaretVisible });
  createEffect(() => blink.setActive(mode() === "edit" && focus() === "document" && !confirmDiscard()));
  createEffect(() => blink.setHeld(caretDragging()));
  createEffect(() => {
    caret(); draft(); blink.reset();
    untrack(() => {
      const top = caretRow() * 18, offset = editorScroll.offset();
      if (top < offset) editorScroll.scrollTo(top, { immediate: true });
      else if (top + 18 > offset + 162) editorScroll.scrollTo(top + 18 - 162, { immediate: true });
    });
  });
  onCleanup(blink.dispose);
  const sourceLines = createMemo(() => sourceWindow(draft()?.text ?? "", caret(), SOURCE_COLUMNS));
  const selection = createMemo(() => selecting() ? [Math.min(anchor(), caret()), Math.max(anchor(), caret())] as const : [caret(), caret()] as const);
  const inflight = new Map<string, number>();
  let generation = 0, previous = 0, ticks = 0, lastSession = 0, retryAt = 0, op = "", clipboard = "", navHeld = 0, lastDirection = 1;
  const scroll = createScroller({ max: () => Math.max(0, (doc()?.rows ?? 0) * LINE_H - VIEW_H), extent: () => VIEW_H });
  const libraryScroll = createScroller({ max: () => Math.max(0, total() * FILE_H - VIEW_H), extent: () => VIEW_H });
  const firstRow = createMemo(() => Math.max(0, Math.floor(scroll.offset() / LINE_H)));
  const firstFile = createMemo(() => Math.max(0, Math.floor(libraryScroll.offset() / FILE_H)));
  const visibleText = createMemo(() => {
    const lines: { text: string; key: string; inverse: boolean }[] = [];
    for (let n = 0; n < 9; n++) {
      const index = firstFile() + n; fileChanges.read(index);
      const title = files.get(index)?.title.slice(0, 17) ?? "";
      const inverse = index === selected();
      if (/[^\x00-\x7f]/.test(title)) lines.push({ text: title, key: textTileKey(title, inverse), inverse });
    }
    if (mode() === "edit") for (const row of editorRows()) if (/[^\x00-\x7f]/.test(row.text)) lines.push({ text: row.text, key: textTileKey(row.text), inverse: false });
    return lines;
  });
  const activeScroll = () => focus() === "library" ? libraryScroll : scroll;
  bindDpadScroll(scroll, { active: () => !confirmDiscard() && !menu() && focus() === "document" && mode() === "read", stepPx: 7, nubPx: 12 });
  bindDpadScroll(libraryScroll, { active: () => !confirmDiscard() && !menu() && focus() === "library", stepPx: 0, nubPx: 12 });
  const clearPending = () => { generation++; for (const id of inflight.values()) io.cancel(id); inflight.clear(); };
  const cancelSpatial = (pane?: "library" | "document") => {
    for (const [key, id] of inflight) {
      if (key.startsWith("text:") || (pane !== "document" && key.startsWith("list:")) ||
          (pane !== "library" && (key.startsWith("tile:") || key.startsWith("window:")))) {
        io.cancel(id); inflight.delete(key);
      }
    }
  };
  const request = (key: string, method: string, data: unknown, receive: (p: any) => void, fail?: (reason: string) => void) => {
    // User commands can replace speculative reads, including when all slots are occupied.
    if (!/^(list:|text:|tile:|window:)/.test(key) && inflight.size >= 4) cancelSpatial();
    if (!online() || inflight.has(key) || inflight.size >= 4 || ticks < retryAt) return false;
    const gen = generation;
    let id = 0;
    try {
      id = io.request(method, JSON.stringify(data), result => {
        if (inflight.get(key) === id) inflight.delete(key);
        if (gen !== generation) return;
        if (!result.ok) { setStatus(result.error); retryAt = ticks + 90; setSaving(false); fail?.(result.error); return; }
        try { batch(() => receive(JSON.parse(result.value))); }
        catch (error) { const message = error instanceof Error ? error.message : "Invalid provider response"; setStatus(message); fail?.(message); }
      });
    } catch (error) { setStatus(error instanceof Error ? error.message : "Request exceeds budget"); return false; }
    if (id) inflight.set(key, id);
    return !!id;
  };
  const clearTiles = () => {
    for (const tile of tiles.values()) getOps().freeTexture?.(tile.handle);
    for (const resource of tileResources.values()) resource.dispose();
    tiles.clear(); tileResources.clear(); rowSpecs.clear(); rowChanges.clear();
  };
  const list = (offset = 0) => request(`list:${offset}`, "library.list", { offset, query: query() }, p => {
    setTotal(p.total);
    for (let i = 0; i < p.rows.length; i++) { files.set(offset + i, p.rows[i]); fileChanges.notify(offset + i); }
    while (files.size > 96) { const old = files.keys().next().value!; files.delete(old); fileChanges.notify(old); }

    if (!doc() && p.rows[0] && mode() !== "search") open(p.rows[0].id, false, false);
  });
  const open = (id: number, preserve = false, focusAfter = true) => {
    if (dirty()) { setStatus("Save or discard the current draft first"); return; }
    clearPending();
    request("open", "document.open", { id }, p => {
      clearTiles(); setDoc(p); setMode("read"); setDraft(undefined); setDirty(false); setSaving(false); setSelecting(false);
      if (focusAfter) setFocus("document");
      if (!preserve) scroll.scrollTo(0, { immediate: true });
      setStatus("L: Library   R: Document");
    });
  };
  const edit = (select = false) => {
    const d = doc(); if (!d) return;
    setFocus("document"); scroll.stop();
    if (draft()) { setMode("edit"); if (select) { setAnchor(caret()); setSelecting(true); } return; }
    request("edit", "document.edit", { id: d.id, revision: d.revision, row: Math.max(0, Math.floor(scroll.offset() / LINE_H)) }, p => {
      setDraft(p); setCaret(0); setAnchor(0); setSelecting(select); setMode("edit"); setDirty(false); op = "";
      setStatus(select ? "Hold space, then drag to select" : "Editing source excerpt");
    });
  };
  const insert = (add: string) => {
    if (saving()) return;
    const d = draft(); if (!d) return;
    const [from, to] = selection();
    if (d.text.length - (to - from) + add.length > 768) { setStatus("Excerpt is full; save before continuing"); return; }
    setDraft({ ...d, text: d.text.slice(0, from) + add + d.text.slice(to) });
    setCaret(from + add.length); setAnchor(from + add.length); setSelecting(false); setDirty(true); op = "";
  };
  const key = (value: string) => {
    if (saving() || confirmDiscard()) return;
    if (value === "SHIFT") { setShift(!shift()); return; }
    if (value === "#+=") { setSymbols(!symbols()); return; }
    if (value === "DONE") { mode() === "search" ? search() : save(); return; }
    if (mode() === "search") { setQuery(q => value === "DEL" ? q.slice(0, -1) : (q + (value === "SPACE" ? " " : value === "ENTER" ? "" : value)).slice(0, 80)); return; }
    const d = draft(); if (!d) return;
    if (value === "DEL") {
      const [from, to] = selection();
      if (from !== to) { insert(""); return; }
      const n = caret() > 1 && /[\uDC00-\uDFFF]/.test(d.text[caret() - 1]) ? 2 : 1;
      if (caret()) { setAnchor(caret() - n); setSelecting(true); insert(""); }
    } else { insert(value === "SPACE" ? " " : value === "ENTER" ? "\n" : shift() ? value.toUpperCase() : value); setShift(false); }
  };
  const moveCaret = (n: number) => {
    let next = Math.max(0, Math.min(draft()?.text.length ?? 0, caret() + n));
    if (/[\uDC00-\uDFFF]/.test(draft()?.text[next] ?? "")) next += n < 0 ? -1 : 1;
    setCaret(next); if (!selecting()) setAnchor(next);
    blink.reset();
  };
  const dragCaret = (dx: number, dy: number) => {
    const next = moveSourceCaret(draft()?.text ?? "", caret(), dx, dy, SOURCE_COLUMNS);
    moveCaret(next - caret());
  };
  const save = () => {
    const d = doc(), e = draft(); if (!d || !e || saving()) return;
    if (!dirty()) { setMode("read"); return; }
    op ||= `${d.id}-${d.revision.slice(0, 16)}-${ticks}-${Math.floor(Math.random() * 1000000000)}`;
    const sent = request("save", "document.save", { ...e, id: d.id, op }, () => {
      setSaving(false); setDirty(false); setStatus("Saved on Mac"); open(d.id, true);
    });
    if (sent) { setSaving(true); setStatus("Saving on Mac..."); }
    else setStatus("Draft retained; reconnect to save");
  };
  const search = () => {
    clearPending(); files.clear(); fileChanges.clear(); setTotal(0); setMode("read"); setFocus("library");
    libraryScroll.scrollTo(0, { immediate: true }); setSelected(0); retryAt = 0; list();
  };
  const ensureSelected = () => setSelected(moveListSelection(selected(), 0, libraryScroll.offset(), VIEW_H, total(), FILE_H));
  const activate = () => {
    if (focus() === "library") { ensureSelected(); const file = files.get(selected()); if (file) open(file.id); }
    else edit();
  };
  const jump = (fraction: number, pane = focus()) => {
    setFocus(pane);
    cancelSpatial(pane);
    const target = pane === "library" ? libraryScroll : scroll;
    const length = pane === "library" ? total() * FILE_H : (doc()?.rows ?? 0) * LINE_H;
    target.scrollTo(Math.max(0, Math.min(1, fraction)) * Math.max(0, length - VIEW_H), { immediate: true });
  };
  const nextHeading = (direction: number) => {
    const d = doc(); if (!d) return;
    request("heading", "document.heading", { id: d.id, row: scroll.offset() / LINE_H, direction }, p => scroll.scrollTo(p.row * LINE_H));
  };
  const followLink = () => { const name = doc()?.links[0]; if (name) request("link", "library.link", { name }, p => open(p.id)); };
  const toggleSelect = () => {
    if (mode() !== "edit") { edit(true); return; }
    if (!selecting()) setAnchor(caret());
    setSelecting(!selecting());
  };
  const cancelDiscard = () => { setConfirmDiscard(false); setStatus("Draft retained"); };
  const discard = () => {
    if (!confirmDiscard() || saving()) return;
    clearPending(); setDirty(false); setDraft(undefined); setSelecting(false); setMode("read"); setConfirmDiscard(false);
    setCaretDragging(false); setStatus("Changes discarded");
    if (doc() && online()) open(doc()!.id, true);
  };
  const perform = (action: Action) => {
    if (action !== "discard") setConfirmDiscard(false);
    switch (action) {
      case "open": ensureSelected(); { const item = files.get(selected()); if (item) open(item.id); } break;
      case "focus-list": setFocus("library"); break;
      case "focus-document": setFocus("document"); break;
      case "search": setMode("search"); setFocus("library"); break;
      case "refresh": clearPending(); files.clear(); fileChanges.clear(); retryAt = 0; break;
      case "edit": edit(); break;
      case "read": setMode("read"); setStatus(dirty() ? "Draft retained; R+A resumes" : "L: Library   R: Document"); break;
      case "save": save(); break;
      case "link": followLink(); break;
      case "select": toggleSelect(); break;
      case "copy": { const [from, to] = selection(); clipboard = draft()?.text.slice(from, to) ?? ""; setStatus(clipboard ? "Selection copied" : "Select text to copy"); break; }
      case "paste": if (mode() === "edit" && clipboard) insert(clipboard); else setStatus("Open the editor and copy text first"); break;
      case "discard":
        if (saving() || !draft()) break;
        scroll.stop(); libraryScroll.stop(); editorScroll.stop(); setCaretDragging(false);
        setConfirmDiscard(true); setStatus("Discard changes or keep editing"); break;
      case "top": jump(0, "document"); break;
      case "end": jump(1, "document"); break;
      case "heading": nextHeading(1); break;
    }
  };
  onFrame(buttons => {
    ticks++; setOnline(io.connected());
    const session = io.session();
    if (session > 0 && session !== lastSession) {
      lastSession = session; clearPending(); retryAt = 0; setSaving(false);
      setStatus(dirty() ? "Reconnected - draft retained" : "L: Library   R: Document");
      const current = doc();
      if (current) request("revalidate", "document.open", { id: current.id }, p => {
        if (current.revision !== p.revision || current.layout !== p.layout) {
          if (dirty() || mode() === "edit") setStatus("Mac revision changed; draft retained");
          else { clearTiles(); setDoc(p); }
        }
      });
    }
    const pressed = buttons & ~previous; previous = buttons;
    if (confirmDiscard()) {
      setMenu(undefined);
      if (pressed & BTN.CROSS) cancelDiscard();
      else if (pressed & BTN.CIRCLE) discard();
      return;
    }
    const bank = heldBank(buttons); setMenu(bank);
    const action = chordAction(bank, pressed);
    if (action) perform(action);
    if (bank || mode() !== "edit" || focus() === "library") {
      if (pressed & BTN.LEFT) setFocus("library");
      if (pressed & BTN.RIGHT) setFocus("document");
    }
    navHeld = buttons & (BTN.UP | BTN.DOWN) ? navHeld + 1 : 0;
    const nav = pressed | (navHeld > 18 && navHeld % 6 === 0 ? buttons & (BTN.UP | BTN.DOWN) : 0);
    if (focus() === "library" && nav & (BTN.UP | BTN.DOWN)) {
      libraryScroll.stop();
      setSelected(moveListSelection(selected(), nav & BTN.DOWN ? 1 : -1, libraryScroll.offset(), VIEW_H, total(), FILE_H));
      const top = selected() * FILE_H, offset = libraryScroll.offset();
      if (top < offset) libraryScroll.scrollTo(top);
      else if (top + FILE_H > offset + VIEW_H) libraryScroll.scrollTo(top + FILE_H - VIEW_H);
    }
    if (!bank) {
      if (mode() === "edit" && focus() === "document") {
        if (pressed & BTN.LEFT) moveCaret(-1); if (pressed & BTN.RIGHT) moveCaret(1);
        if (nav & BTN.UP) dragCaret(0, -1); if (nav & BTN.DOWN) dragCaret(0, 1);
        if (pressed & BTN.CIRCLE) key("ENTER"); if (pressed & BTN.CROSS) key("DEL");
        if (pressed & BTN.START) save();
        if (pressed & BTN.TRIANGLE) perform("read");
      } else {
        if (pressed & BTN.CIRCLE) mode() === "search" ? search() : activate();
        if (pressed & BTN.CROSS) mode() === "search" ? setMode("read") : setFocus("library");
        if (pressed & BTN.SELECT) perform("search");
      }
    }
    const oldOffset = scroll.offset();
    scroll.step(); libraryScroll.step(); editorScroll.step();
    const motion = scroll.offset() - oldOffset;
    if (motion) lastDirection = motion > 0 ? 1 : -1;
    if (!online()) { if (!saving()) setStatus(dirty() ? "Offline - draft retained" : "Waiting for paired Mac..."); return; }
    const firstFile = Math.max(0, Math.floor(libraryScroll.offset() / FILE_H)), page = Math.floor(firstFile / 12) * 12;
    if (!files.has(firstFile)) list(page);
    if (total() > page + 12 && !files.has(page + 12)) list(page + 12);
    for (const line of visibleText()) {
      if (textTiles.has(line.key) || inflight.size >= 4) continue;
      if (request(`text:${line.key}`, "text.tile", { text: line.text, cellWidth: sourceCellWidth }, p => {
        const handle = uploadLine(p.mask, 3, line.inverse); if (handle < 0) return;
        textTiles.set(line.key, handle);
        while (textTiles.size > 20) { const key = textTiles.keys().next().value!; getOps().freeTexture?.(textTiles.get(key)!); textTiles.delete(key); }
        setTextVersion(v => v + 1);
      })) break;
    }
    const d = doc(); if (!d || mode() === "edit") return;
    const first = Math.max(0, Math.floor(scroll.offset() / LINE_H));
    const metadata = Math.floor(first / 12) * 12;
    for (const from of [metadata, metadata + 12]) {
      if (from >= d.rows || rowSpecs.has(from)) continue;
      request(`window:${from}`, "document.window", { id: d.id, revision: d.revision, layout: d.layout, first: from }, specs => {
        for (const spec of specs) { rowSpecs.set(spec.row, spec); rowChanges.notify(spec.row); }
        while (rowSpecs.size > 96) { const old = rowSpecs.keys().next().value!; rowSpecs.delete(old); rowChanges.notify(old); }

      });
    }
    let issued = 0;
    for (let n = 0; n < 60 && inflight.size < 4 && issued < 2; n++) {
      const row = n < 12 ? first + n : lastDirection >= 0 ? (n < 44 ? first + n : first - (n - 43)) : (n < 44 ? first - (n - 11) : first + n - 32);
      if (row < 0 || row >= d.rows || tiles.has(row) || inflight.has(`tile:${row}`)) continue;
      const resource = tileResources.get(row) ?? createResourceSlot<Tile>(() => rowChanges.notify(row));
      let ticket = 0;
      if (request(`tile:${row}`, "document.tile", { id: d.id, revision: d.revision, layout: d.layout, row }, p => {
        const handle = uploadLine(p.mask, p.kind);
        if (handle < 0) { resource.reject(ticket, "Texture unavailable"); return; }
        const tile = { handle, kind: p.kind, start: p.start };
        if (!resource.resolve(ticket, tile)) { getOps().freeTexture?.(handle); return; }
        tiles.set(row, tile);

      }, error => resource.reject(ticket, error))) {
        tileResources.set(row, resource); ticket = resource.begin(); issued++;
        while (tileResources.size > 72) {
          let victim = -1, distance = -1;
          const center = Math.floor(scroll.offset() / LINE_H) + 5;
          for (const candidate of tileResources.keys()) if (!inflight.has(`tile:${candidate}`) && Math.abs(candidate - center) > distance) { victim = candidate; distance = Math.abs(candidate - center); }
          if (victim < 0) break;
          const old = tiles.get(victim); if (old) getOps().freeTexture?.(old.handle);
          tiles.delete(victim); tileResources.get(victim)?.dispose(); tileResources.delete(victim);
          rowChanges.notify(victim);
        }

      }
    }
  });
  onCleanup(() => { clearPending(); clearTiles(); for (const handle of textTiles.values()) getOps().freeTexture?.(handle); });
  return {
    mode, setMode, focus, setFocus, menu, status, online, total, textVersion, doc, draft, caret, query, shift, symbols, selected, setSelected,
    firstRow, firstFile, source, sourceCellWidth, sourceWidth, editorFirst, editorScroll, caretRow, caretVisible, caretDragging, setCaretDragging, dragCaret,
    tiles, rowSpecs, files, textTiles, editorRows, sourceLines, scroll, libraryScroll, activeScroll, dirty, saving, selecting, selection, confirmDiscard,
    key, moveCaret, save, search, activate, edit, jump, open, nextHeading, followLink, toggleSelect, perform, discard, cancelDiscard,
    rowSpec: (row: number) => { rowChanges.read(row); return rowSpecs.get(row); },
    rowResource: (row: number): ResourceState<Tile> => { rowChanges.read(row); return tileResources.get(row)?.state() ?? pending(); },
    fileResource: (index: number): ResourceState<FileRow> => { fileChanges.read(index); const file = files.get(index); return file ? ready(file) : pending(); },
    diagnostics: () => ({ cachedTiles: tiles.size, resourceSlots: tileResources.size, pending: inflight.size, offset: scroll.offset(), frame: ticks }),
  };
}
export type Folio = ReturnType<typeof createFolio>;
