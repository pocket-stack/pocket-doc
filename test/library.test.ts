import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { seed } from "../scripts/seed.ts";
import { Library } from "../host/library.ts";
import { layout, raster } from "../host/layout.ts";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "folio-test-")); seed(root, 3);
  const library = new Library(root); library.index();
  return { root, library, close() { library.close(); rmSync(root, { recursive: true }); } };
}
describe("Mac library", () => {
  test("pages and searches SQLite; layouts preserve source locations and Unicode tiles", () => {
    const f = fixture();
    try {
      expect(f.library.list().total).toBe(3); expect(f.library.list("中文笔记").total).toBe(3);
      const doc = f.library.open(1); expect(doc.rows).toBeGreaterThan(1000);
      expect(f.library.tile(1, doc.revision, 0).mask.length).toBe(1368);
      expect(f.library.window(1, doc.revision, 0)).toHaveLength(12);
      expect(() => f.library.window(1, "stale", 0)).toThrow();
      expect(() => f.library.methods()["document.window"](JSON.stringify({ id: 1, revision: doc.revision, layout: "stale", first: 0 }))).toThrow("Layout changed");
      const rows = layout("# Title\n\n中文 😀\n").rows;
      expect(rows[2].start).toBe(9); expect(Buffer.from(raster(rows[2]), "base64").some(v => v !== 0)).toBe(true);
      expect(raster({ text: "中文", start: 0, end: 2, kind: 0 })).not.toBe(raster({ text: "□□", start: 0, end: 2, kind: 0 }));
      expect(() => f.library.tile(1, "stale", 0)).toThrow();
    } finally { f.close(); }
  });
  test("saves atomically, replays one operation once and survives provider restart", () => {
    const f = fixture();
    try {
      const doc = f.library.open(1), edit = f.library.edit(1, doc.revision, 0);
      const before = readFileSync(join(f.root, "note-0001.md"), "utf8");
      const request = { id: 1, ...edit, text: "Changed title\n", op: "save-00000001" };
      const result = f.library.save(request);
      const after = readFileSync(join(f.root, "note-0001.md"), "utf8");
      expect(after).toBe(before.slice(0, edit.start) + request.text + before.slice(edit.end));
      expect(f.library.save(request)).toEqual(result);
      expect(() => f.library.save({ ...request, text: "different edit" })).toThrow("identity");
      const reopened = new Library(f.root);
      expect(reopened.save(request)).toEqual(result); reopened.close();
    } finally { f.close(); }
  });
  test("rejects concurrent Mac edits, path escapes, unknown ids and invalid ranges", () => {
    const f = fixture();
    try {
      const d = f.library.open(1), edit = f.library.edit(1, d.revision, 0);
      writeFileSync(join(f.root, "note-0001.md"), "External change\n");
      expect(() => f.library.save({ id: 1, ...edit, text: "oops", op: "save-00000002" })).toThrow("Conflict");
      expect(readFileSync(join(f.root, "note-0001.md"), "utf8")).toBe("External change\n");
      rmSync(join(f.root, "note-0002.md")); symlinkSync("/etc/hosts", join(f.root, "note-0002.md"));
      expect(() => f.library.open(2)).toThrow(); expect(() => f.library.open(999999)).toThrow();
      expect(() => f.library.edit(1, d.revision, -1)).toThrow();
    } finally { f.close(); }
  });
  test("recovers both sides of the rename/SQLite acknowledgement boundary", () => {
    const f = fixture();
    try {
      const document = f.library.open(1);
      const path = join(f.root, "note-0001.md"), stage = join(f.root, ".folio/recovery.pending");
      const next = readFileSync(path, "utf8") + "\nRecovered edit\n";
      const revision = createHash("sha256").update(next).digest("hex");
      writeFileSync(stage, next);
      f.library.db.query("INSERT INTO saves VALUES(?,?,?,?,?,?,?)").run("recovery-0001", 1, document.revision, revision, stage, "prepared", "test");
      const recovered = new Library(f.root); recovered.close();
      expect(readFileSync(path, "utf8")).toBe(next);
      // The file changed but a process died before committing acknowledgement.
      f.library.db.query("UPDATE saves SET state='prepared' WHERE op=?").run("recovery-0001");
      const again = new Library(f.root); again.close();
      expect(f.library.db.query("SELECT state FROM saves WHERE op=?").get("recovery-0001")).toEqual({ state: "saved" });
      expect(readFileSync(path, "utf8")).toBe(next);
    } finally { f.close(); }
  });
});
