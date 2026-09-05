import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync, readdirSync, realpathSync, statSync, fstatSync, lstatSync, mkdirSync, renameSync, fsyncSync, linkSync, unlinkSync, existsSync, constants } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { layout, raster, rasterSource, codeColors, LAYOUT_REVISION } from "./layout.ts";
import { Drafts } from "./drafts.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const integer = (n: unknown, max: number) => {
  if (!Number.isSafeInteger(n) || (n as number) < 0 || (n as number) > max) throw new Error("Invalid position");
  return n as number;
};
export class Library {
  readonly root: string;
  readonly db: Database;
  readonly drafts: Drafts;
  private cache = new Map<number, { source: string; revision: string; rows: ReturnType<typeof layout>["rows"]; outline: ReturnType<typeof layout>["outline"] }>();
  constructor(root: string) {
    this.root = realpathSync(root);
    mkdirSync(join(this.root, ".doc"), { recursive: true });
    if (realpathSync(join(this.root, ".doc")) !== join(this.root, ".doc")) throw new Error("Index directory left the grant");
    try { if (lstatSync(join(this.root, ".doc/index.sqlite")).isSymbolicLink()) throw new Error("Index must not be a symlink"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    this.db = new Database(join(this.root, ".doc/index.sqlite"));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=2000;
      CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, name TEXT UNIQUE, title TEXT, bytes INTEGER, modified REAL);
      CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(title, body);
      CREATE TABLE IF NOT EXISTS saves(op TEXT PRIMARY KEY, id INTEGER, old TEXT, revision TEXT, stage TEXT, state TEXT, fingerprint TEXT);
      CREATE TABLE IF NOT EXISTS creates(op TEXT PRIMARY KEY,name TEXT,stage TEXT,state TEXT);`);
    if (!(this.db.query("PRAGMA table_info(saves)").all() as {name: string}[]).some(c => c.name === "fingerprint")) this.db.exec("ALTER TABLE saves ADD COLUMN fingerprint TEXT");
    this.recover(); this.recoverCreates();
    this.drafts = new Drafts(this.db);
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
  tile(id: number, revision: string, row: number, x = 0) {
    const d = this.document(id);
    if (d.revision !== revision) throw new Error("Revision changed; reopen document");
    integer(row, d.rows.length - 1);
    const r = d.rows[row]; integer(x, Math.max(0, (r.code?.width ?? 256) - 256));
    const colors = codeColors(r, x);
    return { row, x, kind: r.kind, start: r.start, mask: raster(r, x), ...(colors ? { colors } : {}) };
  }
  window(id: number, revision: string, first: number) {
    const d = this.document(id);
    if (d.revision !== revision) throw new Error("Revision changed");
    integer(first, d.rows.length - 1);
    return d.rows.slice(first, first + 12).map((row, index) => ({
      row: first + index, kind: row.kind,
      ...(row.code ? { code: { block: row.code.block, width: row.code.width } } : {}),
      ...(row.table ? { columns: row.table.widths, header: row.table.header, first: row.table.first, last: row.table.last } : {}),
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
    const known = this.saved(p.id, p.revision, p.op, fingerprint); if (known) return known;
    const source = this.read(p.id);
    if (hash(source) !== p.revision) throw new Error("Conflict: file changed on Mac; draft retained");
    integer(p.start, source.length); integer(p.end, source.length);
    if (p.end < p.start || p.end - p.start > 384) throw new Error("Invalid edit range");
    return this.commitSource(p.id, p.revision, p.op, source.slice(0, p.start) + p.text + source.slice(p.end), fingerprint);
  }
  private saved(id: number, revision: string, op: string, fingerprint: string) {
    const existing = this.db.query("SELECT * FROM saves WHERE op=?").get(op) as any;
    if (existing) {
      if (existing.id !== id || existing.old !== revision || existing.fingerprint !== fingerprint) throw new Error("Operation identity conflict");
      this.recover();
      const saved = this.db.query("SELECT state,revision FROM saves WHERE op=?").get(op) as any;
      if (saved.state !== "saved") throw new Error("Save conflict; draft retained");
      return { revision: saved.revision, saved: true };
    }
  }
  private commitSource(id: number, old: string, op: string, next: string, fingerprint: string) {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(op) || Buffer.byteLength(next) > 4 * 1024 * 1024) throw new Error("Invalid save");
    if (hash(this.read(id)) !== old) throw new Error("Conflict: file changed on Mac; draft retained");
    const revision = hash(next), stage = join(this.root, `.doc/${op}.pending`);
    const fd = openSync(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { writeFileSync(fd, next); fsyncSync(fd); } finally { closeSync(fd); }
    const directory = openSync(join(this.root, ".doc"), "r"); try { fsyncSync(directory); } finally { closeSync(directory); }
    this.db.query("INSERT INTO saves VALUES(?,?,?,?,?,?,?)").run(op, id, old, revision, stage, "prepared", fingerprint);
    this.recover();
    const state = this.db.query("SELECT state FROM saves WHERE op=?").get(op) as { state: string };
    if (state.state !== "saved") throw new Error("Conflict: file changed on Mac; draft retained");
    this.cache.delete(id); this.index();
    return { revision, saved: true };
  }
  beginDraft(p: { id: number; revision: string; row: number; token: string }) {
    const d = this.document(p.id, true);
    if (d.revision !== p.revision) throw new Error("Revision changed; reopen document");
    integer(p.row, d.rows.length - 1);
    return this.drafts.begin(p.token, p.id, p.revision, d.source, d.rows[p.row].start);
  }
  saveDraft(p: { id: number; revision: string; token: string; seq: number; op: string }) {
    const fingerprint = hash(JSON.stringify([p.id, p.revision, p.token, p.seq]));
    const known = this.saved(p.id, p.revision, p.op, fingerprint);
    if (known) { this.drafts.discard(p.token); return known; }
    const draft = this.drafts.content(p.token, p.seq);
    if (draft.id !== p.id || draft.revision !== p.revision) throw new Error("Draft identity conflict");
    const result = this.commitSource(p.id, p.revision, p.op, draft.source, fingerprint);
    this.drafts.discard(p.token); return result;
  }
  create(p: { name: string; op: string }) {
    if (typeof p.name !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(p.op)) throw new Error("Invalid document name or identity");
    const base = p.name.trim().replace(/\.md$/i, "");
    if (!base || base.length > 80 || /^[.]/.test(base) || /[\/\\:\x00-\x1f]/.test(base)) throw new Error("Use a filename without folders or control characters");
    const name = base + ".md", stage = join(this.root, `.doc/create-${p.op}.pending`);
    let record = this.db.query("SELECT * FROM creates WHERE op=?").get(p.op) as { name: string; state: string } | null;
    if (record && record.name !== name) throw new Error("Create operation identity conflict");
    if (!record) {
      if (existsSync(join(this.root, name))) throw new Error("A document with that filename already exists");
      const initial = `# ${base}\n\n`;
      let fd: number, recovered = false;
      try { fd = openSync(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        // A crash before the journal insert may leave our private staging file.
        fd = openSync(stage, constants.O_RDWR | constants.O_NOFOLLOW);
        if (!fstatSync(fd).isFile() || readFileSync(fd, "utf8") !== initial) { closeSync(fd); throw new Error("Create staging conflict"); }
        recovered = true;
      }
      try { if (!recovered) writeFileSync(fd, initial); fsyncSync(fd); } finally { closeSync(fd); }
      const dir = openSync(join(this.root, ".doc"), "r"); try { fsyncSync(dir); } finally { closeSync(dir); }
      this.db.query("INSERT INTO creates VALUES(?,?,?,'prepared')").run(p.op, name, stage);
    }
    this.recoverCreates();
    record = this.db.query("SELECT * FROM creates WHERE op=?").get(p.op) as { name: string; state: string };
    if (record.state !== "created") throw new Error("Filename conflict; no document was replaced");
    this.index();
    const item = this.db.query("SELECT id FROM files WHERE name=?").get(name) as { id: number };
    const position = (this.db.query("SELECT count(*) AS n FROM files WHERE id<?").get(item.id) as { n: number }).n;
    const document = this.open(item.id);
    return { document, position, total: this.list().total,
      window: this.beginDraft({ id: item.id, revision: document.revision, row: 0, token: `draft-${hash(p.op).slice(0, 32)}` }) };
  }
  private recoverCreates() {
    for (const row of this.db.query("SELECT * FROM creates WHERE state='prepared'").all() as { op: string; name: string; stage: string }[]) {
      const target = join(this.root, row.name);
      let state = "conflict";
      try {
        try { linkSync(row.stage, target); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        const a = lstatSync(row.stage), b = lstatSync(target);
        if (a.isFile() && b.isFile() && a.ino === b.ino && a.dev === b.dev) {
          const fd = openSync(this.root, "r"); try { fsyncSync(fd); } finally { closeSync(fd); } state = "created";
        }
      } catch { /* Retain staging evidence on failure. */ }
      this.db.query("UPDATE creates SET state=? WHERE op=?").run(state, row.op);
      if (state === "created") unlinkSync(row.stage);
    }
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
      "document.create": wrap(p => this.create(p)),
      "draft.begin": wrap(p => this.beginDraft(p)),
      "draft.seek": wrap(p => this.drafts.seek(p)),
      "draft.save": wrap(p => this.saveDraft(p)),
      "draft.discard": wrap(p => { this.drafts.discard(p.token); return { discarded: true }; }),
      "library.list": wrap(p => this.list(p.query, p.offset)),
      "document.open": wrap(p => this.open(p.id)),
      "document.tile": wrap(p => { if (p.layout !== LAYOUT_REVISION) throw new Error("Layout changed; reopen the document"); return this.tile(p.id, p.revision, p.row, p.x ?? 0); }),
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
