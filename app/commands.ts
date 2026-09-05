import { BTN } from "@pocketjs/framework/input";
export type Bank = "library" | "document";
export type Action = "new" | "open" | "focus-list" | "search" | "refresh" | "clear-search" | "edit" | "read" | "save" | "link" |
  "select" | "copy" | "paste" | "discard" | "focus-document" | "top" | "heading" | "previous-heading" | "end" | "undo" | "redo";
export const BANKS: Record<Bank, { title: string; columns: number; actions: readonly { label: string; action: Action }[] }> = {
  library: { title: "Files", columns: 1, actions: [
    { label: "New document", action: "new" },
    { label: "Open selected", action: "open" }, { label: "Search files", action: "search" },
    { label: "Clear search", action: "clear-search" }, { label: "Refresh list", action: "refresh" },
    { label: "Focus files", action: "focus-list" },
  ] },
  document: { title: "Document", columns: 3, actions: [
    { label: "Edit / resume", action: "edit" }, { label: "Read", action: "read" }, { label: "Save", action: "save" },
    { label: "Undo", action: "undo" }, { label: "Redo", action: "redo" }, { label: "Select", action: "select" },
    { label: "Prev heading", action: "previous-heading" }, { label: "Next heading", action: "heading" }, { label: "Follow link", action: "link" },
    { label: "Copy", action: "copy" }, { label: "Paste", action: "paste" }, { label: "Discard...", action: "discard" },
  ] },
};
export function heldBank(buttons: number): Bank | undefined {
  if (buttons & BTN.LTRIGGER) return "library";
  if (buttons & BTN.RTRIGGER) return "document";
}
/** Clamp within a row/column: sideways movement never wraps into another row. */
export function moveCommand(bank: Bank, index: number, buttons: number): number {
  const { columns, actions } = BANKS[bank], row = Math.floor(index / columns), col = index % columns;
  const y = Math.max(0, Math.min(Math.ceil(actions.length / columns) - 1, row + (buttons & BTN.DOWN ? 1 : buttons & BTN.UP ? -1 : 0)));
  const x = Math.max(0, Math.min(columns - 1, col + (buttons & BTN.RIGHT ? 1 : buttons & BTN.LEFT ? -1 : 0)));
  return Math.min(actions.length - 1, y * columns + x);
}
/** An offscreen cursor enters at the first visible row before moving further. */
export function moveListSelection(selected: number, direction: number, offset: number, extent: number, total: number, rowHeight = 24) {
  if (!total) return 0;
  const first = Math.max(0, Math.min(total - 1, Math.floor(Math.max(0, offset) / rowHeight)));
  const last = Math.min(total - 1, Math.ceil((Math.max(0, offset) + extent) / rowHeight) - 1);
  return selected < first || selected > last ? first : Math.max(0, Math.min(total - 1, selected + direction));
}
