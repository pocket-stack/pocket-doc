import { createResourceScheduler, type ResourceDemand } from "@pocketjs/framework/resource-cache";
import { offloadResource } from "@pocketjs/framework/resource-offload";
import type { offload } from "@pocketjs/framework/offload";
import { getOps } from "@pocketjs/framework/host";
import { textTileKey, uploadLine } from "./tiles.ts";
import type { FileRow, RowSpec, Tile } from "./store.ts";

export type PageInput = { query: string; offset: number };
export type DocumentInput = { id: number; revision: string; layout: string };
export type TileInput = DocumentInput & { row: number; x: number };
export type WindowInput = DocumentInput & { first: number };
export type TextInput = { text: string; inverse: boolean; cellWidth: number };
export type FilePage = { total: number; rows: FileRow[] };
const documentKey = (p: DocumentInput) => `${p.id}/${p.revision}/${p.layout}`;
const value = <T>(state: { status: string; value?: T }) => state.status === "ready" ? state.value : undefined;

/** Domain identities and bounded wire formats; scheduling and ownership live in PocketJS. */
export function createDocResources(io: ReturnType<typeof offload>, changes: {
  files(first: number): void; rows(first: number): void; tile(row: number): void; text(): void;
}) {
  const scheduler = createResourceScheduler({ maxConcurrent: 4, startsPerFrame: 2, completionsPerFrame: 1, maxCollections: 4,
    available: () => io.connected() && io.pending() < 4 });
  const lists = scheduler.createCache({ key: (p: PageInput) => `${p.query.length}:${p.query}:${p.offset}`,
    maxEntries: 8, maxResponseBytes: 5000, maxCost: 8 * 8192, cost: () => 8192,
    load: offloadResource<PageInput>(io, "library.list", JSON.stringify),
    materialize(raw: string): FilePage {
      const p = JSON.parse(raw); if (!Array.isArray(p.rows) || p.rows.length > 12 || !Number.isSafeInteger(p.total) || p.total < 0) throw new Error("Invalid library page");
      return p;
    }, changed: p => changes.files(p.offset),
  });
  const windows = scheduler.createCache({ key: (p: WindowInput) => `${documentKey(p)}/${p.first}`,
    maxEntries: 8, maxResponseBytes: 5000, maxCost: 8 * 8192, cost: () => 8192,
    load: offloadResource<WindowInput>(io, "document.window", JSON.stringify),
    materialize(raw: string): RowSpec[] {
      const specs = JSON.parse(raw); if (!Array.isArray(specs) || specs.length > 12) throw new Error("Invalid layout window"); return specs;
    }, changed: p => changes.rows(p.first),
  });
  const tiles = scheduler.createCache({ key: (p: TileInput) => `${documentKey(p)}/${p.row}/${p.x}`,
    // Reserve old + replacement RGBA textures (2 * 256 * 16 * 4) plus bounded wire data.
    retry: { attempts: 4, delayFrames: 30, maxDelayFrames: 300 },
    maxEntries: 72, maxResponseBytes: 5000, maxCost: 72 * 40960, cost: () => 40960,
    load: offloadResource<TileInput>(io, "document.tile", JSON.stringify),
    materialize(raw: string): Tile {
      const p = JSON.parse(raw); const handle = uploadLine(p.mask, p.kind, false, p.colors);
      if (handle < 0) throw new Error("Texture unavailable");
      return { handle, kind: p.kind, start: p.start, x: p.x ?? 0 };
    }, dispose: tile => getOps().freeTexture?.(tile.handle), changed: p => changes.tile(p.row),
  });
  const text = scheduler.createCache({ key: (p: TextInput) => `${p.cellWidth}/${textTileKey(p.text, p.inverse)}`,
    maxEntries: 20, maxResponseBytes: 5000, maxCost: 20 * 40960, cost: () => 40960,
    load: offloadResource<TextInput>(io, "text.tile", p => JSON.stringify({ text: p.text, cellWidth: p.cellWidth })),
    materialize(raw: string, input: TextInput) {
      const p = JSON.parse(raw); const handle = uploadLine(p.mask, 3, input.inverse);
      if (handle < 0) throw new Error("Texture unavailable"); return handle;
    }, dispose: handle => getOps().freeTexture?.(handle), changed: changes.text,
  });
  return { scheduler, lists, windows, tiles, text,
    file: (query: string, index: number) => value(lists.state({ query, offset: Math.floor(index / 12) * 12 }))?.rows[index % 12],
    row: (doc: DocumentInput, row: number) => value(windows.state({ ...doc, first: Math.floor(row / 12) * 12 }))?.find(s => s.row === row),
  };
}

/** Visible rows first, then bounded directional lookahead. Independent of total document size. */
export function tileDemand(doc: DocumentInput, first: number, rows: number, direction: number, x: (row: number) => number): ResourceDemand<TileInput>[] {
  const demand: ResourceDemand<TileInput>[] = [];
  for (let n = 0; n < 60; n++) {
    const row = n < 12 ? first + n : direction >= 0 ? (n < 44 ? first + n : first - (n - 43)) : (n < 44 ? first - (n - 11) : first + n - 32);
    if (row >= 0 && row < rows) demand.push({ input: { ...doc, row, x: x(row) }, priority: n < 12 ? 3 + n : 30 + n, pin: n < 12 });
  }
  return demand;
}
