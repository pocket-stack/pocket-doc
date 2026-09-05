import { createHighlighter, type BundledLanguage } from "../runtime/node_modules/shiki/dist/index.mjs";

// Provider worker only. Load once; tokenization never reaches the guest bundle.
const highlighter = await createHighlighter({ themes: ["github-light"],
  langs: ["typescript", "javascript", "json", "python", "bash", "sql", "rust", "c", "cpp", "css", "html", "yaml", "diff"] });
export function highlight(code: string, language: string) {
  const lang = highlighter.getLoadedLanguages().includes(language) ? language as BundledLanguage : "text";
  return highlighter.codeToTokensBase(code, { lang, theme: "github-light" });
}

/** One palette index per pixel column; foreground cells cannot overlap. */
export function columnColors(chars: readonly { char: string; color: string }[], width: number) {
  const palette = ["24292e"], columns = Array<string>(width).fill("0");
  let x = 2;
  for (const { char, color } of chars) {
    const rgb = color.replace(/^#/, "").slice(0, 6).toLowerCase();
    let ink = palette.indexOf(rgb);
    if (ink < 0 && /^[0-9a-f]{6}$/.test(rgb) && palette.length < 16) { ink = palette.length; palette.push(rgb); }
    if (ink < 0) ink = 0;
    const advance = char.codePointAt(0)! > 255 ? 14 : 7;
    columns.fill(ink.toString(16), x, Math.min(width, x + advance)); x += advance;
  }
  return { columns: columns.join(""), palette: palette.join("") };
}
