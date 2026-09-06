import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { sourceLayout } from "../shared/source.ts";
import { SOURCE_COLUMNS } from "../shared/layout.ts";
import { SOURCE_EDIT_CHARS, SOURCE_WINDOW_CHARS, type SourceDraft, type DraftSeek } from "../shared/draft.ts";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const position = (n: number, max: number) => { if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new Error("Invalid draft position"); return n; };
const identity = (s: string) => { if (typeof s !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(s)) throw new Error("Invalid draft identity"); return s; };
type Change = { start: number; before: string; after: string };
type Record = { token: string; id: number; revision: string; source: string; seq: number; dirty: number;
  undo: string; redo: string; lastOp: string; fingerprint: string; reply: string; closed: number };

/** The provider owns the whole unsaved document. The guest owns one bounded window.
 * A seek atomically stages its old window and returns another; replaying an
 * unacknowledged operation cannot insert that window twice. */
export class Drafts {
  constructor(private db: Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS drafts(token TEXT PRIMARY KEY,id INTEGER,revision TEXT,source TEXT,seq INTEGER,dirty INTEGER,
      undo TEXT,redo TEXT,lastOp TEXT,fingerprint TEXT,reply TEXT,closed INTEGER);`);
  }
  private get(token: string) {
    identity(token);
    const row = this.db.query("SELECT * FROM drafts WHERE token=?").get(token) as Record | null;
    if (!row || row.closed) throw new Error("Draft is closed; reopen document");
    return row;
  }
  begin(token: string, id: number, revision: string, source: string, offset: number): SourceDraft {
    identity(token);
    let row = this.db.query("SELECT * FROM drafts WHERE id=? AND revision=? AND closed=0 ORDER BY dirty DESC LIMIT 1").get(id, revision) as Record | null;
    if (!row) {
      // Clean, abandoned sessions contain no user changes. Dirty drafts survive reconnect/restart.
      this.db.query("DELETE FROM drafts WHERE dirty=0 OR closed=1").run();
      if ((this.db.query("SELECT count(*) AS n FROM drafts").get() as { n: number }).n >= 8) throw new Error("Eight drafts retained; save or discard one first");
      this.db.query("INSERT INTO drafts VALUES(?,?,?,?,0,0,'[]','[]','','','',0)").run(token, id, revision, source);
      row = this.get(token);
    }
    return this.window(row, undefined, Math.min(offset, row.source.length));
  }
  private window(d: Record, row?: number, offset?: number): SourceDraft {
    const rows = sourceLayout(d.source, SOURCE_COLUMNS);
    let target = row === undefined ? Math.max(0, rows.findIndex(r => (offset ?? 0) >= r.start && (offset ?? 0) <= r.end)) : Math.min(rows.length - 1, position(row, 10000000));
    const first = Math.max(0, target - 2), start = rows[first].start;
    let until = first + 1;
    while (until < rows.length && until < first + 16 && rows[until].end - start <= SOURCE_WINDOW_CHARS) until++;
    const end = until < rows.length ? rows[until].start : d.source.length;
    return { token: d.token, revision: d.revision, seq: d.seq, start, end, text: d.source.slice(start, end), first,
      totalRows: rows.length, chars: d.source.length, stagedDirty: !!d.dirty, undo: JSON.parse(d.undo).length, redo: JSON.parse(d.redo).length };
  }
  seek(p: DraftSeek): SourceDraft {
    identity(p.op);
    const fingerprint = hash(JSON.stringify(p));
    return this.db.transaction(() => {
      const d = this.get(p.token);
      if (d.lastOp === p.op) { if (d.fingerprint !== fingerprint) throw new Error("Draft operation identity conflict"); return JSON.parse(d.reply) as SourceDraft; }
      if (d.seq !== p.seq) throw new Error("Draft sequence changed; retry the unacknowledged operation");
      const undo: Change[] = JSON.parse(d.undo), redo: Change[] = JSON.parse(d.redo);
      if (p.patch) {
        const { start, end, text } = p.patch;
        position(start, d.source.length); position(end, d.source.length);
        if (end < start || end - start > SOURCE_EDIT_CHARS || typeof text !== "string" || text.length > SOURCE_EDIT_CHARS ||
          /[\uDC00-\uDFFF]/.test(d.source[start] ?? "") || /[\uDC00-\uDFFF]/.test(d.source[end] ?? "")) throw new Error("Invalid draft window");
        const before = d.source.slice(start, end);
        if (before !== text) {
          undo.push({ start, before, after: text }); if (undo.length > 32) undo.shift(); redo.length = 0;
          d.source = d.source.slice(0, start) + text + d.source.slice(end); d.seq++;
        }
      }
      let offset = p.offset;
      if (p.history) {
        if (p.history !== -1 && p.history !== 1) throw new Error("Invalid history direction");
        const change = (p.history === -1 ? undo : redo).pop();
        if (change) {
          const from = p.history === -1 ? change.after : change.before, to = p.history === -1 ? change.before : change.after;
          if (d.source.slice(change.start, change.start + from.length) !== from) throw new Error("Draft history conflict");
          d.source = d.source.slice(0, change.start) + to + d.source.slice(change.start + from.length);
          (p.history === -1 ? redo : undo).push(change); offset = change.start; d.seq++;
        }
      }
      if (Buffer.byteLength(d.source) > 4 * 1024 * 1024) throw new Error("Draft exceeds 4 MiB provider budget");
      if (offset !== undefined) position(offset, d.source.length);
      d.dirty = hash(d.source) !== d.revision ? 1 : 0; d.undo = JSON.stringify(undo); d.redo = JSON.stringify(redo);
      const result = this.window(d, p.history ? undefined : p.row, offset);
      this.db.query("UPDATE drafts SET source=?,seq=?,dirty=?,undo=?,redo=?,lastOp=?,fingerprint=?,reply=? WHERE token=?")
        .run(d.source, d.seq, d.dirty, d.undo, d.redo, p.op, fingerprint, JSON.stringify(result), d.token);
      return result;
    }).immediate();
  }
  content(token: string, seq: number) { const d = this.get(token); if (d.seq !== seq) throw new Error("Draft sequence changed"); return d; }
  discard(token: string) { identity(token); this.db.query("UPDATE drafts SET source='',undo='[]',redo='[]',reply='',closed=1 WHERE token=?").run(token); }
}
