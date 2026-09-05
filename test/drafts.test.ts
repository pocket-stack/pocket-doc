import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Library } from "../host/library.ts";
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), "doc-draft-"));
  const original = "# Long source\n\n" + Array.from({ length: 4000 }, (_, i) => `Line ${i}: a measured record with 中文 and 😀.\n`).join("");
  writeFileSync(join(root, "long.md"), original);
  const library = new Library(root); library.index();
  return { root, library, original, close() { library.close(); rmSync(root, { recursive: true, force: true }); } };
};

test("whole-document draft stages distant edits without writing the source and saves once", () => {
  const f = fixture();
  try {
    const doc = f.library.open(1), first = f.library.beginDraft({ id: 1, revision: doc.revision, row: 0, token: "draft-test-0001" });
    const request = { token: first.token, seq: first.seq, op: "seek-test-00001", row: 2000,
      patch: { start: first.start, end: first.end, text: first.text.replace("Long source", "Edited source") } };
    const second = f.library.drafts.seek(request);
    expect(second.start).toBeGreaterThan(10000); expect(second.text.length).toBeLessThanOrEqual(512);
    expect(f.library.drafts.seek(request)).toEqual(second);
    expect(() => f.library.drafts.seek({ ...request, row: 3 })).toThrow("identity conflict");
    expect(readFileSync(join(f.root, "long.md"), "utf8")).toBe(f.original);
    const back = f.library.drafts.seek({ token: second.token, seq: second.seq, op: "seek-test-00002", row: 0,
      patch: { start: second.start, end: second.end, text: "Distant edit\n" + second.text } });
    expect(back.text).toContain("Edited source");
    const reopened = new Library(f.root);
    const saved = { id: 1, revision: doc.revision, token: back.token, seq: back.seq, op: "save-draft-00001" };
    const result = reopened.saveDraft(saved); expect(reopened.saveDraft(saved)).toEqual(result); reopened.close();
    const text = readFileSync(join(f.root, "long.md"), "utf8");
    expect(text).toContain("# Edited source"); expect(text).toContain("Distant edit");
    expect(text.match(/Distant edit/g)).toHaveLength(1);
    expect(text).toContain("Line 3999:");
  } finally { f.close(); }
});

test("staged draft history crosses windows and discard leaves the Mac source unchanged", () => {
  const f = fixture();
  try {
    const doc = f.library.open(1), first = f.library.beginDraft({ id: 1, revision: doc.revision, row: 0, token: "draft-test-0002" });
    const changed = f.library.drafts.seek({ token: first.token, seq: first.seq, op: "seek-test-00003", row: 800,
      patch: { start: first.start, end: first.end, text: "Change\n" + first.text } });
    const undo = f.library.drafts.seek({ token: first.token, seq: changed.seq, op: "undo-test-00001", history: -1 });
    expect(undo.text).toStartWith("# Long source"); expect(undo.stagedDirty).toBe(false);
    const redo = f.library.drafts.seek({ token: first.token, seq: undo.seq, op: "redo-test-00001", history: 1 });
    expect(redo.text).toStartWith("Change\n");
    f.library.drafts.discard(first.token); f.library.drafts.discard(first.token);
    expect(readFileSync(join(f.root, "long.md"), "utf8")).toBe(f.original);
    expect(() => f.library.drafts.seek({ token: first.token, seq: redo.seq, op: "seek-test-00004", row: 0 })).toThrow("closed");
  } finally { f.close(); }
});

test("draft conflicts retain staged changes and reject invalid windows", () => {
  const f = fixture();
  try {
    const doc = f.library.open(1), d = f.library.beginDraft({ id: 1, revision: doc.revision, row: 0, token: "draft-test-0003" });
    expect(() => f.library.drafts.seek({ token: d.token, seq: 99, op: "bad-seek-00001", row: 0 })).toThrow("sequence");
    expect(() => f.library.drafts.seek({ token: d.token, seq: d.seq, op: "bad-seek-00002", patch: { start: 0, end: 5000, text: "" } })).toThrow("window");
    writeFileSync(join(f.root, "long.md"), "External edit");
    expect(() => f.library.saveDraft({ id: 1, revision: doc.revision, token: d.token, seq: d.seq, op: "save-draft-00002" })).toThrow("Conflict");
    expect(f.library.drafts.content(d.token, d.seq).source).toBe(f.original);
  } finally { f.close(); }
});

test("new documents are exclusive, idempotent, indexed and ready for full editing", () => {
  const f = fixture();
  try {
    const created = f.library.create({ name: "My new note", op: "create-test-0001" });
    expect(created.document.title).toBe("My new note"); expect(created.position).toBe(1);
    expect(created.window.text).toBe("# My new note\n\n"); expect(created.total).toBe(2);
    expect(f.library.create({ name: "My new note.md", op: "create-test-0001" }).document.id).toBe(created.document.id);
    expect(() => f.library.create({ name: "My new note", op: "create-test-0002" })).toThrow("exists");
    for (const name of ["", "../escape", "a/b", "a\\b", ".private", "bad\nname"]) expect(() => f.library.create({ name, op: "create-test-0003" })).toThrow();
    expect(readdirSync(f.root).filter(name => name.endsWith(".md"))).toHaveLength(2);
    expect(readFileSync(join(f.root, "long.md"), "utf8")).toBe(f.original);
  } finally { f.close(); }
});


test("create recovers a fsynced staging file left before its journal insert", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.root, ".doc/create-orphan-0001.pending"), "# Recovered\n\n");
    const value = f.library.create({ name: "Recovered", op: "orphan-0001" });
    expect(value.window.text).toBe("# Recovered\n\n");
    expect(readFileSync(join(f.root, "Recovered.md"), "utf8")).toBe("# Recovered\n\n");
  } finally { f.close(); }
});
