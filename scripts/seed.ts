import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
export function seed(root: string, count = 1000) {
  mkdirSync(root, { recursive: true });
  let bytes = 0, minimum = Infinity;
  for (let i = 0; i < count; i++) {
    const path = resolve(root, `note-${String(i + 1).padStart(4, "0")}.md`);
    if (!existsSync(path)) {
      const title = ["Field notes", "Design notebook", "Reading journal", "Research log"][i % 4];
      let text = `# ${title} ${i + 1}\n\nA working notebook on a small screen.\n\n[[note-${String((i + 1) % count + 1).padStart(4, "0")}]]\n\n`;
      for (let section = 1; Buffer.byteLength(text) < 112 * 1024; section++) {
        text += `## ${section}. Observation and experiment\n\nThis is document ${i + 1}, section ${section}. The desktop owns files, indexes and layout. The handheld keeps scrolling, focus and the current draft. A slow disk must never hold the UI thread.\n\n`;
        text += `- Measure the work done in every frame.\n- Keep a bounded window around the viewport.\n- [ ] Review this experiment on hardware.\n\n> A note can be large while its visible window stays small.\n\n`;
        text += "```ts\nconst document = await library.open(id);\n// The UI retains local interaction state.\n```\n\n";
        text += "| Owner | Responsibility |\n| --- | --- |\n| Mac | Files, SQLite, text layout |\n| 3DS | Input, momentum, visible rows |\n\n";
        text += "中文笔记：文档内容在上屏显示，下屏负责触控、键盘和导航。日本語のメモ。\n\n";
      }
      writeFileSync(path, text, { flag: "wx" });
    }
    const size = statSync(path).size; bytes += size; minimum = Math.min(minimum, size);
  }
  return { root, count, bytes, minimum };
}
if (import.meta.main) console.log(JSON.stringify(seed(resolve(process.argv[2] ?? "data/library")), null, 2));
