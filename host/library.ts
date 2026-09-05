import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync, readdirSync, realpathSync, statSync, lstatSync, mkdirSync, renameSync, fsyncSync, constants } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { layout, raster, rasterSource, LAYOUT_REVISION } from "./layout.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const integer = (n: unknown, max: number) => {
  if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > max) throw new Error("Invalid position");
  return n as number;
};
export class Library {
  readonly root: string;
  readonly db: Database;
  private cache = new Map<number, { source: string; revision: string; rows: ReturnType<typeof layout>["rows"]; outline: ReturnType<typeof layout>["outline"] }>();
  constructor(root: string) {
    this.root = realpathSync(root);
    mkdirSync(join(this.root, ".folio"), { recursive: true });
    if (realpathSync(join(this.root, ".folio")) !== join(this.root, ".folio")) throw new Error("Index directory left the grant");
    try { if (lstatSync(join(this.root, ".folio/index.sqlite")).isSymbolicLink()) throw new Error("Index must not be a symlink"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    this.db = new Database(join(this.root, ".folio/index.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;
      CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, name TEXT UNIQUE, title TEXT, bytes INTEGER, modified REAL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, body);
      CREATE TABLE IF NOT EXISTS saves(op TEXT PRIMARY KEY, id INTEGER, old TEXT, revision TEXT, stage TEXT, state TEXT, fingerprint TEXT);`);
    if (!(this.db.query("PRAGMA table_info(saves)").all() as {name: string}[]).some(c => c.name === "fingerprint")) this.db.exec("ALTER TABLE saves ADD COLUMN fingerprint TEXT");
    this.recover();
  }
  index() {
    const put = this.db.query("INSERT INTO files(name,title,bytes,modified) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET title=excluded.title,bytes=excluded.bytes,modified=excluded.modified RETURNING id");
    let count = 0;
    this.db.transaction(() => {
      for (const name of readdirSync(this.root).sort()) {
        if (!name.endsWith(".md") || lstatSync(join(this.root, name)).isSymbolicLink()) continue;
        const path = join(this.root, name), stat = statSync(path);
        if (!stat.isFile() || stat.size > 4 * 1024 * 1024) continue;
        const previous = this.db.query("SELECT * FROM files WHERE name=?").get(name) as any;
        count++;
        if (previous?.modified === stat.mtimeMs && previous?.bytes === stat.size) continue;
        const body = readFileSync(path, "utf8");
        const title = (/^# (.+)$/m.exec(body)?.[1] ?? name).slice(0, 100);
        const row = put.get(name, title, stat.size, stat.mtimeMs) as { id: number };
        this.db.query("DELETE FROM search WHERE rowid=?").run(row.id);
        this.db.query("INSERT INTO search(rowid,title,body) VALUES(?,?,?)").run(row.id, title, body);
      }
    })();
    return count;
  }
  private path(id: number) {
    integer(id, 1000000);
    const row = this.db.query("SELECT name FROM files WHERE id=?").get(id) as { name: string } | null;
    if (!row) throw new Error("Document missing");
    const path = resolve(this.root, row.name);
    if (dirname(path) !== this.root || realpathSync(path) !== path || lstatSync(path).isSymbolicLink()) throw new Error("Document left the granted directory");
    return path;
  }
  private read(id: number) {
    const path = this.path(id);
    if (statSync(path).size > 4 * 1024 * 1024) throw new Error("Document exceeds 4 MiB provider budget");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return readFileSync(fd, "utf8"); } finally { closeSync(fd); }
  }
  private document(id: number, refresh = false) {
    if (!refresh && this.cache.has(id)) return this.cache.get(id)!;
    const source = this.read(id);
    if (Buffer.byteLength(source) > 4 * 1024 * 1024) throw new Error("Document exceeds 4 MiB provider budget");
    const doc = { source, revision: hash(source), ...layout(source) };
    this.cache.delete(id); this.cache.set(id, doc);
    while (this.cache.size > 2) this.cache.delete(this.cache.keys().next().value!);
    return doc;
  }
  list(query = "", offset = 0) {
    integer(offset, 1000000);
    if (query.length > 80) throw new Error("Search exceeds budget");
    const term = query.trim().replace(/"/g, '""');
    const where = term ? ' WHERE id IN (SELECT rowid FROM search WHERE search MATCH ?)' : '';
    const args = term ? [`"${term}"`] : [];
    const total = (this.db.query(`SELECT count(*) AS n FROM files${where}`).get(...args) as { n: number }).n;
    const rows = this.db.query(`SELECT id,title,bytes FROM files${where} ORDER BY id LIMIT 12 OFFSET ?`).all(...args, offset);
    return { total, offset, rows };
  }
  open(id: number) {
    const d = this.document(id, true);
    const row = this.db.query("SELECT title FROM files WHERE id=?").get(id) as { title: string };
    return { id, title: row.title, layout: LAYOUT_REVISION, revision: d.revision, rows: d.rows.length, chars: d.source.length, outline: Array.from({ length: Math.min(12, d.outline.length) }, (_, i) => d.outline[Math.floor(i * d.outline.length / Math.min(12, d.outline.length))]), mini: Array.from({ length: 26 }, (_, i) => { const row = d.rows[Math.floor(i * d.rows.length / 26)]; return Math.min(54, Math.max(2, row.text.length)); }), links: [...d.source.matchAll(/\[\[([^\]]+)\]\]/g)].slice(0, 8).map(m => m[1].slice(0, 70)) };
  }
  tile(id: number, revision: string, row: number) {
    const d = this.document(id);
    if (d.revision !== revision) throw new Error("Revision changed; reopen document");
    integer(row, d.rows.length - 1);
    const r = d.rows[row];
    return { row, kind: r.kind, start: r.start, mask: raster(r) };
  }
  window(id: number, revision: string, first: number) {
    const d = this.document(id);
    if (d.revision !== revision) throw new Error("Revision changed");
    integer(first, d.rows.length - 1);
    return d.rows.slice(first, first + 12).map((row, index) => ({
      row: first + index, kind: row.kind,
      ...(row.table ? { columns: row.table.widths, header: row.table.header } : {}),
    }));
  }
  edit(id: number, revision: string, row: number) {
    const d = this.document(id);
    if (d.revision !== revision) throw new Error("Revision changed");
    integer(row, d.rows.length - 1);
    let start = Math.min(d.source.length, d.rows[row].start), end = Math.min(d.source.length, start + 384);
    // Never bisect a surrogate pair.
    if (end < d.source.length && /[\uDC00-\uDFFF]/.test(d.source[end])) end--;
    return { start, end, text: d.source.slice(start, end), revision };
  }
  save(p: { id: number; revision: string; op: string; start: number; end: number; text: string }) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(p.op) || typeof p.text !== "string" || p.text.length > 768) throw new Error("Invalid edit");
    const fingerprint = hash(JSON.stringify([p.id, p.revision, p.start, p.end, p.text]));
    const existing = this.db.query("SELECT * FROM saves WHERE op=?").get(p.op) as any;
    if (existing) {
      if (existing.id !== p.id || existing.old !== p.revision || existing.fingerprint !== fingerprint) throw new Error("Operation identity conflict");
      this.recover();
      const saved = this.db.query("SELECT state,revision FROM saves WHERE op=?").get(p.op) as any;
      if (saved.state !== "saved") throw new Error("Save conflict; draft retained");
      return { revision: saved.revision, saved: true };
    }
    const source = this.read(p.id);
    if (hash(source) !== p.revision) throw new Error("Conflict: file changed on Mac; draft retained");
    integer(p.start, source.length); integer(p.end, source.length);
    if (p.end < p.start || p.end - p.start > 384) throw new Error("Invalid edit range");
    const next = source.slice(0, p.start) + p.text + source.slice(p.end), revision = hash(next);
    const stage = join(this.root, `.folio/${p.op}.pending`);
    const fd = openSync(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, next); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(join(this.root, ".folio"), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
    this.db.query("INSERT INTO saves VALUES(?,?,?,?,?,?,?)").run(p.op, p.id, p.revision, revision, stage, "prepared", fingerprint);
    this.recover();
    const state = this.db.query("SELECT state FROM saves WHERE op=?").get(p.op) as { state: string };
    if (state.state !== "saved") throw new Error("Conflict: file changed on Mac; draft retained");
    this.cache.delete(p.id); this.index();
    return { revision, saved: true };
  }
  private recover() {
    this.db.transaction(() => {
    const rows = this.db.query("SELECT * FROM saves WHERE state='prepared'").all() as any[];
    for (const row of rows) {
      let current: string;
      try { current = hash(this.read(row.id)); } catch { this.db.query("UPDATE saves SET state='conflict' WHERE op=?").run(row.op); continue; }
      let state = "conflict";
      if (current === row.revision) state = "saved";
      else if (current === row.old && hash(readFileSync(row.stage, "utf8")) === row.revision) {
        renameSync(row.stage, this.path(row.id));
        const fd = openSync(this.root, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
        state = "saved";
      }
      this.db.query("UPDATE saves SET state=? WHERE op=?").run(state, row.op);
    }
    }).immediate();
  }
  methods() {
    const wrap = (f: (p: any) => unknown) => (raw: string) => JSON.stringify(f(JSON.parse(raw)));
    return {
      "text.tile": wrap(p => { if (typeof p.text !== "string" || p.text.length > 100) throw new Error("Text tile budget exceeded");
        return { mask: p.cellWidth === undefined ? raster({ text: p.text, start: 0, end: p.text.length, kind: 3 }) : rasterSource(p.text, p.cellWidth) }; }),
      "library.list": wrap(p => this.list(p.query, p.offset)),
      "document.open": wrap(p => this.open(p.id)),
      "document.tile": wrap(p => { if (p.layout !== LAYOUT_REVISION) throw new Error("Layout changed; reopen the document"); return this.tile(p.id, p.revision, p.row); }),
      "document.window": wrap(p => { if (p.layout !== LAYOUT_REVISION) throw new Error("Layout changed; reopen the document"); return this.window(p.id, p.revision, p.first); }),
      "document.heading": wrap(p => {
        const d = this.document(p.id);
        const points = p.direction > 0 ? d.outline : [...d.outline].reverse();
        return points.find(h => p.direction > 0 ? h.row > p.row + 1 : h.row < p.row - 1) ?? { row: p.row };
      }),
      "document.edit": wrap(p => this.edit(p.id, p.revision, p.row)),
      "document.save": wrap(p => this.save(p)),
      "library.link": wrap(p => {
        const row = this.db.query("SELECT id FROM files WHERE name=? OR title=? LIMIT 1").get(p.name + ".md", p.name) as { id: number } | null;
        if (!row) throw new Error("Link target missing"); return row;
      }),
    };
  }
  close() { this.db.close(); }
}
