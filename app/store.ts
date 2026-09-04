import { createMemo, createSignal, onCleanup } from "solid-js";
import { offload } from "@pocketjs/framework/offload";
import { onFrame } from "@pocketjs/framework/lifecycle";
import { BTN } from "@pocketjs/framework/input";
import { createScroller, bindDpadScroll } from "@pocketjs/framework/kinetics";
import { getOps } from "@pocketjs/framework/host";
import { uploadLine } from "./tiles.ts";
import { sourceWindow } from "./editor.ts";
type FileRow = { id: number; title: string; bytes: number };
type Document = { id: number; title: string; revision: string; layout: string; rows: number; chars: number; mini: number[]; outline: { row: number; title: string }[]; links: string[] };
type Draft = { start: number; end: number; text: string; revision: string };
export function createFolio() {
  const io = offload();
  const [mode, setMode] = createSignal<"library" | "read" | "edit" | "search">("library");
  const [status, setStatus] = createSignal("Waiting for Mac...");
  const [online, setOnline] = createSignal(false);
  const [total, setTotal] = createSignal(0);
  const [version, setVersion] = createSignal(0);
  const [doc, setDoc] = createSignal<Document>();
  const [draft, setDraft] = createSignal<Draft>();
  const [caret, setCaret] = createSignal(0);
  const [query, setQuery] = createSignal("");
  const [shift, setShift] = createSignal(false);
  const [symbols, setSymbols] = createSignal(false);
  const [selected, setSelected] = createSignal(0);
  const [saving, setSaving] = createSignal(false);
  const [dirty, setDirty] = createSignal(false);
  const tiles = new Map<number, { handle: number; kind: number; start: number }>();
  const files = new Map<number, FileRow>();
  const textTiles = new Map<string, number>();
  const sourceLines = createMemo(() => sourceWindow(draft()?.text ?? "", caret()));
  const inflight = new Map<string, number>();
  let generation = 0, previous = 0, ticks = 0, lastSession = 0, retryAt = 0, op = "", editReturn = 0;
  const scroll = createScroller({ max: () => Math.max(0, (doc()?.rows ?? 0) * 20 - 196), extent: () => 196 });
  const libraryScroll = createScroller({ max: () => Math.max(0, total() * 24 - 192), extent: () => 192 });
  const activeScroll = () => mode() === "library" ? libraryScroll : scroll;
  bindDpadScroll(scroll, { active: () => mode() === "read", stepPx: 7, nubPx: 12 });
  const bump = () => setVersion(v => v + 1);
  const clearPending = () => { generation++; for (const id of inflight.values()) io.cancel(id); inflight.clear(); };
  const request = (key: string, method: string, data: unknown, receive: (p: any) => void) => {
    if (!online() || inflight.has(key) || ticks < retryAt) return false;
    const gen = generation;
    let id = 0;
    try { id = io.request(method, JSON.stringify(data), result => {
      inflight.delete(key);
      if (gen !== generation) return;
      if (!result.ok) { setStatus(result.error); retryAt = ticks + 90; setSaving(false); return; }
      try { receive(JSON.parse(result.value)); } catch { setStatus("Invalid provider response"); }
    });
    } catch (error) { setStatus(error instanceof Error ? error.message : "Request exceeds budget"); return false; }
    if (id) inflight.set(key, id);
    return !!id;
  };
  const list = (offset = 0) => request(`list:${offset}`, "library.list", { offset, query: query() }, p => {
    setTotal(p.total);
    for (let i = 0; i < p.rows.length; i++) files.set(offset + i, p.rows[i]);
    while (files.size > 96) files.delete(files.keys().next().value!);
    setStatus(`${p.total} documents on Mac`); bump();
  });
  const clearTiles = () => { for (const tile of tiles.values()) getOps().freeTexture?.(tile.handle); tiles.clear(); bump(); };
  const open = (id: number, preserve = false) => {
    if (dirty()) { setStatus("Save or discard the current draft before opening a document"); return; }
    clearPending();
    request("open", "document.open", { id }, p => {
      clearTiles(); setDoc(p); setMode("read"); setDraft(undefined); setDirty(false); setSaving(false);
      if (!preserve) scroll.scrollTo(0, { immediate: true });
      setStatus("Loading document...");
    });
  };
  const edit = () => {
    const d = doc(); if (!d || mode() !== "read") return;
    scroll.stop(); editReturn = Math.max(0, Math.floor(scroll.offset() / 20));
    request("edit", "document.edit", { id: d.id, revision: d.revision, row: editReturn }, p => {
      setDraft(p); setCaret(0); setMode("edit"); setDirty(false); op = ""; setStatus("Editing source excerpt");
    });
  };
  const key = (value: string) => {
    if (saving()) return;
    if (value === "SHIFT") { setShift(!shift()); return; }
    if (value === "#+=") { setSymbols(!symbols()); return; }
    if (value === "DONE") { mode() === "search" ? search() : save(); return; }
    if (mode() === "search") { setQuery(q => value === "DEL" ? q.slice(0, -1) : (q + (value === "SPACE" ? " " : value)).slice(0, 80)); return; }
    const d = draft(); if (!d) return;
    let cursor = caret(), text = d.text;
    if (value === "DEL") {
      const n = cursor > 1 && /[\uDC00-\uDFFF]/.test(text[cursor - 1]) ? 2 : 1;
      if (cursor) { text = text.slice(0, cursor - n) + text.slice(cursor); cursor -= n; }
    } else {
      const add = value === "SPACE" ? " " : value === "ENTER" ? "\n" : shift() ? value.toUpperCase() : value;
      if (text.length + add.length > 768) { setStatus("Excerpt is full; save before continuing"); return; }
      text = text.slice(0, cursor) + add + text.slice(cursor); cursor += add.length; setShift(false);
    }
    setDraft({ ...d, text }); setCaret(cursor); setDirty(true); op = "";
  };
  const moveCaret = (n: number) => {
    let next = Math.max(0, Math.min(draft()?.text.length ?? 0, caret() + n));
    if (/[\uDC00-\uDFFF]/.test(draft()?.text[next] ?? "")) next += n < 0 ? -1 : 1;
    setCaret(next);
  };
  const save = () => {
    const d = doc(), e = draft(); if (!d || !e || saving()) return;
    if (!dirty()) { setMode("read"); return; }
    // Reuse identity after an unknown outcome; editing again creates a new one.
    op ||= `${d.id}-${d.revision.slice(0, 16)}-${ticks}-${Math.floor(Math.random() * 1000000000)}`;
    const sent = request("save", "document.save", { ...e, id: d.id, op }, () => {
      setSaving(false); setDirty(false); setStatus("Saved on Mac"); open(d.id, true);
    });
    if (sent) { setSaving(true); setStatus("Saving on Mac..."); }
    else setStatus("Draft retained; reconnect to save");
  };
  const search = () => { clearPending(); files.clear(); setTotal(0); setMode("library"); libraryScroll.scrollTo(0, { immediate: true }); setSelected(0); retryAt = 0; list(); };
  const back = () => {
    if (mode() === "edit") { if (dirty()) { setStatus("Draft retained. START saves; X returns to reading."); return; } setMode("read"); }
    else { clearPending(); setMode("library"); }
  };
  const activate = () => {
    if (mode() === "library") { const file = files.get(selected()); if (file) open(file.id); }
    else if (mode() === "read") { if (draft()) setMode("edit"); else edit(); }
  };
  const jump = (fraction: number) => activeScroll().scrollTo(Math.max(0, Math.min(1, fraction)) * (mode() === "library" ? Math.max(0, total() * 24 - 192) : Math.max(0, (doc()?.rows ?? 0) * 20 - 196)), { immediate: true });
  const nextHeading = (direction: number) => {
    const d = doc(); if (!d) return;
    request("heading", "document.heading", { id: d.id, row: scroll.offset() / 20, direction }, p => scroll.scrollTo(p.row * 20));
  };
  onFrame(buttons => {
    ticks++; setOnline(io.connected());
    const session = io.session();
    if (session > 0 && session !== lastSession) {
      lastSession = session; clearPending(); retryAt = 0; setSaving(false);
      const current = doc();
      if (current) request("revalidate", "document.open", { id: current.id }, p => {
        if (current.revision !== p.revision || current.layout !== p.layout) {
          if (dirty() || mode() === "edit") setStatus("Mac revision changed; draft retained");
          else { clearTiles(); setDoc(p); }
        }
      });
    }
    const pressed = buttons & ~previous; previous = buttons;
    if (mode() === "library") {
      if (pressed & BTN.DOWN) setSelected(Math.min(total() - 1, selected() + 1));
      if (pressed & BTN.UP) setSelected(Math.max(0, selected() - 1));
      if (pressed & (BTN.DOWN | BTN.UP)) libraryScroll.chaseTo(Math.max(0, selected() - 3) * 24);
      if (pressed & BTN.LTRIGGER) { setSelected(Math.max(0, selected() - 100)); libraryScroll.scrollTo(selected() * 24); }
      if (pressed & BTN.RTRIGGER) { setSelected(Math.min(total() - 1, selected() + 100)); libraryScroll.scrollTo(selected() * 24); }
    } else if (mode() === "edit") {
      if (pressed & BTN.LEFT) moveCaret(-1); if (pressed & BTN.RIGHT) moveCaret(1);
      if (pressed & BTN.UP) moveCaret(-48); if (pressed & BTN.DOWN) moveCaret(48);
      if (pressed & BTN.CIRCLE) key("ENTER"); if (pressed & BTN.CROSS) key("DEL");
      if (pressed & BTN.START) save();
    } else {
      if (pressed & BTN.LTRIGGER) nextHeading(-1); if (pressed & BTN.RTRIGGER) nextHeading(1);
    }
    if (mode() !== "edit" && pressed & BTN.CIRCLE) activate();
    if (mode() !== "edit" && pressed & BTN.CROSS) back();
    if (pressed & BTN.TRIANGLE && mode() === "edit") { setMode("read"); setStatus("Draft retained. A resumes editing."); }
    if (pressed & BTN.SQUARE && mode() === "read") { const name = doc()?.links[0]; if (name) request("link", "library.link", { name }, p => open(p.id)); }
    if (pressed & BTN.SELECT && mode() === "library") setMode("search");
    scroll.step(); libraryScroll.step();
    if (!online()) { if (!saving()) setStatus(dirty() ? "Offline - draft retained" : "Waiting for paired Mac..."); return; }
    const visibleText = mode() === "edit" ? sourceLines().map(line => line.replace("\u0001", "")) : mode() === "library" ? Array.from({ length: 9 }, (_, n) => files.get(Math.max(0, Math.floor(libraryScroll.offset() / 24)) + n)?.title.slice(0, 36) ?? "") : [];
    for (const line of visibleText) {
      if (!/[^\x00-\x7f]/.test(line) || textTiles.has(line) || inflight.size >= 4) continue;
      if (request(`text:${line}`, "text.tile", { text: line }, p => {
        const handle = uploadLine(p.mask, 3); if (handle < 0) return;
        textTiles.set(line, handle);
        if (textTiles.size > 12) { const key = textTiles.keys().next().value!; getOps().freeTexture?.(textTiles.get(key)!); textTiles.delete(key); }
        bump();
      })) break;
    }
    if (mode() === "library") {
      const first = Math.max(0, Math.floor(libraryScroll.offset() / 24));
      const page = Math.floor(first / 12) * 12;
      if (!files.has(first)) list(page);
      if (total() > page + 12 && !files.has(page + 12)) list(page + 12);
    } else if (mode() === "read") {
      const d = doc(); if (!d) return;
      const first = Math.max(0, Math.floor(scroll.offset() / 20));
      // Visible first, then ahead of motion, then behind. At most two new
      // requests per tick and four tiles in flight leave room for editing.
      let issued = 0;
      const ahead = scroll.velocity() >= 0;
      for (let n = 0; n < 60 && inflight.size < 4 && issued < 2; n++) {
        const row = n < 12 ? first + n : ahead ? (n < 44 ? first + n : first - (n - 43)) : (n < 44 ? first - (n - 11) : first + n - 32);
        if (row < 0 || row >= d.rows || tiles.has(row) || inflight.has(`tile:${row}`)) continue;
        if (request(`tile:${row}`, "document.tile", { id: d.id, revision: d.revision, layout: d.layout, row }, p => {
          const handle = uploadLine(p.mask, p.kind);
          if (handle < 0) { setStatus("Texture budget exhausted"); return; }
          tiles.set(row, { handle, kind: p.kind, start: p.start });
          while (tiles.size > 72) {
            let victim = -1, distance = -1;
            for (const k of tiles.keys()) if (Math.abs(k - first - 5) > distance) { victim = k; distance = Math.abs(k - first - 5); }
            getOps().freeTexture?.(tiles.get(victim)!.handle); tiles.delete(victim);
          }
          bump(); setStatus(dirty() ? "Draft retained - A resumes" : `${Math.round((first + 1) / d.rows * 100)}%  |  ${tiles.size} cached lines`);
        })) issued++;
      }
    }
  });
  onCleanup(() => { clearPending(); clearTiles(); for (const handle of textTiles.values()) getOps().freeTexture?.(handle); });
  return { mode, setMode, status, online, total, version, doc, draft, caret, query, shift, symbols, selected, setSelected,
    tiles, files, textTiles, sourceLines, scroll, libraryScroll, activeScroll, dirty, saving, key, moveCaret, save, search, back, activate, edit, jump, open, nextHeading,
    followLink: () => { const name = doc()?.links[0]; if (name) request("link", "library.link", { name }, p => open(p.id)); },
    discard: () => { if (saving()) return; setDirty(false); setDraft(undefined); setMode("read"); setStatus("Draft discarded"); if (doc() && online()) open(doc()!.id, true); },
    diagnostics: () => ({ cachedTiles: tiles.size, pending: inflight.size, offset: scroll.offset(), frame: ticks }),
  };
}
export type Folio = ReturnType<typeof createFolio>;
