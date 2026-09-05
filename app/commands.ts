import { BTN } from "@pocketjs/framework/input";
export type Bank = "library" | "document" | "selection" | "view";
export type Action = "open" | "focus-list" | "search" | "refresh" | "edit" | "read" | "save" | "link" |
  "select" | "copy" | "paste" | "discard" | "focus-document" | "top" | "heading" | "end";
export const BANKS: Record<Bank, { title: string; side: "left" | "right"; actions: readonly { button: number; key: string; label: string; action: Action }[] }> = {
  library: { title: "L  Library", side: "left", actions: [
    { button: BTN.CIRCLE, key: "A", label: "Open selected", action: "open" },
    { button: BTN.CROSS, key: "B", label: "Focus list", action: "focus-list" },
    { button: BTN.TRIANGLE, key: "X", label: "Search", action: "search" },
    { button: BTN.SQUARE, key: "Y", label: "Refresh list", action: "refresh" },
  ] },
  document: { title: "R  Document", side: "right", actions: [
    { button: BTN.CIRCLE, key: "A", label: "Edit / resume", action: "edit" },
    { button: BTN.CROSS, key: "B", label: "Read / keep draft", action: "read" },
    { button: BTN.TRIANGLE, key: "X", label: "Save draft", action: "save" },
    { button: BTN.SQUARE, key: "Y", label: "Follow link", action: "link" },
  ] },
  selection: { title: "ZL  Selection", side: "left", actions: [
    { button: BTN.CIRCLE, key: "A", label: "Drag selection", action: "select" },
    { button: BTN.CROSS, key: "B", label: "Copy selection", action: "copy" },
    { button: BTN.TRIANGLE, key: "X", label: "Paste", action: "paste" },
    { button: BTN.SQUARE, key: "Y", label: "Discard draft...", action: "discard" },
  ] },
  view: { title: "ZR  Navigation", side: "right", actions: [
    { button: BTN.CIRCLE, key: "A", label: "Focus document", action: "focus-document" },
    { button: BTN.CROSS, key: "B", label: "Document start", action: "top" },
    { button: BTN.TRIANGLE, key: "X", label: "Next heading", action: "heading" },
    { button: BTN.SQUARE, key: "Y", label: "Document end", action: "end" },
  ] },
};
export function heldBank(buttons: number): Bank | undefined {
  if (buttons & BTN.ZL || buttons & BTN.LTRIGGER && buttons & BTN.SELECT) return "selection";
  if (buttons & BTN.ZR || buttons & BTN.RTRIGGER && buttons & BTN.SELECT) return "view";
  if (buttons & BTN.LTRIGGER) return "library";
  if (buttons & BTN.RTRIGGER) return "document";
}
export function chordAction(bank: Bank | undefined, pressed: number): Action | undefined {
  return bank ? BANKS[bank].actions.find(item => pressed & item.button)?.action : undefined;
}
/** An offscreen cursor enters at the first visible row before moving further. */
export function moveListSelection(selected: number, direction: number, offset: number, extent: number, total: number, rowHeight = 24) {
  if (!total) return 0;
  const first = Math.max(0, Math.min(total - 1, Math.floor(Math.max(0, offset) / rowHeight)));
  const last = Math.min(total - 1, Math.ceil((Math.max(0, offset) + extent) / rowHeight) - 1);
  return selected < first || selected > last ? first : Math.max(0, Math.min(total - 1, selected + direction));
}
