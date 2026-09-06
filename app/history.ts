export type EditSnapshot = { text: string; caret: number; anchor: number; selecting: boolean };
/** Local history owns at most 32 bounded excerpts; a new edit drops redo. */
export function createEditHistory(limit = 32) {
  const undo: EditSnapshot[] = [], redo: EditSnapshot[] = [];
  return {
    record(before: EditSnapshot) { undo.push(before); if (undo.length > limit) undo.shift(); redo.length = 0; },
    undo(current: EditSnapshot) { const previous = undo.pop(); if (previous) redo.push(current); return previous; },
    redo(current: EditSnapshot) { const next = redo.pop(); if (next) undo.push(current); return next; },
    clear() { undo.length = redo.length = 0; },
    sizes: () => [undo.length, redo.length] as const,
  };
}
