import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, mkdirSync, renameSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Library } from "../host/library.ts";
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "doc-delete-"));
  writeFileSync(join(root, "note.md"), "# Deletable\n\nOne 中文 line.\n");
  const library = new Library(root); library.index();
  return { root, library, close() { library.close(); rmSync(root, { recursive: true, force: true }); } };
};

test("delete archives exactly once, removes search entries and never reuses a file id", () => {
  const f = fixture();
  try {
    const source = readFileSync(join(f.root, "note.md"), "utf8"), info = f.library.stat(1);
    const request = { id: info.id, revision: info.revision, op: "delete-test-0001" };
    expect(f.library.remove(request)).toEqual({ id: 1, removed: true });
    expect(existsSync(join(f.root, "note.md"))).toBe(false);
    expect(readFileSync(join(f.root, ".doc/deleted/delete-test-0001.md"), "utf8")).toBe(source);
    expect(f.library.list().total).toBe(0); expect(f.library.list("Deletable").total).toBe(0);
    const newFile = f.library.create({ name: "note", op: "create-after-delete" });
    expect(newFile.document.id).toBeGreaterThan(info.id);
    expect(f.library.remove(request)).toEqual({ id: 1, removed: true });
    expect(readFileSync(join(f.root, "note.md"), "utf8")).toBe("# note\n\n");
    expect(() => f.library.remove({ ...request, id: newFile.document.id })).toThrow("identity conflict");
  } finally { f.close(); }
});

test("delete recovery finishes both sides of rename and preserves a recreated filename", () => {
  for (const renamed of [false, true]) {
    const f = fixture();
    try {
      const info = f.library.stat(1), archive = join(f.root, ".doc/deleted"); mkdirSync(archive);
      const stage = join(archive, "delete-recovery.md");
      f.library.db.query("INSERT INTO deletes VALUES(?,?,?,?,?,'prepared')").run("delete-recovery", 1, "note.md", info.revision, stage);
      if (renamed) { renameSync(join(f.root, "note.md"), stage); writeFileSync(join(f.root, "note.md"), "# New incarnation\n"); }
      const reopened = new Library(f.root); reopened.index();
      expect(reopened.remove({ id: 1, revision: info.revision, op: "delete-recovery" }).removed).toBe(true);
      expect(existsSync(stage)).toBe(true);
      expect(reopened.list().total).toBe(renamed ? 1 : 0);
      if (renamed) { expect((reopened.list().rows[0] as { id: number }).id).toBeGreaterThan(1); expect(readFileSync(join(f.root, "note.md"), "utf8")).toBe("# New incarnation\n"); }
      reopened.close();
    } finally { f.close(); }
  }
});

test("delete rejects external edits, dirty drafts and path escapes", () => {
  const f = fixture();
  try {
    const info = f.library.stat(1), request = { id: 1, revision: info.revision, op: "delete-protection" };
    writeFileSync(join(f.root, "note.md"), "External change");
    expect(() => f.library.remove(request)).toThrow("changed on Mac");
    const doc = f.library.open(1), draft = f.library.beginDraft({ id: 1, revision: doc.revision, row: 0, token: "draft-protection" });
    f.library.drafts.seek({ token: draft.token, seq: draft.seq, op: "stage-protection", patch: { start: draft.start, end: draft.end, text: "Unsaved changes" } });
    expect(() => f.library.remove({ ...request, revision: doc.revision })).toThrow("Save or discard");
    f.library.drafts.discard(draft.token);
    unlinkSync(join(f.root, "note.md")); symlinkSync(join(f.root, ".doc/index.sqlite"), join(f.root, "note.md"));
    expect(() => f.library.remove({ ...request, revision: doc.revision })).toThrow("left the granted directory");
  } finally { f.close(); }
});

test("refresh prunes externally removed files and empty libraries stay queryable", () => {
  const f = fixture();
  try {
    unlinkSync(join(f.root, "note.md"));
    expect(JSON.parse(f.library.methods()["library.refresh"]('{}')).total).toBe(0);
    writeFileSync(join(f.root, "new.md"), "# New file\n"); f.library.index();
    expect((f.library.list().rows[0] as { id: number }).id).toBeGreaterThan(1);
  } finally { f.close(); }
});
