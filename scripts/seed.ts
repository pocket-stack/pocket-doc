import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

export const CORPUS_ROOT = "data/library-v2";
const cases = [
  { title: "API handbook", subject: "an offline reading API", sections: ["Quick start", "Request contract", "Error handling", "Version migration"],
    lang: "ts", code: 'interface Note { id: number; title: string }\nconst load = async (id: number): Promise<Note> => {\n  const response = await fetch(`/notes/${id}`);\n  if (!response.ok) throw new Error("Unavailable");\n  return response.json();\n};' },
  { title: "Query cookbook", subject: "a personal research index", sections: ["Schema", "Search examples", "Query plans", "Backup and restore"],
    lang: "sql", code: "-- Keep search and source revisions together\nSELECT title, count(*) AS mentions\nFROM notes JOIN links ON notes.id = links.target\nWHERE updated_at >= '2026-01-01'\nGROUP BY title ORDER BY mentions DESC LIMIT 12;" },
  { title: "Design decision", subject: "a resilient synchronization queue", sections: ["Context", "Alternatives", "Decision", "Consequences"],
    lang: "rust", code: '/* Retry reads, but keep mutation identity\n   across connection changes. */\nfn retry(attempt: u32) -> Option<u64> {\n    match attempt {\n        0..=3 => Some(100 * 2_u64.pow(attempt)),\n        _ => None,\n    }\n}' },
  { title: "Experiment log", subject: "a greenhouse sensor study", sections: ["Hypothesis", "Method", "Observations", "Interpretation"],
    lang: "python", code: '# Reject absent measurements before averaging\ndef mean(samples):\n    valid = [x for x in samples if x is not None]\n    return sum(valid) / len(valid) if valid else None\n\nprint(f"Mean: {mean([18.5, None, 21.0]):.2f}")' },
  { title: "Meeting notes", subject: "a community archive release", sections: ["Agenda", "Discussion", "Decisions", "Action items"],
    lang: "yaml", code: 'release:\n  name: autumn-archive\n  reviewers: [Alex, Morgan, Sam]\n  tasks:\n    - title: Verify image captions\n      complete: false\n    - title: Export the reading index\n      complete: true' },
  { title: "Recovery runbook", subject: "a local publishing service", sections: ["Symptoms", "Diagnosis", "Recovery", "Verification"],
    lang: "bash", code: '# Read-only diagnosis, no service changes\nstatus="unknown"\nfor file in logs/*.log; do\n  printf "Inspecting %s\\n" "$file"\n  tail -n 20 "$file"\ndone\necho "Review the timestamps before retrying."' },
  { title: "Interface guide", subject: "a bilingual reading interface", sections: ["Content model", "Interaction", "Accessibility", "Review checklist"],
    lang: "css", code: '/* The content stays readable at narrow widths. */\n.note {\n  color: #243955;\n  background: white;\n  max-width: 42rem;\n  padding: 1.25rem;\n}\n.note:focus { outline: 2px solid #2675d4; }' },
  { title: "多语言旅行笔记", subject: "a multilingual field journal", sections: ["路线与计划", "观察记录", "用语与翻译", "回来以后"],
    lang: "json", code: '{\n  "city": "京都",\n  "languages": ["中文", "日本語", "English"],\n  "walkingKm": 7.5,\n  "booked": false,\n  "memo": "駅から川沿いを歩く 🌿"\n}' },
] as const;

/** Original synthetic documents. IDs, scenarios and measurements are deterministic. */
export function specimen(id: number, count: number, minimumBytes = 112 * 1024): string {
  const item = cases[(id - 1) % cases.length];
  let text = `# ${item.title} ${id}\n\nThis is document ${id}, a working record for ${item.subject}.\n\n[[note-${String(id % count + 1).padStart(4, "0")}]]\n\n`;
  text += `## Quick example\n\n\`\`\`${item.lang}\n${item.code}\n\`\`\`\n\n`;
  let bytes = Buffer.byteLength(text);
  for (let section = 1; bytes < minimumBytes; section++) {
    const phase = item.sections[(section - 1) % item.sections.length];
    const sample = (id * 97 + section * 31) % 997, latency = 8 + sample % 140;
    const paragraphs = [
      `The ${phase.toLowerCase()} review uses sample ${sample}. The group compared the first visible result with the complete record and kept the original source beside the derived summary. A short summary needs a link back to the evidence.`,
      `For ${item.subject}, entry ${section} records ${12 + sample % 47} observations. The first run took ${latency} ms; the repeated run took ${Math.max(2, latency - 7)} ms. These are synthetic measurements used to exercise tables, search and navigation.`,
      `The unresolved question is whether the same result can be reproduced after interruption. The reviewer noted the starting state, changed one variable, and recorded the resulting state before moving to the next experiment.`,
      `A narrow display makes long identifiers and mixed scripts easier to miss. This case includes inline \`record_${id}_${section}\`, a [local reference](#quick-example), and an escaped pipe \\| so visual wrapping can be checked independently of the source text.`,
    ];
    let part = `## ${section}. ${phase}\n\n${paragraphs[sample % paragraphs.length]}\n\n`;
    part += `- [x] Record the starting conditions for case ${id}-${section}.\n- [ ] Review the result with the next reader.\n  - Keep the original wording and units.\n\n> Review note: ${paragraphs[(sample + 1) % paragraphs.length]}\n\n`;
    part += `| Check | Result | Follow-up |\n| :--- | ---: | --- |\n| Sample ${sample} | ${latency} ms | Repeat after reconnect |\n| Mixed scripts | 中文 / 日本語 | Check wrapping and source offsets |\n| Long value | record_${id}_${section}_${sample} | Keep the full identifier in source |\n\n`;
    if (section % 3 === 1) part += `\`\`\`${item.lang}\n${item.code}\n\`\`\`\n\n`;
    if (section % 7 === 0) part += "~~~text\nTabs:\talpha\tbeta\nWide cells: 中文 日本語 😀\nUnknown languages keep a readable fixed-width fallback.\n~~~\n\n";
    if (section % 5 === 0) part += "### 文字与标点 / Language check\n\n中文：保留原始资料，再记录观察和修改。日本語：表示と入力の位置を確かめる。Café, naïve, Straße, e\u0301; emoji 🌱🚲.\n\n";
    part += "---\n\n";
    text += part; bytes += Buffer.byteLength(part);
  }
  return text;
}

export function seed(root: string, count = 1000) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) throw new Error("Invalid corpus count");
  mkdirSync(root, { recursive: true });
  let bytes = 0, minimum = Infinity, maximum = 0, created = 0;
  for (let i = 1; i <= count; i++) {
    const path = resolve(root, `note-${String(i).padStart(4, "0")}.md`);
    if (!existsSync(path)) {
      // Include larger outliers without changing the 100 KiB lower bound.
      writeFileSync(path, specimen(i, count, i % 100 === 0 ? 1024 * 1024 : (112 + i % 5 * 16) * 1024), { flag: "wx" }); created++;
    }
    const size = statSync(path).size; bytes += size; minimum = Math.min(minimum, size); maximum = Math.max(maximum, size);
  }
  return { root, count, created, bytes, minimum, maximum, scenarios: cases.map(item => item.title) };
}
if (import.meta.main) console.log(JSON.stringify(seed(resolve(process.argv[2] ?? CORPUS_ROOT)), null, 2));
