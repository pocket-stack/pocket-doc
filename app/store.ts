import { batch, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { createCaretBlink } from "@pocketjs/framework/animation";
import { offload } from "@pocketjs/framework/offload";
import { createResourceSlot, pending, ready, type ResourceState } from "@pocketjs/framework/resource-state";
import { onFrame, rightAnalogX, rightAnalogY } from "@pocketjs/framework/lifecycle";
import { BTN } from "@pocketjs/framework/input";
import { createScroller, bindDpadScroll } from "@pocketjs/framework/kinetics";
import { getOps } from "@pocketjs/framework/host";
import { textTileKey, uploadLine } from "./tiles.ts";
import { moveSourceCaret, sourceAdvance, sourceLayout, sourceWindow } from "./editor.ts";
import { createEditHistory, type EditSnapshot } from "./history.ts";
import { createRowChanges } from "./window.ts";
import { BANKS, heldBank, moveCommand, moveListSelection, type Action, type Bank } from "./commands.ts";
import { SOURCE_EDIT_CHARS, type SourceDraft, type DraftSeek } from "../shared/draft.ts";
import { FILE_H, LINE_H, SOURCE_COLUMNS, SOURCE_FONT_SLOT, VIEW_H } from "../shared/layout.ts";
export type FileRow = { id: number; title: string; bytes: number };
type Document = { id: number; title: string; revision: string; layout: string; rows: number; chars: number; mini: number[]; outline: { row: number; title: string }[]; links: string[] };
type Draft = SourceDraft;
export type RowSpec = { row: number; kind: number; columns?: number[]; header?: boolean; first?: boolean; last?: boolean; code?: { block: number; width: number } };
export type Tile = { handle: number; kind: number; start: number; x: number };

export function createDoc() {
  const io = offload();
  const [mode, setMode] = createSignal<"read" | "edit" | "search" | "create">("read");
  const [focus, setFocus] = createSignal<"library" | "document">("library");
  const [menu, setMenu] = createSignal<Bank>();
  const [commandIndex, setCommandIndex] = createSignal(0);
  const [sheetModal, setSheetModal] = createSignal(false);
  const history = createEditHistory();
  const [historySizes, setHistorySizes] = createSignal<readonly [number, number]>([0, 0]);
  let cleanText = "", lastShift = -100, lastBank: Bank | undefined, dismissedBank: Bank | undefined;
  const [status, setStatus] = createSignal("Waiting for Mac...");
  const [online, setOnline] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [doc, setDoc] = createSignal<Document>();
  const [draft, setDraft] = createSignal<Draft>();
  const [caret, setCaret] = createSignal(0);
  const [newName, setNewName] = createSignal("");
  const [creating, setCreating] = createSignal(false);
  const [seeking, setSeeking] = createSignal(false);
  const [discardToken, setDiscardToken] = createSignal<string>();
  const [codeVersion, setCodeVersion] = createSignal(0);
  const codeOffsets = new Map<number, number>();
  let localVersion = 0, saveWanted = false, createOp = "", stickX = 0, stickY = 0;
  let wantWindow: { row?: number; offset?: number; history?: -1 | 1; caretColumn?: number } | undefined;
  const deferredKeys: string[] = [];
  let flushingKeys = false;
  let pendingSeek: { payload: DraftSeek; version: number; sentText: string; first: number; caretColumn?: number } | undefined;
  const [query, setQuery] = createSignal("");
  const [shift, setShift] = createSignal<"off" | "once" | "locked">("off");
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
  const rowsOf = (text: string, hasMore: boolean) => {
    const rows = sourceLayout(text, SOURCE_COLUMNS);
    if (hasMore && rows.at(-1)?.start === text.length) rows.pop();
    return rows;
  };
  const source = createMemo(() => rowsOf(draft()?.text ?? "", (draft()?.end ?? 0) < (draft()?.chars ?? 0)));
  const editorBase = () => draft()?.first ?? 0;
  const editorTotal = () => (draft()?.totalRows ?? 1) + source().length - rowsOf(cleanText, (draft()?.end ?? 0) < (draft()?.chars ?? 0)).length;
  const editorScroll = createScroller({ max: () => Math.max(0, editorTotal() * 18 - 162), extent: () => 162 });
  const editorFirst = createMemo(() => Math.max(0, Math.floor(editorScroll.offset() / 18)));
  const editorRows = createMemo(() => source().slice(Math.max(0, editorFirst() - editorBase()), Math.max(0, editorFirst() - editorBase() + 10)));
  const caretRow = createMemo(() => {
    const rows = source(), found = rows.findIndex(r => caret() >= r.start && caret() <= r.end);
    // A non-EOF window ending at a newline has a caret position at the start
    // of the next global row, even while that row's text has not arrived.
    return editorBase() + (found >= 0 ? found : caret() > (rows.at(-1)?.end ?? 0) ? rows.length : Math.max(0, rows.length - 1));
  });
  const caretX = () => { const r = source()[caretRow() - editorBase()]; return sourceWidth((r?.text ?? "").slice(0, caret() - (r?.start ?? 0))); };
  const blink = createCaretBlink({ onChange: setCaretVisible });
  createEffect(() => blink.setActive((mode() === "create" || mode() === "edit" && focus() === "document") && !sheetModal() && !menu()));
  createEffect(() => blink.setHeld(caretDragging()));
  createEffect(() => {
    caret(); blink.reset();
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
  bindDpadScroll(scroll, { active: () => !sheetModal() && !menu() && focus() === "document" && mode() === "read", stepPx: 7, nubPx: 12 });
  bindDpadScroll(libraryScroll, { active: () => !sheetModal() && !menu() && focus() === "library", stepPx: 0, nubPx: 12 });
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
    codeOffsets.clear(); setCodeVersion(v => v + 1);
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
    if (dirty() || pendingSeek) { setStatus("Save or discard the current draft first"); return; }
    clearPending();
    request("open", "document.open", { id }, p => {
      clearTiles(); setDoc(p); setMode("read"); setDraft(undefined); setDirty(false); setSaving(false); setSelecting(false); history.clear(); setHistorySizes(history.sizes());
      if (focusAfter) setFocus("document");
      if (!preserve) scroll.scrollTo(0, { immediate: true });
      setStatus("L: Library   R: Document");
    });
  };
  const adoptWindow = (p: Draft, absolute?: number) => {
    cleanText = p.text; localVersion++; setDraft(p); setDirty(p.stagedDirty);
    history.clear(); setHistorySizes(history.sizes());
    const localRows = rowsOf(p.text, p.end < p.chars);
    const fallback = localRows[Math.max(0, Math.min(localRows.length - 1, editorFirst() - p.first))]?.start ?? 0;
    const at = absolute !== undefined && absolute >= p.start && absolute <= p.end ? absolute - p.start : fallback;
    setCaret(at); setAnchor(at); setSelecting(false); setCaretDragging(false);
  };
  const edit = () => {
    const d = doc(); if (!d || discardToken()) return;
    setFocus("document"); scroll.stop();
    if (draft()) { setMode("edit"); return; }
    request("edit", "draft.begin", { id: d.id, revision: d.revision, row: Math.max(0, Math.floor(scroll.offset() / LINE_H)), token: `draft-${d.id}-${ticks}-${Math.floor(Math.random() * 1e9)}` }, p => {
      adoptWindow(p, p.start); editorScroll.scrollTo(p.first * 18, { immediate: true }); setMode("edit"); op = "";
      setStatus(p.stagedDirty ? "Resumed staged draft" : "Editing document");
    });
  };
  const createDocument = () => {
    if (creating() || !online() || !newName().trim()) return;
    createOp ||= `create-${ticks}-${Math.floor(Math.random() * 1e9)}`;
    if (request("create", "document.create", { name: newName(), op: createOp }, p => {
      setCreating(false); clearTiles(); setDoc(p.document); adoptWindow(p.window, p.window.start);
      files.clear(); fileChanges.clear(); setQuery(""); setTotal(p.total); setSelected(p.position);
      libraryScroll.scrollTo(p.position * FILE_H, { immediate: true }); editorScroll.scrollTo(0, { immediate: true }); scroll.scrollTo(0, { immediate: true });
      setMode("edit"); setFocus("document"); setStatus("Document created; ready to edit"); createOp = "";
    }, () => setCreating(false))) { setCreating(true); setStatus("Creating document..."); }
  };
  const cancelCreate = () => { if (!creating()) { setMode("read"); setNewName(""); createOp = ""; } };
  const seekEditor = (row: number) => { editorScroll.scrollTo(Math.max(0, row) * 18, { immediate: true }); wantWindow = { row: Math.max(0, Math.floor(row)) }; };
  const pumpEditor = () => {
    const d = draft(); if (!d || !online()) return;
    if (!pendingSeek && !deferredKeys.length && saveWanted && d.text === cleanText) {
      op ||= `save-${doc()!.id}-${ticks}-${Math.floor(Math.random() * 1e9)}`;
      request("save", "draft.save", { id: doc()!.id, revision: d.revision, token: d.token, seq: d.seq, op }, () => {
        saveWanted = false; setSaving(false); setDirty(false); setDraft(undefined); setStatus("Saved on Mac"); open(doc()!.id, true);
      }, () => { saveWanted = false; }); return;
    }
    if (!pendingSeek && !wantWindow && mode() === "edit") {
      const from = editorFirst() - d.first;
      if (d.text.length > 640) wantWindow = { offset: d.start + caret() };
      else if (from < 0 || from + 10 > source().length && d.end < d.chars) wantWindow = { row: editorFirst() };
    }
    if (!pendingSeek && (wantWindow || saveWanted)) {
      const { caretColumn, ...target } = wantWindow ?? { row: editorFirst() }; wantWindow = undefined;
      pendingSeek = { payload: { token: d.token, seq: d.seq, op: `seek-${ticks}-${Math.floor(Math.random() * 1e9)}`, ...target,
        ...(d.text !== cleanText ? { patch: { start: d.start, end: d.end, text: d.text } } : {}) }, version: localVersion, sentText: d.text, first: d.first, caretColumn };
    }
    const pending = pendingSeek; if (!pending) return;
    if (request("seek", "draft.seek", pending.payload, p => {
      pendingSeek = undefined; setSeeking(false);
      if (draft()?.token !== p.token) return;
      const current = draft()!, absolute = current.start + caret();
      if (localVersion !== pending.version) {
        // A reply cannot replace keystrokes entered while the old window was in flight.
        cleanText = pending.sentText;
        setDraft({ ...current, end: current.start + pending.sentText.length, seq: p.seq, totalRows: p.totalRows, chars: p.chars, stagedDirty: p.stagedDirty, undo: p.undo, redo: p.redo });
        setDirty(p.stagedDirty || current.text !== cleanText); wantWindow ??= { row: pending.payload.row, offset: pending.payload.offset };
      } else {
        let target = pending.payload.offset ?? absolute;
        if (pending.caretColumn !== undefined && pending.payload.row !== undefined) {
          const rows = rowsOf(p.text, p.end < p.chars), row = rows[Math.max(0, Math.min(rows.length - 1, pending.payload.row - p.first))];
          let cells = 0; target = p.start + row.start;
          for (const char of row.text) { const width = char.codePointAt(0)! > 255 ? 2 : 1; if (cells + width > pending.caretColumn) break; cells += width; target += char.length; }
        }
        if (/[\uDC00-\uDFFF]/.test(p.text[target - p.start] ?? "")) target += target < absolute ? -1 : 1;
        adoptWindow(p, target);
        if (pending.payload.history) editorScroll.scrollTo(p.first * 18, { immediate: true });
        flushingKeys = true;
        for (let n = 0; n < 64 && deferredKeys.length; n++) {
          const value = deferredKeys[0], current = draft()!;
          if (value === "DEL") {
            if (!caret() && current.start > 0) break;
            deferredKeys.shift(); deleteBackward();
          } else {
            let count = Math.min(value.length, SOURCE_EDIT_CHARS - current.text.length);
            if (/[\uDC00-\uDFFF]/.test(value[count] ?? "")) count--;
            if (!count) break;
            deferredKeys.shift(); insert(value.slice(0, count));
            if (count < value.length) deferredKeys.unshift(value.slice(count));
          }
        }
        if (deferredKeys.length) wantWindow = { offset: draft()!.start + caret() };
        flushingKeys = false;
      }
    }, () => { setSeeking(false); saveWanted = false; })) setSeeking(true);
  };
  const snapshot = (): EditSnapshot => ({ text: draft()!.text, caret: caret(), anchor: anchor(), selecting: selecting() });
  const restore = (value: EditSnapshot | undefined) => {
    if (!value || !draft()) return;
    setDraft({ ...draft()!, text: value.text }); setCaret(value.caret); setAnchor(value.anchor); setSelecting(value.selecting);
    localVersion++; setDirty(!!draft()?.stagedDirty || value.text !== cleanText); setHistorySizes(history.sizes()); op = "";
  };
  const historyBusy = () => !!(pendingSeek?.payload.history || wantWindow?.history);
  const insert = (add: string, range = selection()) => {
    if (saving() && !flushingKeys || historyBusy()) return;
    const d = draft(); if (!d) return;
    if (deferredKeys.length && !flushingKeys) { deferKey(add); return; }
    const [from, to] = range;
    if (d.text.length - (to - from) + add.length > SOURCE_EDIT_CHARS) { if (from !== to) insert("", range); deferKey(add); return; }
    history.record(snapshot()); setHistorySizes(history.sizes());
    const text = d.text.slice(0, from) + add + d.text.slice(to);
    localVersion++; setDraft({ ...d, text });
    setCaret(from + add.length); setAnchor(from + add.length); setSelecting(false); setDirty(d.stagedDirty || text !== cleanText); op = "";
  };
  const deferKey = (value: string) => {
    // Only boundary input waits; ordinary edits remain local. Keep a fixed queue.
    if (deferredKeys.length >= 64) { setStatus("Input buffer full; reconnect to continue"); return; }
    deferredKeys.push(value); setDirty(true); wantWindow = { offset: draft()!.start + caret() };
    setStatus("Loading source; input retained");
  };
  const deleteBackward = () => {
    const d = draft(); if (!d) return;
    const [from, to] = selection();
    if (from !== to) { insert(""); return; }
    const n = caret() > 1 && /[\uDC00-\uDFFF]/.test(d.text[caret() - 1]) ? 2 : 1;
    if (caret()) insert("", [caret() - n, caret()]); else if (d.start) deferKey("DEL");
  };
  const key = (value: string) => {
    if (saving() || creating() || sheetModal() || menu() || historyBusy()) return;
    if (value === "SHIFT") {
      setShift(shift() === "locked" ? "off" : shift() === "once" ? ticks - lastShift <= 21 ? "locked" : "off" : "once");
      lastShift = ticks; return;
    }
    lastShift = -100;
    if (value === "#+=") { setSymbols(!symbols()); return; }
    if (value === "DONE") { mode() === "create" ? createDocument() : mode() === "search" ? search() : save(); return; }
    if (mode() === "create") {
      if (value === "ENTER" || value === "DONE") { createDocument(); return; }
      setNewName(name => value === "DEL" ? name.slice(0, -1) : (name + (value === "SPACE" ? " " : shift() !== "off" ? value.toUpperCase() : value)).slice(0, 80));
      createOp = ""; blink.reset(); if (value !== "DEL" && shift() === "once") setShift("off"); return;
    }
    if (mode() === "search") {
      setQuery(q => value === "DEL" ? q.slice(0, -1) : (q + (value === "SPACE" ? " " : value === "ENTER" ? "" : shift() !== "off" ? value.toUpperCase() : value)).slice(0, 80));
      if (value !== "DEL" && shift() === "once") setShift("off"); return;
    }
    const d = draft(); if (!d) return;
    if (value === "DEL") {
      if (deferredKeys.length) deferKey("DEL"); else deleteBackward();
    } else { insert(value === "SPACE" ? " " : value === "ENTER" ? "\n" : shift() !== "off" ? value.toUpperCase() : value); if (shift() === "once") setShift("off"); }
  };
  const moveCaret = (n: number) => {
    if (!draft() || deferredKeys.length || historyBusy()) return;
    const requested = caret() + n;
    if ((requested < 0 && draft()!.start > 0) || (requested > draft()!.text.length && draft()!.end < draft()!.chars)) {
      wantWindow = { offset: Math.max(0, Math.min(draft()!.chars + draft()!.text.length - (draft()!.end - draft()!.start), draft()!.start + requested)) };
    }
    let next = Math.max(0, Math.min(draft()?.text.length ?? 0, caret() + n));
    if (/[\uDC00-\uDFFF]/.test(draft()?.text[next] ?? "")) next += n < 0 ? -1 : 1;
    setCaret(next); if (!selecting()) setAnchor(next);
    blink.reset();
  };
  const dragCaret = (dx: number, dy: number) => {
    const next = moveSourceCaret(draft()?.text ?? "", caret(), dx, dy, SOURCE_COLUMNS);
    const row = caretRow() - editorBase();
    if (dy && (row + dy < 0 || row + dy >= source().length)) {
      wantWindow = { row: Math.max(0, caretRow() + dy), caretColumn: caretX() / sourceCellWidth }; editorScroll.scrollTo(Math.max(0, caretRow() + dy - 4) * 18);
    }
    moveCaret(next - caret());
  };
  const save = () => {
    if (!doc() || !draft() || saving()) return;
    if (!dirty()) { setMode("read"); setSelecting(false); return; }
    if (!online()) { setStatus("Draft retained; reconnect to save"); return; }
    saveWanted = true; setSaving(true); setStatus("Saving document on Mac...");
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
    if (mode() !== "edit" || saving()) return;
    if (!selecting()) setAnchor(caret());
    setSelecting(!selecting());
  };
  const cancelDiscard = () => { setConfirmDiscard(false); setStatus("Draft retained"); };
  const discard = () => {
    if (!confirmDiscard() || saving()) return;
    deferredKeys.length = 0; setDiscardToken(draft()?.token); pendingSeek = undefined; wantWindow = undefined; saveWanted = false; setSeeking(false);
    clearPending(); history.clear(); setHistorySizes(history.sizes()); setDirty(false); setDraft(undefined); setSelecting(false); setMode("read"); setConfirmDiscard(false);
    setCaretDragging(false); setStatus("Changes discarded");
    if (doc() && online()) open(doc()!.id, true);
  };
  const perform = (action: Action) => {
    if (action !== "discard") setConfirmDiscard(false);
    switch (action) {
      case "new": if (!dirty() && !pendingSeek && !discardToken()) { setNewName(""); setMode("create"); setFocus("document"); scroll.stop(); libraryScroll.stop(); } break;
      case "open": ensureSelected(); { const item = files.get(selected()); if (item) open(item.id); } break;
      case "focus-list": setFocus("library"); break;
      case "focus-document": setFocus("document"); break;
      case "search": setMode("search"); setFocus("library"); break;
      case "clear-search": setQuery(""); search(); break;
      case "undo": if (mode() === "edit" && draft() && !saving()) { const value = history.undo(snapshot()); if (value) restore(value); else if (draft()!.text === cleanText) wantWindow = { history: -1 }; } break;
      case "redo": if (mode() === "edit" && draft() && !saving()) { const value = history.redo(snapshot()); if (value) restore(value); else if (draft()!.text === cleanText) wantWindow = { history: 1 }; } break;
      case "refresh": clearPending(); files.clear(); fileChanges.clear(); retryAt = 0; break;
      case "edit": edit(); break;
      case "read": setMode("read"); setSelecting(false); setAnchor(caret()); setCaretDragging(false); setStatus(dirty() ? "Draft retained; tap Resume to edit" : "L: Files   R: Document"); break;
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
      case "previous-heading": nextHeading(-1); break;
    }
  };
  const codeOffset = (block: number) => { codeVersion(); return codeOffsets.get(block) ?? 0; };
  const firstCode = () => {
    for (let n = firstRow(); n < firstRow() + 10; n++) { rowChanges.read(n); const code = rowSpecs.get(n)?.code; if (code) return code; }
  };
  const canAction = (action: Action): boolean => {
    if (sheetModal() || saving() || creating()) return false;
    if (action === "new") return online() && !dirty() && !pendingSeek && !discardToken();
    if (["search", "refresh", "focus-list", "clear-search"].includes(action)) return true;
    if (action === "open") return online() && !dirty() && total() > 0;
    if (!doc()) return false;
    if (action === "undo" || action === "redo") return mode() === "edit" && (historySizes()[action === "undo" ? 0 : 1] > 0 || draft()?.text === cleanText && (action === "undo" ? draft()?.undo ?? 0 : draft()?.redo ?? 0) > 0);
    if (action === "select") return mode() === "edit";
    if (action === "copy") return mode() === "edit" && selection()[0] !== selection()[1];
    if (action === "paste") return mode() === "edit" && !!clipboard;
    if (action === "read") return mode() === "edit";
    if (action === "save") return !!draft() && dirty() && online();
    if (action === "discard") return !!draft() && dirty();
    if (action === "heading" || action === "previous-heading" || action === "link") return mode() === "read" && online() && (action !== "link" || !!doc()?.links.length);
    return action !== "edit" || !discardToken() && (!!draft() || online());
  };
  onFrame(buttons => {
    ticks++; setOnline(io.connected());
    const session = io.session();
    if (session > 0 && session !== lastSession) {
      lastSession = session; clearPending(); retryAt = 0; setSaving(false); saveWanted = false; setCreating(false);
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
    if (sheetModal()) {
      setMenu(undefined);
      if (confirmDiscard() && pressed & BTN.CROSS) cancelDiscard();
      else if (confirmDiscard() && pressed & BTN.CIRCLE) discard();
      return;
    }
    if (mode() === "create") {
      if (pressed & BTN.CIRCLE) createDocument(); if (pressed & BTN.CROSS) cancelCreate(); return;
    }
    const bank = heldBank(buttons);
    const directions = buttons & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
    navHeld = directions ? navHeld + 1 : 0;
    const nav = pressed | (navHeld > 18 && navHeld % 6 === 0 ? directions : 0);
    if (bank !== lastBank) {
      lastBank = bank; dismissedBank = undefined; setCommandIndex(0); navHeld = 0;
      if (bank) { scroll.stop(); libraryScroll.stop(); editorScroll.stop(); setCaretDragging(false); }
    }
    setMenu(bank !== dismissedBank ? bank : undefined);
    if (bank) {
      if (menu()) {
        setCommandIndex(moveCommand(bank, commandIndex(), nav));
        const action = BANKS[bank].actions[commandIndex()].action;
        if (pressed & BTN.CROSS) { dismissedBank = bank; setMenu(undefined); }
        else if (pressed & BTN.CIRCLE && canAction(action)) {
          dismissedBank = bank; setMenu(undefined); perform(action);
        }
      }
      return;
    }
    const code = firstCode();
    if (mode() === "read" && focus() === "document" && code && code.width > 256 && nav & (BTN.LEFT | BTN.RIGHT)) {
      codeOffsets.set(code.block, Math.max(0, Math.min(code.width - 256, codeOffset(code.block) + (nav & BTN.RIGHT ? 21 : -21))));
      while (codeOffsets.size > 16) codeOffsets.delete(codeOffsets.keys().next().value!);
      setCodeVersion(v => v + 1); setStatus("Code: D-pad left / right");
    } else if (mode() !== "edit" || focus() === "library") {
      if (pressed & BTN.LEFT) setFocus("library");
      if (pressed & BTN.RIGHT) setFocus("document");
    }
    if (focus() === "library" && nav & (BTN.UP | BTN.DOWN)) {
      libraryScroll.stop();
      setSelected(moveListSelection(selected(), nav & BTN.DOWN ? 1 : -1, libraryScroll.offset(), VIEW_H, total(), FILE_H));
      const top = selected() * FILE_H, offset = libraryScroll.offset();
      if (top < offset) libraryScroll.scrollTo(top);
      else if (top + FILE_H > offset + VIEW_H) libraryScroll.scrollTo(top + FILE_H - VIEW_H);
    }
    if (!bank) {
      if (mode() === "edit" && focus() === "document") {
        const rx = rightAnalogX(), ry = rightAnalogY();
        stickX = rx ? stickX + rx * (0.12 + Math.abs(rx) * 0.48) : 0;
        stickY = ry ? stickY + ry * (0.06 + Math.abs(ry) * 0.18) : 0;
        const dx = Math.trunc(stickX), dy = Math.trunc(stickY);
        if (dx || dy) { dragCaret(dx, dy); stickX -= dx; stickY -= dy; }
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
    if (discardToken()) { const token = discardToken(); request("discard", "draft.discard", { token }, () => { if (discardToken() === token) setDiscardToken(undefined); }); }
    pumpEditor();
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
      const x = rowSpecs.get(row)?.code ? codeOffset(rowSpecs.get(row)!.code!.block) : 0;
      if (row < 0 || row >= d.rows || tiles.get(row)?.x === x || inflight.has(`tile:${row}`)) continue;
      const resource = tileResources.get(row) ?? createResourceSlot<Tile>(() => rowChanges.notify(row));
      let ticket = 0;
      if (request(`tile:${row}`, "document.tile", { id: d.id, revision: d.revision, layout: d.layout, row, x }, p => {
        const handle = uploadLine(p.mask, p.kind, false, p.colors);
        if (handle < 0) { resource.reject(ticket, "Texture unavailable"); return; }
        const tile = { handle, kind: p.kind, start: p.start, x: p.x ?? 0 };
        if (!resource.resolve(ticket, tile)) { getOps().freeTexture?.(handle); return; }
        const previous = tiles.get(row); tiles.set(row, tile); if (previous) getOps().freeTexture?.(previous.handle);

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
    mode, setMode, focus, setFocus, menu, commandIndex, canAction, sheetModal, setSheetModal, historySizes, historyBusy, status, online, total, textVersion, doc, draft, caret, query, shift, symbols, selected, setSelected,
    newName, creating, createDocument, cancelCreate, seeking, seekEditor, discardToken, codeOffset, firstCode, editorBase, editorTotal, caretX, firstRow, firstFile, source, sourceCellWidth, sourceWidth, editorFirst, editorScroll, caretRow, caretVisible, caretDragging, setCaretDragging, dragCaret,
    tiles, rowSpecs, files, textTiles, editorRows, sourceLines, scroll, libraryScroll, activeScroll, dirty, saving, selecting, selection, confirmDiscard,
    key, moveCaret, save, search, activate, edit, jump, open, nextHeading, followLink, toggleSelect, perform, discard, cancelDiscard,
    rowSpec: (row: number) => { rowChanges.read(row); return rowSpecs.get(row); },
    rowResource: (row: number): ResourceState<Tile> => { rowChanges.read(row); return tiles.has(row) ? ready(tiles.get(row)!) : tileResources.get(row)?.state() ?? pending(); },
    fileResource: (index: number): ResourceState<FileRow> => { fileChanges.read(index); const file = files.get(index); return file ? ready(file) : pending(); },
    diagnostics: () => ({ cachedTiles: tiles.size, resourceSlots: tileResources.size, pending: inflight.size, offset: scroll.offset(), frame: ticks, sourceChars: draft()?.text.length ?? 0, deferredKeys: deferredKeys.length }),
  };
}
export type Doc = ReturnType<typeof createDoc>;
